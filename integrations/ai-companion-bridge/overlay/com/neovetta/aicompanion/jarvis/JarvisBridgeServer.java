package com.neovetta.aicompanion.jarvis;

import adris.altoclef.AltoClefController;
import adris.altoclef.TaskCatalogue;
import adris.altoclef.tasks.movement.GetToBlockTask;
import adris.altoclef.tasksystem.Task;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.neovetta.aicompanion.AiCompanion;
import com.neovetta.aicompanion.entity.CompanionEntity;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.entity.Entity;
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
    // Accessed only from server.execute; bounded to avoid indefinite replay state.
    private static final Map<String, Long> seen = new HashMap<>();
    private static final Map<UUID, Run> tasks = new HashMap<>();

    private JarvisBridgeServer() {}

    private static final class Run {
        final UUID companion;
        final AltoClefController ctrl;
        final long deadline;
        final CompanionEntity entity;
        String item;
        int initialCount;
        int addedCount;
        BlockPos arrival;
        volatile long settledAt;
        volatile String state = "running";
        volatile String note = "task-dispatched-not-verified";
        Run(UUID companion, AltoClefController ctrl, CompanionEntity entity, long budgetMs) {
            this.companion=companion; this.ctrl=ctrl; this.entity=entity;
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
        if (key == null || key.getBytes(StandardCharsets.UTF_8).length < 32 ||
                world == null || !world.matches("[a-z0-9_.-]+:[a-z0-9_./-]+")) {
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
            listener = sock;
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
        seen.clear();
        tasks.clear();
        if (old != null) try { old.close(); } catch (Exception ignored) {}
    }

    private static void serve(ServerSocket sock, MinecraftServer server) {
        while (!sock.isClosed() && running == server) {
            try (Socket client = sock.accept()) {
                client.setSoTimeout(4000);
                client.setTcpNoDelay(true);
                byte[] frameBytes = readLine(client.getInputStream());
                JsonObject request = JsonParser.parseString(new String(frameBytes, StandardCharsets.UTF_8)).getAsJsonObject();
                JsonObject body = request.getAsJsonObject("body");
                String mac = request.get("mac").getAsString();
                String key = secret;
                if (key == null || body == null || !validMac(key, body.toString(), mac)) continue;
                // Identity, replay protection, and game access happen ONLY on the server thread.
                CompletableFuture<JsonObject> reply = new CompletableFuture<>();
                server.execute(() -> {
                    try { reply.complete(handle(server, body)); }
                    catch (Throwable t) { reply.completeExceptionally(t); }
                });
                JsonObject answer = reply.get(2500, TimeUnit.MILLISECONDS);
                JsonObject wire = new JsonObject();
                wire.add("body", answer);
                wire.addProperty("mac", sign(key, answer.toString()));
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
        id(guardian,"receiptId");
        int budget = b.get("budgetMs").getAsInt();
        if (budget < 100 || budget > 30000) throw new IllegalArgumentException("budget");
        JsonObject args = b.getAsJsonObject("arguments");
        if (args == null) throw new IllegalArgumentException("args");
        UUID ownerId = id(args,"ownerUuid");
        UUID companionId = id(args,"companionUuid");
        if (server.getPlayerManager().getPlayer(ownerId) == null) throw new IllegalArgumentException("owner-offline");
        CompanionEntity companion = null;
        for (ServerWorld world : server.getWorlds()) {
            if (!world.getRegistryKey().getValue().toString().equals(worldId)) continue;
            for (Entity entity : world.iterateEntities()) {
                if (entity instanceof CompanionEntity c && c.getUuid().equals(companionId)
                        && ownerId.equals(c.getOwnerUuid()) && c.isAlive()) {
                    companion = c;
                    break;
                }
            }
        }
        if (companion == null || companion.getController() == null) throw new IllegalArgumentException("companion-unavailable");
        AltoClefController ctrl = companion.getController();
        String status;
        String note;
        switch (op) {
            case "inspect" -> { status = "observed"; note = "snapshot-only"; }
            case "status" -> {
                Run previous = tasks.get(taskId);
                if (previous == null || !previous.companion.equals(companionId)) {
                    status = "failed"; note = "no-active-task";
                } else { status = previous.state; note = previous.note; }
            }
            case "stop", "cancel" -> {
                Run previous = tasks.get(taskId);
                if (previous == null || !previous.companion.equals(companionId)) throw new IllegalArgumentException("task-mismatch");
                ctrl.cancelUserTask();
                previous.state = "cancelled";
                previous.settledAt = now;
                previous.note = "cancel-sent-observe-before-retry";
                status = "cancelled"; note = previous.note;
            }
            case "gather", "mine", "craft", "travel" -> {
                if (tasks.containsKey(taskId)) throw new IllegalArgumentException("duplicate-task");
                if (tasks.size() >= 2048) throw new IllegalArgumentException("task-capacity");
                for (Run existing : tasks.values()) {
                    if (existing.companion.equals(companionId) && "running".equals(existing.state))
                        throw new IllegalArgumentException("companion-busy");
                }
                Task task;
                if ("travel".equals(op)) {
                    int x = args.get("x").getAsInt(), y = args.get("y").getAsInt(), z = args.get("z").getAsInt();
                    if (y < -64 || y > 320 || Math.abs(x) > 29999984 || Math.abs(z) > 29999984)
                        throw new IllegalArgumentException("invalid-coordinate");
                    task = new GetToBlockTask(new BlockPos(x,y,z));
                } else {
                    String item = field(args,"item");
                    int count = args.get("count").getAsInt();
                    if (!item.matches("[a-z0-9_]{1,64}") || count < 1 || count > 64
                            || !TaskCatalogue.taskExists(item)) throw new IllegalArgumentException("task-target-denied");
                    int current = countItem(companion, item);
                    if (current > 192 || current + count > 256) throw new IllegalArgumentException("target-over-budget");
                    run.item = item; run.initialCount = current; run.addedCount = count;
                    task = TaskCatalogue.getItemTask(item, current + count);
                }
                if (task == null) throw new IllegalArgumentException("missing-task");
                Run run = new Run(companionId, ctrl, companion, budget);
                if ("travel".equals(op)) run.arrival = new BlockPos(
                    args.get("x").getAsInt(), args.get("y").getAsInt(), args.get("z").getAsInt());
                tasks.put(taskId, run);
                ctrl.runUserTask(task, () -> {
                    if ("running".equals(run.state)) {
                        boolean present = run.item != null &&
                            countItem(run.entity, run.item) >= run.initialCount + run.addedCount;
                        boolean arrived = run.arrival != null &&
                            run.entity.getBlockPos().isWithinDistance(run.arrival, 2.5);
                        run.state = present || arrived ? "observed" : "failed";
                        run.settledAt=System.currentTimeMillis();
                        run.note=present ? "new-server-inventory-confirmed" :
                            arrived ? "server-position-arrival-confirmed" : "engine-done-no-postcondition";
                    }
                });
                status = "accepted"; note = "dispatched-not-verified";
            }
            default -> { status = "failed"; note = "unsupported-operation-fail-closed"; }
        }
        JsonObject snapshot = snapshot(companion);
        snapshot.addProperty("note", note);
        JsonObject receipt = new JsonObject();
        receipt.addProperty("version",1);
        receipt.addProperty("taskId",taskId.toString());
        receipt.addProperty("idempotencyKey",idempotency.toString());
        receipt.addProperty("nonce",nonce);
        receipt.addProperty("worldId",worldId);
        receipt.addProperty("observedAt",now);
        receipt.addProperty("status",status);
        receipt.add("observations",snapshot);
        return receipt;
    }

    private static void enforceDeadlines(MinecraftServer server) {
        if (running != server) return;
        long now = System.currentTimeMillis();
        Iterator<Map.Entry<UUID, Run>> it = tasks.entrySet().iterator();
        while (it.hasNext()) {
            Run run = it.next().getValue();
            if ("running".equals(run.state) && now >= run.deadline) {
                try { run.ctrl.cancelUserTask(); } catch (Exception ignored) {}
                run.state = "failed";
                run.note = "task-budget-expired-cancelled";
                run.settledAt = now;
            }
            if (!"running".equals(run.state) && run.settledAt > 0 && now-run.settledAt > 1800000)
                it.remove();
        }
    }

    private static JsonObject snapshot(CompanionEntity companion) {
        JsonObject out = new JsonObject();
        out.addProperty("companionUuid", companion.getUuid().toString());
        out.addProperty("x", companion.getX());
        out.addProperty("y", companion.getY());
        out.addProperty("z", companion.getZ());
        out.addProperty("health", companion.getHealth());
        out.addProperty("hunger", companion.getHungerManager().getFoodLevel());
        JsonArray inventory = new JsonArray();
        for (ItemStack stack : companion.getLivingInventory().main) addStack(inventory,stack);
        out.add("inventory", inventory);
        JsonArray armor = new JsonArray();
        for (ItemStack stack : companion.getLivingInventory().armor) addStack(armor,stack);
        out.add("armor", armor);
        return out;
    }
    private static int countItem(CompanionEntity companion, String item) {
        int total=0;
        for (ItemStack stack : companion.getLivingInventory().main) {
            if (!stack.isEmpty() && Registries.ITEM.getId(stack.getItem()).getPath().equals(item))
                total += stack.getCount();
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
