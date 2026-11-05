package com.neovetta.aicompanion.jarvis;

import adris.altoclef.AltoClefController;
import adris.altoclef.TaskCatalogue;
import adris.altoclef.tasks.InteractWithBlockTask;
import adris.altoclef.tasks.movement.GetToBlockTask;
import adris.altoclef.tasks.misc.EquipArmorTask;
import adris.altoclef.tasks.misc.HoldItemTask;
import adris.altoclef.tasks.construction.DestroyBlockTask;
import adris.altoclef.tasks.construction.PlaceBlockTask;
import adris.altoclef.tasks.entity.KillEntityTask;
import adris.altoclef.tasks.resources.CollectCropTask;
import adris.altoclef.tasks.container.SmeltInFurnaceTask;
import adris.altoclef.util.SmeltTarget;
import adris.altoclef.util.ItemTarget;
import adris.altoclef.tasksystem.Task;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.neovetta.aicompanion.AiCompanion;
import com.neovetta.aicompanion.entity.CompanionEntity;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.entity.Entity;
import net.minecraft.entity.mob.HostileEntity;
import net.minecraft.entity.passive.VillagerEntity;
import net.minecraft.util.math.Box;
import net.minecraft.item.Item;
import net.minecraft.item.Items;
import net.minecraft.block.Block;
import net.minecraft.block.CropBlock;
import net.minecraft.block.FarmlandBlock;
import net.minecraft.block.Blocks;
import net.minecraft.block.BlockState;
import net.minecraft.state.property.Properties;
import net.minecraft.util.Identifier;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.Registries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Set;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Opt-in JARVIS bridge for Fabric 1.20.1, invoked on the Minecraft server thread.
 * The external LLM NEVER calls this bridge; only a Guardian-authorized JARVIS process can.
 * An "observed" receipt is telemetry, not JARVIS Core proof of task success.
 * This file is an overlay, not a modification of the pinned LGPL upstream submodule.
 */
public final class JarvisBridgeServer {
    private static final int LIMIT = 65536;
    private static final long SKEW_MS = 30000;
    private static volatile ServerSocket listener;
    private static volatile Thread worker;
    private static volatile MinecraftServer running;
    private static volatile String secret;
    private static volatile String allowedWorld;
    private static volatile JarvisNativeJournal journal;
    // Accessed only from server.execute; bounded to avoid indefinite replay state.
    private static final Map<String, Long> seen = new HashMap<>();
    private static final Map<UUID, Run> tasks = new HashMap<>();
    private static final java.util.Set<UUID> safetyStopped = new java.util.HashSet<>();

    private JarvisBridgeServer() {}

    private static final class Run {
        final UUID companion;
        final UUID coreTaskId;
        final AltoClefController ctrl;
        final long deadline;
        final long since = System.currentTimeMillis();
        JarvisEndgameTask endgame;
        JarvisNativeSequenceTask sequence;
        JarvisNativeVillagerTrade.Result trade;
        String transferItem;
        String transferDirection;
        int transferCount;
        boolean transferDone;
        int transferPlayerBefore;
        int transferPlayerAfter;
        int transferContainerBefore;
        int transferContainerAfter;
        String smeltGoal;
        String smeltOutput;
        int smeltTarget;
        String cropGoal;
        String cropKind;
        String cropItem;
        Block cropBlock;
        int cropTargetCount;
        int harvestedCells;
        int cropInitialCount;
        final Set<BlockPos> cropCells = new HashSet<>();
        final Map<BlockPos,Integer> lastCropAge = new HashMap<>();
        final CompanionEntity entity;
        String item;
        int initialCount;
        int addedCount;
        BlockPos arrival;
        BlockPos blockPos;
        String blockId;
        Boolean interactiveBefore;
        boolean expectAir;
        String equipDestination;
        String equipItem;
        Entity combatTarget;
        volatile long settledAt;
        volatile String state = "running";
        volatile String note = "task-dispatched-not-verified";
        Run(UUID companion, UUID coreTaskId, AltoClefController ctrl, CompanionEntity entity, long budgetMs) {
            this.companion=companion; this.coreTaskId=coreTaskId;
            this.ctrl=ctrl; this.entity=entity;
            this.deadline=System.currentTimeMillis()+budgetMs;
        }
    }

    public static boolean enabled() {
        return "1".equals(System.getenv("JARVIS_MC_BRIDGE_ENABLE"));
    }

    public static void install() {
        if (!enabled()) return;
        ServerLifecycleEvents.SERVER_STARTED.register(JarvisBridgeServer::start);
        ServerTickEvents.END_SERVER_TICK.register(JarvisBridgeServer::enforceDeadlines);
        ServerLifecycleEvents.SERVER_STOPPING.register(server -> stop());
    }

    private static synchronized void start(MinecraftServer server) {
        if (listener != null) return;
        String key = System.getenv("JARVIS_MC_BRIDGE_SECRET");
        String world = System.getenv("JARVIS_MC_BRIDGE_WORLD");
        String ownerConfig=System.getenv("JARVIS_MC_BRIDGE_OWNER_UUID");
        String companionConfig=System.getenv("JARVIS_MC_BRIDGE_COMPANION_UUID");
        if (key == null || key.getBytes(StandardCharsets.UTF_8).length < 32 ||
                world == null || !world.matches("[a-z0-9_.-]+:[a-z0-9_./-]+") ||
                ownerConfig==null || companionConfig==null ||
                !ownerConfig.matches("[0-9a-fA-F-]{36}") ||
                !companionConfig.matches("[0-9a-fA-F-]{36}")) {
            AiCompanion.LOGGER.error("JARVIS bridge DENIED: missing key or world allowlist");
            return;
        }
        int port;
        try {
            port = Integer.parseInt(System.getenv().getOrDefault("JARVIS_MC_BRIDGE_PORT", "48251"));
            if (port < 1024 || port > 65535) throw new IllegalArgumentException();
        } catch (Exception ex) {
            AiCompanion.LOGGER.error("JARVIS bridge DENIED: invalid port");
            return;
        }
        try {
            ServerSocket sock = new ServerSocket();
            sock.setReuseAddress(false);
            sock.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 8);
            // A corrupt or ambiguous native ledger blocks the entire bridge
            // BEFORE the socket is exposed to local clients.
            JarvisNativeJournal restored=JarvisNativeJournal.load();
            listener = sock;
            journal=restored;
            running = server;
            secret = key;
            allowedWorld = world;
            worker = new Thread(() -> serve(sock, server), "jarvis-minecraft-local-ipc");
            worker.setDaemon(true);
            worker.start();
            AiCompanion.LOGGER.info("JARVIS bridge listening on loopback port {}", port);
        } catch (Exception ex) {
            AiCompanion.LOGGER.error("JARVIS bridge unavailable; legacy gameplay remains active", ex);
            stop();
        }
    }

    private static synchronized void stop() {
        ServerSocket old = listener;
        listener = null;
        running = null;
        secret = null;
        allowedWorld = null;
        journal = null;
        seen.clear();
        tasks.clear();
        safetyStopped.clear();
        if (old != null) try { old.close(); } catch (Exception ignored) {}
    }

    private static void serve(ServerSocket sock, MinecraftServer server) {
        while (!sock.isClosed() && running == server) {
            try (Socket client = sock.accept()) {
                client.setSoTimeout(4000);
                client.setTcpNoDelay(true);
                byte[] frameBytes = readLine(client.getInputStream());
                JsonObject request = JsonParser.parseString(new String(frameBytes, StandardCharsets.UTF_8)).getAsJsonObject();
                String payload = request.get("payload").getAsString();
                String mac = request.get("mac").getAsString();
                String key = secret;
                if (key == null || payload == null || !payload.matches("[A-Za-z0-9_-]{1,87000}")
                        || !validMac(key, payload, mac)) continue;
                byte[] raw = java.util.Base64.getUrlDecoder().decode(payload);
                if (raw.length > LIMIT || !java.util.Base64.getUrlEncoder().withoutPadding()
                        .encodeToString(raw).equals(payload)) continue;
                JsonObject body = JsonParser.parseString(new String(raw, StandardCharsets.UTF_8)).getAsJsonObject();
                // Identity, replay protection, and game access happen ONLY on the server thread.
                CompletableFuture<JsonObject> reply = new CompletableFuture<>();
                server.execute(() -> {
                    try { reply.complete(handle(server, body)); }
                    catch (Throwable t) { reply.completeExceptionally(t); }
                });
                JsonObject answer = reply.get(2500, TimeUnit.MILLISECONDS);
                String responsePayload = java.util.Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(answer.toString().getBytes(StandardCharsets.UTF_8));
                JsonObject wire = new JsonObject();
                wire.addProperty("payload", responsePayload);
                wire.addProperty("mac", sign(key, responsePayload));
                byte[] bytes = (wire.toString() + "\n").getBytes(StandardCharsets.UTF_8);
                if (bytes.length <= LIMIT) client.getOutputStream().write(bytes);
            } catch (Exception ex) {
                if (!sock.isClosed()) AiCompanion.LOGGER.debug("JARVIS bridge rejected/closed a request: {}", ex.toString());
            }
        }
    }

    private static byte[] readLine(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (int i = 0; i <= LIMIT; i++) {
            int b = in.read();
            if (b < 0) throw new IllegalArgumentException("closed");
            if (b == '\n') return out.toByteArray();
            if (b == '\r' || i == LIMIT) throw new IllegalArgumentException("oversized/invalid");
            out.write(b);
        }
        throw new IllegalArgumentException("oversized");
    }

    private static String sign(String key, String body) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return java.util.HexFormat.of().formatHex(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
    }
    private static boolean validMac(String key, String body, String received) throws Exception {
        if (received == null || !received.matches("[a-f0-9]{64}")) return false;
        return MessageDigest.isEqual(java.util.HexFormat.of().parseHex(sign(key, body)),
                java.util.HexFormat.of().parseHex(received));
    }
    private static String field(JsonObject obj, String key) {
        return obj.get(key).getAsString();
    }
    private static UUID id(JsonObject obj, String key) {
        return UUID.fromString(field(obj, key));
    }

    private static JsonObject handle(MinecraftServer server, JsonObject b) throws Exception {
        if (b.get("version").getAsInt() != 1) throw new IllegalArgumentException("protocol-version");
        long now = System.currentTimeMillis();
        long issued = b.get("issuedAt").getAsLong();
        if (Math.abs(now-issued) > SKEW_MS) throw new IllegalArgumentException("stale");
        String nonce = field(b, "nonce");
        if (!nonce.matches("[a-f0-9]{32}")) throw new IllegalArgumentException("nonce");
        Iterator<Map.Entry<String, Long>> it = seen.entrySet().iterator();
        while (it.hasNext()) if (now - it.next().getValue() > SKEW_MS * 2) it.remove();
        if (seen.size() >= 4096) throw new IllegalArgumentException("replay-capacity");
        if (seen.putIfAbsent(nonce, now) != null) throw new IllegalArgumentException("replay");
        UUID taskId = id(b, "taskId");
        UUID idempotency = id(b, "idempotencyKey");
        String worldId = field(b, "worldId");
        if (!worldId.equals(allowedWorld)) throw new IllegalArgumentException("world-denied");
        String op = field(b, "operation");
        JsonObject guardian = b.getAsJsonObject("guardian");
        if (guardian == null || !guardian.get("approved").getAsBoolean() ||
                !taskId.equals(id(guardian,"taskId")) ||
                !worldId.equals(field(guardian,"worldId")) ||
                !op.equals(field(guardian,"operation"))) throw new IllegalArgumentException("guardian-denied");
        UUID guardianReceipt = id(guardian,"receiptId");
        UUID authorizedCoreTask = id(guardian,"coreTaskId");
        int budget = b.get("budgetMs").getAsInt();
        if (budget < 100 || budget > 30000) throw new IllegalArgumentException("budget");
        JsonObject args = b.getAsJsonObject("arguments");
        if (args == null) throw new IllegalArgumentException("args");
        UUID ownerId = id(args,"ownerUuid");
        UUID companionId = id(args,"companionUuid");
        // Two separate local-environment owner/companion bindings prevent a
        // stolen client envelope from selecting a different player's entity.
        if(!ownerId.toString().equalsIgnoreCase(System.getenv("JARVIS_MC_BRIDGE_OWNER_UUID")) ||
           !companionId.toString().equalsIgnoreCase(System.getenv("JARVIS_MC_BRIDGE_COMPANION_UUID")))
            throw new IllegalArgumentException("server-owner-or-companion-config-mismatch");
        JarvisNativeJournal ledger=journal;
        if (ledger==null) throw new IllegalStateException("native-ledger-not-initialized");
        net.minecraft.server.network.ServerPlayerEntity owner=
            server.getPlayerManager().getPlayer(ownerId);
        if (owner == null) throw new IllegalArgumentException("owner-offline");
        CompanionEntity companion = null;
        // worldId is the authorized LOCAL server-realm identity, not a
        // promise that a companion stays in the Overworld. Never lose E-stop
        // or readback when the same owner-bound companion enters Nether/End.
        for (ServerWorld world : server.getWorlds()) {
            String dimension=world.getRegistryKey().getValue().toString();
            if (!java.util.Set.of("minecraft:overworld","minecraft:the_nether",
                    "minecraft:the_end").contains(dimension)) continue;
            for (Entity entity : world.iterateEntities()) {
                if(entity.getUuid().equals(companionId) &&
                   !(entity instanceof CompanionEntity))
                    throw new IllegalArgumentException("configured-companion-uuid-collision");
                if(entity instanceof CompanionEntity c && c.getUuid().equals(companionId)){
                    if(!ownerId.equals(c.getOwnerUuid()) || !c.isAlive())
                        throw new IllegalArgumentException("companion-uuid-owned-by-other-or-dead");
                    companion=c;
                    break;
                }
            }
        }
        if("spawn".equals(op)){
            if(!"1".equals(System.getenv("JARVIS_MC_BRIDGE_SPAWN_ENABLED")))
                throw new IllegalArgumentException("native-spawn-owner-opt-in-disabled");
            // Spawn is a SEPARATE explicit owner request; the ordinary Core
            // JOIN/observe route never reaches this branch. It cannot create
            // a second bot, adopt an unowned one or choose a UUID on the fly.
            if(companion!=null)throw new IllegalArgumentException("companion-already-spawned");
            if(!owner.isAlive())throw new IllegalArgumentException("owner-not-in-live-world");
            if(journal.hasSpawnHistory(companionId))
                throw new IllegalArgumentException("prior-spawn-history-must-reconcile-existing-world");
            if(safetyStopped.contains(companionId)||
               journal.hasUnresolved(companionId) || tasks.size()>=2048)
                throw new IllegalArgumentException("native-spawn-reconciliation-required");
            net.minecraft.server.world.ServerWorld spawnWorld=owner.getServerWorld();
            if(!spawnWorld.getRegistryKey().equals(net.minecraft.world.World.OVERWORLD))
                throw new IllegalArgumentException("spawn-owner-must-be-in-overworld");
            for(ServerWorld world:server.getWorlds()){
                for(Entity entity:world.iterateEntities()){
                    if(entity instanceof CompanionEntity existing &&
                       ownerId.equals(existing.getOwnerUuid()) && existing.isAlive())
                        throw new IllegalArgumentException("owner-already-has-companion");
                }
            }
            BlockPos ownerPos=owner.getBlockPos();
            BlockPos spawnPos=null;
            for(BlockPos offset:java.util.List.of(ownerPos.east(),ownerPos.west(),
                    ownerPos.north(),ownerPos.south())){
                if(!loaded(spawnWorld,offset) || !loaded(spawnWorld,offset.up()) ||
                   !loaded(spawnWorld,offset.down()))continue;
                if(spawnWorld.getBlockState(offset).isAir() &&
                   spawnWorld.getBlockState(offset.up()).isAir() &&
                   spawnWorld.getBlockState(offset.down()).isSolidBlock(spawnWorld,offset.down())){
                    spawnPos=offset;break;
                }
            }
            if(spawnPos==null)throw new IllegalArgumentException("no-safe-loaded-owner-adjacent-spawn");
            // Journal BEFORE world mutation. If any subsequent call fails,
            // the owner must explicitly reconcile; do not quietly spawn again.
            journal.admit(taskId,authorizedCoreTask,companionId,worldId,op);
            try {
                CompanionEntity created=new CompanionEntity(AiCompanion.COMPANION,spawnWorld);
                created.setUuid(companionId); // immutable after first spawn
                var entry=com.neovetta.aicompanion.CompanionConfig.defaultEntry();
                created.applyRosterEntry(entry);
                created.refreshPositionAndAngles(spawnPos.getX()+0.5,
                    spawnPos.getY(),spawnPos.getZ()+0.5,owner.getYaw(),0f);
                if(!spawnWorld.spawnEntity(created))
                    throw new IllegalStateException("game-server-rejected-companion-spawn");
                created.initBrain(com.neovetta.aicompanion.CompanionConfig.character(entry),owner);
                if(!created.isAlive() || !ownerId.equals(created.getOwnerUuid()) ||
                    !companionId.equals(created.getUuid()) || created.getController()==null)
                    throw new IllegalStateException("spawn-owner-controller-readback-failed");
                journal.settle(taskId,"OBSERVED");
                companion=created;
            } catch(Exception ex){
                try{journal.settle(taskId,"EFFECT_UNKNOWN");}
                catch(Exception ignored){/* preserve ADMITTED quarantine */}
                throw new IllegalStateException("native-spawn-effect-unknown-reconciliation-required",ex);
            }
        }
        if (companion == null || companion.getController() == null) throw new IllegalArgumentException("companion-unavailable");
        AltoClefController ctrl = companion.getController();
        String status;
        String note;
        JsonArray viewedOffers=null;
        Integer inspectedVillagerId=null;
        JsonObject inspectedBlock=null;
        switch (op) {
            case "spawn" -> {
                status="observed";
                note="owner-authorized-native-companion-created-and-paired";
            }
            case "inspect_block" -> {
                BlockPos selected=position(args);
                ServerWorld level=(ServerWorld)companion.getWorld();
                if(companion.getBlockPos().getSquaredDistance(selected)>16*16 ||
                   !loaded(level,selected))
                    throw new IllegalArgumentException("block-not-nearby-or-loaded");
                BlockState state=level.getBlockState(selected);
                JsonObject block=new JsonObject();
                block.addProperty("x",selected.getX());
                block.addProperty("y",selected.getY());
                block.addProperty("z",selected.getZ());
                block.addProperty("name",Registries.BLOCK.getId(state.getBlock()).toString());
                if(state.contains(Properties.OPEN))
                    block.addProperty("open",state.get(Properties.OPEN));
                if(state.contains(Properties.POWERED))
                    block.addProperty("powered",state.get(Properties.POWERED));
                inspectedBlock=block;
                status="observed";
                note="server-observed-loaded-block-no-mutation";
            }
            case "villager_offers" -> {
                int targetId=args.get("entityId").getAsInt();
                VillagerEntity selected=null;
                for(Entity candidate:((ServerWorld)companion.getWorld()).iterateEntities()) {
                    if(candidate instanceof VillagerEntity v && v.getId()==targetId &&
                        v.isAlive() && v.squaredDistanceTo(companion)<=10*10) {
                        selected=v;break;
                    }
                }
                if(selected==null)throw new IllegalArgumentException("villager-not-observed");
                JsonArray liveOffers=new JsonArray();
                net.minecraft.village.TradeOfferList offers=selected.getOffers();
                for(int i=0;i<Math.min(8,offers.size());i++) {
                    net.minecraft.village.TradeOffer offer=offers.get(i);
                    JsonObject details=new JsonObject();
                    details.addProperty("index",i);
                    ItemStack first=offer.getAdjustedFirstBuyItem();
                    ItemStack second=offer.getSecondBuyItem();
                    ItemStack output=offer.getSellItem();
                    details.addProperty("firstItem",Registries.ITEM.getId(first.getItem()).toString());
                    details.addProperty("firstCount",first.getCount());
                    details.addProperty("secondItem",second.isEmpty()?"":Registries.ITEM.getId(second.getItem()).toString());
                    details.addProperty("secondCount",second.getCount());
                    details.addProperty("outputItem",Registries.ITEM.getId(output.getItem()).toString());
                    details.addProperty("outputCount",output.getCount());
                    details.addProperty("disabled",offer.isDisabled());
                    details.addProperty("uses",offer.getUses());
                    details.addProperty("maxUses",offer.getMaxUses());
                    liveOffers.add(details);
                }
                viewedOffers=liveOffers;
                inspectedVillagerId=targetId;
                status="observed";note="server-observed-trading-options-no-trade-performed";
            }
            case "inspect" -> { status = "observed"; note = "snapshot-only"; }
            case "status" -> {
                Run previous = tasks.get(taskId);
                if (previous == null || !previous.companion.equals(companionId) ||
                        !previous.coreTaskId.equals(authorizedCoreTask)) {
                    status = "failed"; note = "no-owned-task";
                } else { status = previous.state; note = previous.note; }
            }
            case "stop" -> {
                String scope=field(args,"scope");
                if (!scope.equals("task") && !scope.equals("companion"))
                    throw new IllegalArgumentException("stop-scope");
                if (scope.equals("task")) {
                    boolean matched=false;
                    for (Run run : tasks.values()) {
                        if (run.companion.equals(companionId) &&
                            run.coreTaskId.equals(authorizedCoreTask) &&
                            "running".equals(run.state)) { matched=true;break; }
                    }
                    if (!matched) throw new IllegalArgumentException("no-running-task-for-cancellation");
                }
                ctrl.stop();
                safetyStopped.add(companionId);
                boolean allRecorded=true;
                for (Map.Entry<UUID,Run> entry : tasks.entrySet()) {
                    Run run=entry.getValue();
                    if (companionId.equals(run.companion) && "running".equals(run.state)) {
                        try {
                            journal.settle(entry.getKey(),"CANCELLED");
                            run.state="cancelled";
                            run.note="owner-emergency-stop-with-durable-receipt";
                        } catch (Exception ex) {
                            allRecorded=false;
                            run.state="failed";
                            run.note="stop-sent-but-native-journal-outcome-unknown";
                        }
                        run.settledAt=now;
                    }
                }
                status=allRecorded?"cancelled":"failed";
                note=allRecorded?"companion-emergency-stop-latched":
                    "stop-sent-but-durable-state-unknown";
            }
            case "resume" -> {
                if (tasks.values().stream().anyMatch(r ->
                        r.companion.equals(companionId) && "running".equals(r.state)))
                    throw new IllegalArgumentException("active-task-reconciliation-required");
                if (!safetyStopped.contains(companionId) && !journal.hasUnresolved(companionId))
                    throw new IllegalArgumentException("no-recovery-latch");
                journal.reconcileAfterExplicitOwnerResume(companionId);
                safetyStopped.remove(companionId);
                if (journal.hasUnresolved(companionId)) throw new IllegalStateException("resume-not-durable");
                ctrl.getTaskRunner().enable();
                status="observed";
                note="owner-resumed-ready-for-new-authorized-tasks";
            }
            case "cancel" -> {
                Run previous = tasks.get(taskId);
                if (previous == null || !previous.companion.equals(companionId) ||
                        !previous.coreTaskId.equals(authorizedCoreTask))
                    throw new IllegalArgumentException("task-mismatch");
                ctrl.cancelUserTask();
                try {
                    journal.settle(taskId,"CANCELLED");
                    previous.state="cancelled";
                    previous.note="cancel-sent-and-durably-recorded";
                } catch (Exception ex) {
                    previous.state="failed";
                    previous.note="cancel-sent-but-journal-uncertain";
                }
                previous.settledAt=now;
                status=previous.state;
                note=previous.note;
            }
            case "trade" -> {
                if(safetyStopped.contains(companionId)||journal.hasUnresolved(companionId))
                    throw new IllegalArgumentException("native-trade-recovery-required");
                if(tasks.containsKey(taskId)||tasks.size()>=2048)
                    throw new IllegalArgumentException("native-trade-replay-or-capacity");
                for(Run live:tasks.values()){
                    if(live.companion.equals(companionId) && "running".equals(live.state))
                        throw new IllegalArgumentException("companion-busy");
                }
                // The Java helper re-reads the exact adjusted, live villager
                // offer inside this server tick; a changed price is denied.
                int targetId=args.get("entityId").getAsInt();
                int index=args.get("offerIndex").getAsInt();
                int times=args.get("times").getAsInt();
                if(targetId<0||targetId>200000||index<0||index>7||times<1||times>4)
                    throw new IllegalArgumentException("native-trade-bounds");
                Run record=new Run(companionId,authorizedCoreTask,ctrl,companion,budget);
                // Commit intent BEFORE spending a single currency item.
                journal.admit(taskId,authorizedCoreTask,companionId,worldId,op);
                tasks.put(taskId,record);
                try {
                    JarvisNativeVillagerTrade.Result result=
                        JarvisNativeVillagerTrade.execute(companion,args);
                    record.trade=result;
                    if(!result.verified)
                        throw new IllegalStateException("native-trade-postcondition-mismatch");
                    journal.settle(taskId,"OBSERVED");
                    record.state="observed";
                    record.note="villager-uses-and-inventory-verified";
                } catch(Exception ex) {
                    try{journal.settle(taskId,"EFFECT_UNKNOWN");}
                    catch(Exception ignored){/* preserve ADMITTED quarantine */}
                    record.state="failed";
                    record.note="native-trade-effect-unknown-reconciliation-required";
                }
                record.settledAt=System.currentTimeMillis();
                status=record.state;
                note=record.note;
            }
            case "transfer" -> {
                if (safetyStopped.contains(companionId) || journal.hasUnresolved(companionId))
                    throw new IllegalArgumentException("companion-needs-recovery");
                if (tasks.containsKey(taskId) || tasks.size()>=2048)
                    throw new IllegalArgumentException("native-task-capacity-or-replay");
                for (Run run : tasks.values())
                    if(run.companion.equals(companionId) && "running".equals(run.state))
                        throw new IllegalArgumentException("companion-busy");
                String goal=field(args,"goal"),item=field(args,"item");
                String direction=field(args,"direction");
                int count=args.get("targetCount").getAsInt();
                if(!goal.equals("transfer") || count<1 || count>64)
                    throw new IllegalArgumentException("invalid-owner-transfer");
                BlockPos pos=position(args);
                Run record=new Run(companionId,authorizedCoreTask,ctrl,companion,budget);
                record.transferItem=item;
                record.transferDirection=direction;
                record.transferCount=count;
                // Admission before either inventory changes. No automatic
                // replay is allowed after partial mutation or dropped receipt.
                journal.admit(taskId,authorizedCoreTask,companionId,worldId,op);
                tasks.put(taskId,record);
                try {
                    JarvisNativeInventoryTransfer.Result moved=
                        JarvisNativeInventoryTransfer.move(companion,pos,item,count,direction);
                    record.transferPlayerBefore=moved.beforePlayer;
                    record.transferPlayerAfter=moved.afterPlayer;
                    record.transferContainerBefore=moved.beforeContainer;
                    record.transferContainerAfter=moved.afterContainer;
                    journal.settle(taskId,"OBSERVED");
                    record.transferDone=true;
                    record.state="observed";
                    record.note="server-inventory-conservation-and-durable-settlement";
                } catch (Exception ex) {
                    try {journal.settle(taskId,"EFFECT_UNKNOWN");}
                    catch (Exception ignored) { /* preserve ADMITTED quarantine */ }
                    record.state="failed";
                    record.note="native-transfer-effect-unknown-reconciliation-required";
                }
                record.settledAt=System.currentTimeMillis();
                status=record.state;
                note=record.note;
            }
            case "gather", "mine", "craft", "travel", "equip", "build", "dig", "combat", "interact", "endgame", "farm", "smelt", "sequence" -> {
                if (safetyStopped.contains(companionId)) throw new IllegalArgumentException("owner-safety-stop-latched");
                if (tasks.containsKey(taskId)) throw new IllegalArgumentException("duplicate-task");
                if (tasks.size() >= 2048) throw new IllegalArgumentException("task-capacity");
                for (Run existing : tasks.values()) {
                    if (existing.companion.equals(companionId) && "running".equals(existing.state))
                        throw new IllegalArgumentException("companion-busy");
                }
                long runtimeBudget = budget;
                if ("endgame".equals(op) || "farm".equals(op) || "smelt".equals(op) || "sequence".equals(op)) {
                    int duration = args.get("durationSeconds").getAsInt();
                    if (duration < 10 || duration > 43200)
                        throw new IllegalArgumentException("mission-duration-out-of-range");
                    runtimeBudget = duration * 1000L;
                }
                Run run = new Run(companionId, authorizedCoreTask, ctrl, companion, runtimeBudget);
                Task task;
                if ("endgame".equals(op)) {
                    String goal=field(args,"goal");
                    JarvisEndgameTask mission=new JarvisEndgameTask(companion,goal);
                    run.endgame=mission;
                    task=mission;
                } else if ("sequence".equals(op)) {
                    String goal=field(args,"goal");
                    if(!"sequence".equals(goal))
                        throw new IllegalArgumentException("not-owner-sequence");
                    JarvisNativeSequenceTask sequenceTask=new JarvisNativeSequenceTask(
                        companion,args.getAsJsonArray("steps"));
                    run.sequence=sequenceTask;
                    task=sequenceTask;
                } else if ("smelt".equals(op)) {
                    String goal=field(args,"goal");
                    String output=field(args,"item");
                    int count=args.get("targetCount").getAsInt();
                    if (!"smelt".equals(goal)||count<1||count>16 ||
                            !SMELT_RECIPES.containsKey(output))
                        throw new IllegalArgumentException("smelting-goal-denied");
                    Item out=Registries.ITEM.get(new Identifier("minecraft",output));
                    if(out==Items.AIR)throw new IllegalArgumentException("unknown-smelting-output");
                    int held=countItem(companion,output);
                    if(held>192 || held+count>256)
                        throw new IllegalArgumentException("smelt-output-budget");
                    run.item=output;run.initialCount=held;run.addedCount=count;
                    run.smeltGoal=goal;run.smeltOutput=output;run.smeltTarget=count;
                    Task operationTask=new SmeltInFurnaceTask(new SmeltTarget(
                        new ItemTarget(out,held+count),
                        new ItemTarget(SMELT_RECIPES.get(output),count)));
                    task=operationTask;
                } else if ("farm".equals(op)) {
                    String goal=field(args,"goal");
                    String crop=field(args,"crop");
                    int width=args.get("width").getAsInt();
                    int depth=args.get("depth").getAsInt();
                    int requested=args.get("targetCount").getAsInt();
                    if (!Set.of("farm_wheat","farm_crop").contains(goal) ||
                            !Set.of("wheat","carrots","potatoes").contains(crop) ||
                            (!goal.equals("farm_wheat") && crop.equals("wheat")) ||
                            (goal.equals("farm_wheat") && !crop.equals("wheat")) ||
                            width<1||width>4||depth<1||depth>4||
                            requested<1||requested>16)
                        throw new IllegalArgumentException("invalid-farm-spec");
                    BlockPos origin=position(args);
                    if (!withinReach(companion,origin))
                        throw new IllegalArgumentException("farm-origin-not-nearby");
                    Block block=crop.equals("wheat")?Blocks.WHEAT:
                        crop.equals("carrots")?Blocks.CARROTS:Blocks.POTATOES;
                    Item item=crop.equals("wheat")?Items.WHEAT:
                        crop.equals("carrots")?Items.CARROT:Items.POTATO;
                    Item seed=crop.equals("wheat")?Items.WHEAT_SEEDS:item;
                    for(int dx=0;dx<width;dx++)for(int dz=0;dz<depth;dz++) {
                        BlockPos pos=origin.add(dx,0,dz);
                        if(!loaded((ServerWorld)companion.getWorld(),pos) ||
                                !companion.getWorld().getBlockState(pos.down()).isOf(Blocks.FARMLAND))
                            throw new IllegalArgumentException("field-unloaded-or-not-farmland");
                        Block existing=companion.getWorld().getBlockState(pos).getBlock();
                        if(existing!=block && existing!=Blocks.AIR)
                            throw new IllegalArgumentException("owner-field-has-unrelated-block");
                        run.cropCells.add(pos);
                    }
                    run.cropGoal=goal;
                    run.cropKind=crop;
                    run.cropBlock=block;
                    run.cropItem=Registries.ITEM.getId(item).getPath();
                    run.cropInitialCount=countItem(companion,run.cropItem);
                    run.cropTargetCount=requested;
                    int absoluteTarget=run.cropInitialCount+requested;
                    if(absoluteTarget>256) throw new IllegalArgumentException("farm-quantity-over-budget");
                    task=new CollectCropTask(
                        new ItemTarget(item,absoluteTarget),
                        new Block[]{block},
                        new Item[]{seed},
                        run.cropCells::contains);
                    sampleFarmCells(run);
                } else if ("travel".equals(op)) {
                    BlockPos pos = position(args);
                    if (companion.getBlockPos().getSquaredDistance(pos) > 160.0 * 160.0)
                        throw new IllegalArgumentException("travel-range");
                    run.arrival = pos;
                    task = new GetToBlockTask(pos);
                } else if ("gather".equals(op) || "mine".equals(op) || "craft".equals(op)) {
                    String item = field(args,"item");
                    int count = args.get("count").getAsInt();
                    if (!item.matches("[a-z0-9_]{1,64}") || count < 1 || count > 64
                            || !TaskCatalogue.taskExists(item))
                        throw new IllegalArgumentException("task-target-denied");
                    int current = countItem(companion, item);
                    if (current > 192 || current + count > 256)
                        throw new IllegalArgumentException("target-over-budget");
                    run.item = item;
                    run.initialCount = current;
                    run.addedCount = count;
                    task = TaskCatalogue.getItemTask(item, current + count);
                } else if ("equip".equals(op)) {
                    String itemName=field(args,"item"), destination=field(args,"destination");
                    if (!itemName.matches("[a-z0-9_]{1,64}") ||
                            !(destination.equals("hand") || destination.equals("head") ||
                            destination.equals("torso") || destination.equals("legs") ||
                            destination.equals("feet")))
                        throw new IllegalArgumentException("equipment-denied");
                    Item item=Registries.ITEM.get(new Identifier("minecraft",itemName));
                    if (item==Items.AIR) throw new IllegalArgumentException("unknown-equipment");
                    boolean armor=!"hand".equals(destination);
                    if (armor && (!(item instanceof net.minecraft.item.ArmorItem) ||
                            !(destination.equals("head") && itemName.endsWith("_helmet") ||
                              destination.equals("torso") && itemName.endsWith("_chestplate") ||
                              destination.equals("legs") && itemName.endsWith("_leggings") ||
                              destination.equals("feet") && itemName.endsWith("_boots"))))
                        throw new IllegalArgumentException("armor-slot-mismatch");
                    if (!armor && !(itemName.endsWith("_sword") || itemName.endsWith("_pickaxe") ||
                            itemName.endsWith("_axe") || itemName.equals("bow") || itemName.equals("crossbow") || itemName.equals("trident")))
                        throw new IllegalArgumentException("not-weapon-or-tool");
                    run.equipDestination=destination;
                    run.equipItem=itemName;
                    task=armor ? new EquipArmorTask(item) : new HoldItemTask(new ItemTarget(item));
                } else if ("build".equals(op)) {
                    BlockPos pos=position(args);
                    String blockName=field(args,"block");
                    if (!BUILD_BLOCKS.contains(blockName) || !withinReach(companion,pos) ||
                            !loaded((ServerWorld)companion.getWorld(),pos))
                        throw new IllegalArgumentException("build-location-or-material-denied");
                    Block block=Registries.BLOCK.get(new Identifier("minecraft",blockName));
                    if (block==Blocks.AIR || !companion.getWorld().getBlockState(pos).isAir() ||
                            countItem(companion,blockName)<1)
                        throw new IllegalArgumentException("build-precondition");
                    run.blockPos=pos;
                    run.blockId=blockName;
                    task=new PlaceBlockTask(pos,block);
                } else if ("interact".equals(op)) {
                    BlockPos pos=position(args);
                    ServerWorld level=(ServerWorld)companion.getWorld();
                    if(!withinReach(companion,pos) || !loaded(level,pos))
                        throw new IllegalArgumentException("interact-target-not-observed");
                    BlockState state=level.getBlockState(pos);
                    String blockName=Registries.BLOCK.getId(state.getBlock()).getPath();
                    boolean toggle=blockName.endsWith("_door") ||
                        blockName.endsWith("_trapdoor") || blockName.endsWith("_button") ||
                        blockName.equals("lever");
                    if(!toggle || (!state.contains(Properties.OPEN) &&
                                   !state.contains(Properties.POWERED)))
                        throw new IllegalArgumentException("unsupported-interaction");
                    run.blockPos=pos;
                    run.blockId=blockName;
                    run.interactiveBefore=interactionState(state);
                    task=new InteractWithBlockTask(ItemTarget.EMPTY,pos,false);
                } else if ("dig".equals(op)) {
                    BlockPos pos=position(args);
                    if (!withinReach(companion,pos) || !loaded((ServerWorld)companion.getWorld(),pos))
                        throw new IllegalArgumentException("dig-location");
                    String before=Registries.BLOCK.getId(companion.getWorld().getBlockState(pos).getBlock()).getPath();
                    if (!MINE_BLOCKS.contains(before))
                        throw new IllegalArgumentException("dig-block-denied");
                    run.blockPos=pos;
                    run.expectAir=true;
                    run.blockId=before;
                    task=new DestroyBlockTask(pos);
                } else { // "combat" is a loaded, explicitly hostile, nearby mob only
                    int targetId=args.get("entityId").getAsInt();
                    Entity target=null;
                    for (Entity entity : ((ServerWorld)companion.getWorld()).iterateEntities()) {
                        if (entity.getId()==targetId) {target=entity;break;}
                    }
                    if (!(target instanceof HostileEntity) || !target.isAlive() ||
                            target.getPos().squaredDistanceTo(companion.getPos()) > 12*12 ||
                            !COMBAT_MOBS.contains(Registries.ENTITY_TYPE.getId(target.getType()).getPath()))
                        throw new IllegalArgumentException("combat-target-denied");
                    run.combatTarget=target;
                    task=new KillEntityTask(target);
                }
                if (task == null) throw new IllegalArgumentException("missing-task");
                // Journal-before-effect. A crash after this write leaves an
                // explicit quarantine rather than a silently retried action.
                journal.admit(taskId,authorizedCoreTask,companionId,worldId,op);
                tasks.put(taskId, run);
                try {
                ctrl.runUserTask(task, () -> {
                    if (!"running".equals(run.state)) return;
                    boolean added = run.item != null &&
                            countItem(run.entity,run.item)>=run.initialCount+run.addedCount;
                    boolean arrived = run.arrival != null &&
                            run.entity.getBlockPos().isWithinDistance(run.arrival,2.5);
                    boolean equipped = run.equipItem != null && isEquipped(run.entity,
                            run.equipItem, run.equipDestination);
                    boolean changedBlock = run.interactiveBefore == null && run.blockPos != null &&
                            loaded((ServerWorld)run.entity.getWorld(),run.blockPos) &&
                            (run.expectAir ? run.entity.getWorld().getBlockState(run.blockPos).isAir() :
                            run.blockId.equals(Registries.BLOCK.getId(run.entity.getWorld()
                               .getBlockState(run.blockPos).getBlock()).getPath()));
                    boolean interacted = run.interactiveBefore != null &&
                            run.blockPos != null &&
                            loaded((ServerWorld)run.entity.getWorld(),run.blockPos) &&
                            interactionState(run.entity.getWorld().getBlockState(run.blockPos))
                                != run.interactiveBefore;
                    boolean killed = run.combatTarget != null && !run.combatTarget.isAlive();
                    boolean farmProved=run.cropGoal!=null &&
                            run.harvestedCells>=run.cropTargetCount &&
                            countItem(run.entity,run.cropItem)>=run.cropInitialCount+run.cropTargetCount;
                    boolean proved = added||arrived||equipped||changedBlock||interacted||killed ||farmProved||
                            (run.endgame != null && run.endgame.completed()) ||
                            (run.sequence != null && run.sequence.isFinished());
                    try {
                        // Postcondition failure is EFFECT_UNKNOWN, not a
                        // claim of zero side effects or clean completion.
                        journal.settle(taskId,proved?"OBSERVED":"EFFECT_UNKNOWN");
                        run.state=proved?"observed":"failed";
                        run.note=proved?"server-postcondition-and-durable-receipt":
                            "engine-done-effect-requires-reconciliation";
                    } catch (Exception ex) {
                        run.state="failed";
                        run.note="effect-unknown-journal-settlement-failed";
                    }
                    run.settledAt=System.currentTimeMillis();
                });
                } catch (RuntimeException ex) {
                    run.state="failed";
                    run.note="native-dispatch-may-have-started";
                    run.settledAt=System.currentTimeMillis();
                    // Leave the journal in ADMITTED quarantine. No replay.
                    throw ex;
                }
                status = "accepted";
                note = "dispatched-not-verified";
            }
            default -> { status = "failed"; note = "unsupported-operation-fail-closed"; }
        }
        JsonObject snapshot = snapshot(companion);
        if(inspectedBlock!=null)snapshot.add("inspectedBlock",inspectedBlock);
        if(viewedOffers!=null){
            snapshot.add("villagerOffers",viewedOffers);
            snapshot.addProperty("inspectedVillagerId",inspectedVillagerId);
        }
        snapshot.addProperty("safetyStopped",safetyStopped.contains(companionId));
        snapshot.addProperty("recoveryRequired",journal.hasUnresolved(companionId));
        for (Run candidate : tasks.values()) {
            if (!candidate.companion.equals(companionId) ||
                    !candidate.coreTaskId.equals(authorizedCoreTask) ||
                    (candidate.endgame == null && candidate.cropGoal == null &&
                     candidate.smeltGoal == null && candidate.sequence == null &&
                     candidate.transferItem == null && candidate.trade == null)) continue;
            if(candidate.trade!=null) {
                JarvisNativeVillagerTrade.Result result=candidate.trade;
                snapshot.addProperty("nativeGoal","trade");
                JsonObject summary=new JsonObject();
                summary.addProperty("goal","trade");
                summary.addProperty("status",candidate.state.equals("observed") &&
                    result.verified?"complete":candidate.state);
                summary.addProperty("since",candidate.since);
                summary.addProperty("entityId",result.villagerId);
                summary.addProperty("tradeIndex",result.offerIndex);
                summary.addProperty("times",result.times);
                summary.addProperty("outputItem",result.outputItem);
                summary.addProperty("outputCount",result.outputCount*result.times);
                JsonObject milestones=new JsonObject();
                milestones.addProperty("tradeDone",candidate.state.equals("observed") &&
                    result.verified);
                milestones.addProperty("usesBefore",result.usesBefore);
                milestones.addProperty("usesAfter",result.usesAfter);
                milestones.addProperty("firstItem",result.firstItem);
                milestones.addProperty("firstBefore",result.firstBefore);
                milestones.addProperty("firstAfter",result.firstAfter);
                milestones.addProperty("secondItem",result.secondItem);
                milestones.addProperty("secondBefore",result.secondBefore);
                milestones.addProperty("secondAfter",result.secondAfter);
                milestones.addProperty("outputBefore",result.outputBefore);
                milestones.addProperty("outputAfter",result.outputAfter);
                summary.add("milestones",milestones);
                snapshot.add("missionStatus",summary);
                break;
            }
            if (candidate.transferItem != null) {
                snapshot.addProperty("nativeGoal","transfer");
                JsonObject summary=new JsonObject();
                summary.addProperty("goal","transfer");
                summary.addProperty("status",candidate.transferDone &&
                    candidate.state.equals("observed")?"complete":candidate.state);
                summary.addProperty("since",candidate.since);
                summary.addProperty("item",candidate.transferItem);
                summary.addProperty("operation",candidate.transferDirection);
                summary.addProperty("targetCount",candidate.transferCount);
                JsonObject milestones=new JsonObject();
                milestones.addProperty("transferDone",candidate.transferDone &&
                    candidate.state.equals("observed") &&
                    Math.abs(candidate.transferPlayerAfter-candidate.transferPlayerBefore)
                        == candidate.transferCount &&
                    Math.abs(candidate.transferContainerAfter-candidate.transferContainerBefore)
                        == candidate.transferCount);
                milestones.addProperty("playerBefore",candidate.transferPlayerBefore);
                milestones.addProperty("playerAfter",candidate.transferPlayerAfter);
                milestones.addProperty("containerBefore",candidate.transferContainerBefore);
                milestones.addProperty("containerAfter",candidate.transferContainerAfter);
                summary.add("milestones",milestones);
                snapshot.add("missionStatus",summary);
                break;
            }
            if (candidate.sequence != null) {
                JarvisNativeSequenceTask sequence=candidate.sequence;
                snapshot.addProperty("nativeGoal","sequence");
                JsonObject summary=new JsonObject();
                summary.addProperty("goal","sequence");
                summary.addProperty("status",candidate.state.equals("observed") &&
                    sequence.isFinished()?"complete":candidate.state);
                summary.addProperty("since",candidate.since);
                summary.addProperty("sequenceIndex",sequence.index());
                JsonObject milestones=new JsonObject();
                milestones.addProperty("stagesCompleted",sequence.index());
                milestones.addProperty("stageCount",sequence.total());
                milestones.addProperty("currentStage",sequence.stage());
                summary.add("milestones",milestones);
                snapshot.add("missionStatus",summary);
                break;
            }
            if (candidate.smeltGoal != null) {
                snapshot.addProperty("nativeGoal","smelt");
                JsonObject summary=new JsonObject();
                summary.addProperty("goal","smelt");
                summary.addProperty("status",candidate.state.equals("observed")?
                    "complete":candidate.state);
                summary.addProperty("since",candidate.since);
                summary.addProperty("item",candidate.smeltOutput);
                summary.addProperty("targetCount",candidate.smeltTarget);
                JsonObject milestones=new JsonObject();
                int fresh=Math.max(0,countItem(companion,candidate.smeltOutput)
                    -candidate.initialCount);
                // SmeltInFurnaceTask is the sole native task used for this run.
                // Its callback + newly held output are required; a callback
                // alone never claims physical smelting success.
                milestones.addProperty("smeltedOutput",
                    candidate.state.equals("observed")?
                        Math.min(candidate.smeltTarget,fresh):0);
                summary.add("milestones",milestones);
                snapshot.add("missionStatus",summary);
                break;
            }
            if (candidate.cropGoal != null) {
                snapshot.addProperty("nativeGoal",candidate.cropGoal);
                JsonObject summary=new JsonObject();
                summary.addProperty("goal",candidate.cropGoal);
                summary.addProperty("status",candidate.state.equals("observed")?
                    "complete":candidate.state);
                summary.addProperty("since",candidate.since);
                summary.addProperty("crop",candidate.cropKind);
                summary.addProperty("targetCount",candidate.cropTargetCount);
                JsonObject milestone=new JsonObject();
                milestone.addProperty("harvestedCropCount",candidate.harvestedCells);
                milestone.addProperty("wheatHarvested",candidate.harvestedCells);
                milestone.addProperty("physicalOutputCount",
                    countItem(companion,candidate.cropItem));
                summary.add("milestones",milestone);
                snapshot.add("missionStatus",summary);
                break;
            }
            JarvisEndgameTask mission=candidate.endgame;
            snapshot.addProperty("nativeGoal",mission.goal());
            snapshot.addProperty("dragonDeadObserved",mission.dragonKilled());
            snapshot.addProperty("exitPortalPresent",mission.exitPortalObserved());
            snapshot.addProperty("heldNetheriteSword",
                    "netherite_sword".equals(snapshot.get("mainHand").getAsString()));
            JsonObject summary=new JsonObject();
            summary.addProperty("goal",mission.goal());
            summary.addProperty("status",candidate.state.equals("observed") &&
                    mission.completed()?"complete":candidate.state);
            summary.addProperty("since",candidate.since);
            summary.add("milestones",mission.milestones());
            snapshot.add("missionStatus",summary);
            break;
        }
        Run receiptTask = tasks.get(taskId);
        if (receiptTask != null && receiptTask.companion.equals(companionId)) {
            if (receiptTask.blockPos != null) {
                JsonObject blockProof = new JsonObject();
                BlockPos pos = receiptTask.blockPos;
                blockProof.addProperty("x",pos.getX());
                blockProof.addProperty("y",pos.getY());
                blockProof.addProperty("z",pos.getZ());
                if (loaded((ServerWorld)companion.getWorld(),pos)) {
                    blockProof.addProperty("block",Registries.BLOCK.getId(
                        companion.getWorld().getBlockState(pos).getBlock()).getPath());
                } else blockProof.addProperty("block","chunk-unloaded");
                if (receiptTask.interactiveBefore != null &&
                        loaded((ServerWorld)companion.getWorld(),pos))
                    blockProof.addProperty("interactionChanged",
                        interactionState(companion.getWorld().getBlockState(pos))
                          != receiptTask.interactiveBefore);
                snapshot.add("targetBlock",blockProof);
            }
            if (receiptTask.combatTarget != null)
                snapshot.addProperty("targetAlive",receiptTask.combatTarget.isAlive());
            if (receiptTask.equipItem != null) {
                snapshot.addProperty("targetEquipmentItem",receiptTask.equipItem);
                snapshot.addProperty("targetEquipmentSlot",receiptTask.equipDestination);
                snapshot.addProperty("targetEquipmentObserved",isEquipped(companion,
                    receiptTask.equipItem,receiptTask.equipDestination));
            }
            snapshot.addProperty("nativeTaskNote",receiptTask.note);
        }
        snapshot.addProperty("note", note);
        JsonObject receipt = new JsonObject();
        receipt.addProperty("version",1);
        receipt.addProperty("taskId",taskId.toString());
        receipt.addProperty("idempotencyKey",idempotency.toString());
        receipt.addProperty("nonce",nonce);
        receipt.addProperty("worldId",worldId);
        receipt.addProperty("observedAt",now);
        receipt.addProperty("guardianReceiptId",guardianReceipt.toString());
        receipt.addProperty("coreTaskId",authorizedCoreTask.toString());
        receipt.addProperty("status",status);
        receipt.add("observations",snapshot);
        return receipt;
    }

    private static void sampleFarmCells(Run run) {
        if (run.cropCells.isEmpty() || run.cropBlock==null ||
                !"running".equals(run.state)) return;
        ServerWorld world=(ServerWorld)run.entity.getWorld();
        for(BlockPos pos:run.cropCells) {
            if(!loaded(world,pos)) continue;
            net.minecraft.block.BlockState state=world.getBlockState(pos);
            int age=-1;
            if (state.isOf(run.cropBlock) && run.cropBlock instanceof CropBlock crop)
                age=crop.getAge(state);
            else if (!state.isAir()) age=-2;
            Integer previous=run.lastCropAge.put(pos,age);
            // A mature owner's crop became harvested / replanted. Count only
            // transitions in the exact owner-approved, loaded farmland cells.
            if(previous!=null && previous==7 && age>=-1 && age<7 &&
                    run.harvestedCells<256)
                run.harvestedCells++;
        }
    }

    private static void enforceDeadlines(MinecraftServer server) {
        if (running != server) return;
        long now = System.currentTimeMillis();
        Iterator<Map.Entry<UUID, Run>> it = tasks.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<UUID,Run> entry=it.next();
            Run run = entry.getValue();
            if ("running".equals(run.state)) sampleFarmCells(run);
            if ("running".equals(run.state) && now >= run.deadline) {
                try { run.ctrl.cancelUserTask(); } catch (Exception ignored) {}
                try {
                    if (journal != null) journal.settle(entry.getKey(),"EFFECT_UNKNOWN");
                } catch (Exception ignored) {
                    // An unsettled ADMITTED journal still quarantines this effect.
                }
                run.state = "failed";
                run.note = "task-deadline-expired-reconciliation-required";
                run.settledAt = now;
            }
            if (!"running".equals(run.state) && run.settledAt > 0 && now-run.settledAt > 1800000)
                it.remove();
        }
    }


    private static final Map<String,String> SMELT_RECIPES=Map.of(
        "iron_ingot","raw_iron",
        "gold_ingot","raw_gold",
        "glass","sand",
        "charcoal","log",
        "netherite_scrap","ancient_debris",
        "cooked_beef","beef",
        "cooked_porkchop","porkchop",
        "cooked_chicken","chicken"
    );
    private static final java.util.Set<String> BUILD_BLOCKS=java.util.Set.of(
        "cobblestone","cobbled_deepslate","oak_planks","spruce_planks",
        "stone","dirt","oak_log","glass","sandstone","netherrack");
    private static final java.util.Set<String> MINE_BLOCKS=java.util.Set.of(
        "stone","cobblestone","deepslate","cobbled_deepslate","coal_ore",
        "iron_ore","diamond_ore","deepslate_iron_ore","deepslate_diamond_ore",
        "oak_log","spruce_log","dirt","gravel","netherrack");
    private static final java.util.Set<String> COMBAT_MOBS=java.util.Set.of(
        "zombie","skeleton","spider","husk","drowned","stray","slime");
    private static BlockPos position(JsonObject args) {
        int x=args.get("x").getAsInt(), y=args.get("y").getAsInt(),
            z=args.get("z").getAsInt();
        if (y < -64 || y > 320 || Math.abs(x)>29999984 || Math.abs(z)>29999984)
            throw new IllegalArgumentException("position-outside-world");
        return new BlockPos(x,y,z);
    }
    private static boolean withinReach(CompanionEntity c, BlockPos pos) {
        return c.getBlockPos().getSquaredDistance(pos) <= 12*12;
    }
    private static boolean loaded(ServerWorld w, BlockPos pos) {
        return w.getChunkManager().isChunkLoaded(pos.getX()>>4,pos.getZ()>>4);
    }
    private static boolean isEquipped(CompanionEntity entity, String item, String destination) {
        if ("hand".equals(destination))
            return !entity.getLivingInventory().getMainHandStack().isEmpty() &&
                Registries.ITEM.getId(entity.getLivingInventory().getMainHandStack().getItem())
                    .getPath().equals(item);
        int slot=switch(destination) {
            case "feet" -> 0; case "legs" -> 1; case "torso" -> 2;
            case "head" -> 3; default -> -1;
        };
        if (slot<0) return false;
        ItemStack equipped=entity.getLivingInventory().armor.get(slot);
        return !equipped.isEmpty() && Registries.ITEM.getId(equipped.getItem()).getPath().equals(item);
    }

    private static boolean interactionState(BlockState state) {
        if(state.contains(Properties.OPEN))return state.get(Properties.OPEN);
        if(state.contains(Properties.POWERED))return state.get(Properties.POWERED);
        throw new IllegalArgumentException("not-an-interactive-state");
    }

    private static JsonObject snapshot(CompanionEntity companion) {
        JsonObject out = new JsonObject();
        out.addProperty("companionUuid", companion.getUuid().toString());
        out.addProperty("ownerUuid",companion.getOwnerUuid()==null?"":companion.getOwnerUuid().toString());
        out.addProperty("ownerPaired",companion.getOwnerUuid()!=null &&
            companion.getController()!=null);
        out.addProperty("dimension",
            companion.getWorld().getRegistryKey().getValue().toString());
        out.addProperty("x", companion.getX());
        out.addProperty("y", companion.getY());
        out.addProperty("z", companion.getZ());
        out.addProperty("health", companion.getHealth());
        out.addProperty("hunger", companion.getHungerManager().getFoodLevel());
        for (Map.Entry<UUID, Run> entry : tasks.entrySet()) {
            Run runningTask=entry.getValue();
            if (companion.getUuid().equals(runningTask.companion)
                    && "running".equals(runningTask.state)) {
                out.addProperty("activeTaskId", entry.getKey().toString());
                out.addProperty("activeTaskStatus", "running");
                break;
            }
        }
        JsonArray inventory = new JsonArray();
        for (ItemStack stack : companion.getLivingInventory().main) addStack(inventory,stack);
        out.add("inventory", inventory);
        JsonArray armor = new JsonArray();
        for (ItemStack stack : companion.getLivingInventory().armor) addStack(armor,stack);
        out.add("armor", armor);
        JsonArray armorSlots = new JsonArray();
        for (ItemStack stack : companion.getLivingInventory().armor)
            armorSlots.add(stack.isEmpty() ? "" :
                Registries.ITEM.getId(stack.getItem()).getPath());
        out.add("armorSlots",armorSlots);
        ItemStack held=companion.getLivingInventory().getMainHandStack();
        out.addProperty("mainHand",held.isEmpty()?"":Registries.ITEM.getId(held.getItem()).getPath());
        // Observe only already loaded nearby chunks. Never load or generate terrain
        // for model perception; observations are a bounded telemetry snapshot.
        JsonArray highPriorityBlocks=new JsonArray(), supportBlocks=new JsonArray();
        BlockPos center=companion.getBlockPos();
        ServerWorld level=(ServerWorld)companion.getWorld();
        for (int radius=0;radius<=4;radius++) {
            for (int dx=-radius;dx<=radius;dx++) {
                for (int dz=-radius;dz<=radius;dz++) {
                    if (Math.max(Math.abs(dx),Math.abs(dz))!=radius) continue;
                    for (int dy=-2;dy<=2;dy++) {
                        BlockPos pos=center.add(dx,dy,dz);
                        if (!loaded(level,pos)) continue;
                        String name=Registries.BLOCK.getId(
                            level.getBlockState(pos).getBlock()).getPath();
                        boolean high=name.endsWith("_log") || name.endsWith("_ore") ||
                            name.equals("crafting_table") || name.equals("furnace") ||
                            name.equals("chest") || name.equals("barrel") ||
                            name.equals("obsidian") ||
                            name.endsWith("_door") || name.endsWith("_trapdoor") ||
                            name.endsWith("_button") || name.equals("lever");
                        boolean supporting=name.equals("grass_block") || name.equals("dirt") ||
                            name.equals("stone") || name.equals("cobblestone") ||
                            name.equals("deepslate") || name.equals("sand") ||
                            name.equals("netherrack") || name.equals("end_stone");
                        if ((!high || highPriorityBlocks.size()>=8) &&
                            (!supporting || supportBlocks.size()>=4)) continue;
                        JsonObject row=new JsonObject();
                        row.addProperty("name",name);
                        row.addProperty("x",pos.getX());
                        row.addProperty("y",pos.getY());
                        row.addProperty("z",pos.getZ());
                        if (high && highPriorityBlocks.size()<8) highPriorityBlocks.add(row);
                        else if (supporting && supportBlocks.size()<4) supportBlocks.add(row);
                    }
                }
            }
        }
        JsonArray nearbyBlocks=new JsonArray();
        for (com.google.gson.JsonElement element:highPriorityBlocks) nearbyBlocks.add(element);
        for (com.google.gson.JsonElement element:supportBlocks) nearbyBlocks.add(element);
        out.add("nearbyBlocks",nearbyBlocks);
        JsonArray threats=new JsonArray(),villagers=new JsonArray();
        Box local=companion.getBoundingBox().expand(16);
        for (Entity e : level.getOtherEntities(companion,local)) {
            if (!e.isAlive()) continue;
            double distance=Math.sqrt(companion.squaredDistanceTo(e));
            if (e instanceof HostileEntity && threats.size()<6) {
                String hostile=Registries.ENTITY_TYPE.getId(e.getType()).getPath();
                JsonObject row=new JsonObject();
                row.addProperty("id",e.getId());
                row.addProperty("name",hostile);
                row.addProperty("distance",distance);
                JsonObject position=new JsonObject();
                position.addProperty("x",e.getX());
                position.addProperty("y",e.getY());
                position.addProperty("z",e.getZ());
                row.add("position",position);
                threats.add(row);
            }
            if (e instanceof VillagerEntity && distance<=10 && villagers.size()<3) {
                JsonObject row=new JsonObject();
                row.addProperty("id",e.getId());
                row.addProperty("name","villager");
                row.addProperty("distance",distance);
                villagers.add(row);
            }
        }
        out.add("threats",threats);
        out.add("villagers",villagers);
        return out;
    }
    private static int countItem(CompanionEntity companion, String item) {
        int total=0;
        for (ItemStack stack : companion.getLivingInventory().main) {
            if (!stack.isEmpty()) {
                String name=Registries.ITEM.getId(stack.getItem()).getPath();
                if (name.equals(item) || ("log".equals(item) && name.endsWith("_log")))
                    total += stack.getCount();
            }
        }
        return total;
    }

    private static void addStack(JsonArray out, ItemStack stack) {
        if (stack.isEmpty()) return;
        JsonObject row = new JsonObject();
        row.addProperty("item",Registries.ITEM.getId(stack.getItem()).toString());
        row.addProperty("count",stack.getCount());
        out.add(row);
    }
}
