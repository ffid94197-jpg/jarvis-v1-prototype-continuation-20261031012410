package com.neovetta.aicompanion;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.neovetta.aicompanion.entity.CompanionEntity;
import com.player2.playerengine.PlayerEngineController;
import com.player2.playerengine.commands.base.CommandException;
import com.player2.playerengine.commands.base.CommandExecutor;
import com.player2.playerengine.tasks.base.TaskChain;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.AABB;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Local-only bridge from JARVIS Core to the real PlayerEngine companion entity.
 *
 * The model never supplies a raw PlayerEngine command, script, class name or executable.
 * Requests are authenticated, owner-bound, typed and mapped here to a small command allowlist.
 * The PlayerEngine task engine owns movement and game actions; JARVIS remains the planner/verifier.
 */
public final class JarvisBridge {
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
    private static final int MAX_BODY = 8192;
    private static final int MAX_TASKS = 256;
    private static final Pattern PLAYER_NAME = Pattern.compile("[A-Za-z0-9_]{1,16}");
    private static final Pattern ITEM_NAME = Pattern.compile("[a-z0-9_]{1,64}");
    private static final Pattern UUID_TEXT = Pattern.compile("[0-9a-fA-F-]{36}");
    private static final ExecutorService HTTP_WORKERS = Executors.newFixedThreadPool(2, r -> {
        Thread t = new Thread(r, "jarvis-ai-companion-bridge");
        t.setDaemon(true);
        return t;
    });
    private static final ConcurrentHashMap<UUID, TaskReceipt> TASKS = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<UUID, UUID> ACTIVE_BY_COMPANION = new ConcurrentHashMap<>();
    private static final ConcurrentLinkedDeque<UUID> TASK_ORDER = new ConcurrentLinkedDeque<>();
    private static volatile MinecraftServer gameServer;
    private static volatile HttpServer httpServer;
    private static volatile BridgeConfig bridgeConfig;

    private JarvisBridge() {}

    public static void register() {
        ServerLifecycleEvents.SERVER_STARTED.register(JarvisBridge::start);
        ServerLifecycleEvents.SERVER_STOPPING.register(server -> stop());
    }

    /** Used by the small CompanionEntity overlay to avoid running a second, independent LLM brain. */
    public static boolean enabled() {
        BridgeConfig config = bridgeConfig;
        if (config == null) config = loadConfig();
        return config != null && config.enabled && config.token.length() >= 64;
    }

    private static synchronized BridgeConfig loadConfig() {
        if (bridgeConfig != null) return bridgeConfig;
        try {
            Path path = FabricLoader.getInstance().getConfigDir().resolve("jarvis-bridge.json");
            Files.createDirectories(path.getParent());
            JsonObject json;
            if (Files.exists(path)) {
                json = JsonParser.parseString(Files.readString(path, StandardCharsets.UTF_8)).getAsJsonObject();
            } else {
                json = new JsonObject();
                json.addProperty("enabled", true);
                json.addProperty("host", "127.0.0.1");
                json.addProperty("port", 38765);
                json.addProperty("token", newToken());
                Files.writeString(path, GSON.toJson(json), StandardCharsets.UTF_8);
            }
            boolean enabled = !json.has("enabled") || json.get("enabled").getAsBoolean();
            String host = json.has("host") ? json.get("host").getAsString() : "127.0.0.1";
            int port = json.has("port") ? json.get("port").getAsInt() : 38765;
            String token = json.has("token") ? json.get("token").getAsString() : "";
            if (!"127.0.0.1".equals(host)) throw new IllegalArgumentException("Bridge host must remain loopback-only.");
            if (port < 1024 || port > 65535) throw new IllegalArgumentException("Bridge port is outside the allowed range.");
            if (!token.matches("[0-9a-f]{64}")) {
                token = newToken();
                json.addProperty("token", token);
                json.addProperty("host", "127.0.0.1");
                json.addProperty("port", port);
                json.addProperty("enabled", enabled);
                Files.writeString(path, GSON.toJson(json), StandardCharsets.UTF_8);
            }
            bridgeConfig = new BridgeConfig(enabled, port, token);
            AiCompanion.LOGGER.info("[{}] JARVIS bridge config ready at {}", AiCompanion.MOD_ID, path);
            return bridgeConfig;
        } catch (Exception e) {
            AiCompanion.LOGGER.error("[{}] JARVIS bridge configuration unavailable; bridge remains disabled.", AiCompanion.MOD_ID, e);
            bridgeConfig = new BridgeConfig(false, 38765, "");
            return bridgeConfig;
        }
    }

    private static String newToken() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    private static void start(MinecraftServer server) {
        BridgeConfig config = loadConfig();
        if (!config.enabled || config.token.length() < 64) {
            AiCompanion.LOGGER.info("[{}] JARVIS bridge disabled by local config.", AiCompanion.MOD_ID);
            return;
        }
        try {
            gameServer = server;
            HttpServer http = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), config.port), 16);
            http.createContext("/v1/", JarvisBridge::handle);
            http.setExecutor(HTTP_WORKERS);
            http.start();
            httpServer = http;
            AiCompanion.LOGGER.info("[{}] JARVIS PlayerEngine bridge listening on 127.0.0.1:{}.", AiCompanion.MOD_ID, config.port);
        } catch (Exception e) {
            AiCompanion.LOGGER.error("[{}] Could not start loopback JARVIS bridge.", AiCompanion.MOD_ID, e);
        }
    }

    private static synchronized void stop() {
        HttpServer http = httpServer;
        httpServer = null;
        gameServer = null;
        if (http != null) http.stop(0);
        for (TaskReceipt receipt : TASKS.values()) {
            if ("queued".equals(receipt.state) || "running".equals(receipt.state)) {
                receipt.state = "interrupted";
                receipt.error = "Minecraft server stopped while the task was active; outcome is unknown.";
                receipt.finishedAt = System.currentTimeMillis();
            }
        }
        ACTIVE_BY_COMPANION.clear();
    }

    private static void handle(HttpExchange exchange) throws IOException {
        try {
            if (!authorized(exchange)) {
                reply(exchange, 403, error("Bridge authentication failed."));
                return;
            }
            String path = exchange.getRequestURI().getPath();
            String method = exchange.getRequestMethod();
            if ("/v1/health".equals(path) && "GET".equals(method)) {
                JsonObject out = new JsonObject();
                out.addProperty("ok", true);
                out.addProperty("engine", "ai-companion-playerengine");
                out.addProperty("minecraft", "1.21.11");
                reply(exchange, 200, out);
                return;
            }
            if ("/v1/join".equals(path) && "POST".equals(method)) {
                JsonObject body = readBody(exchange);
                JsonObject out = onServer(() -> joinOwner(string(body, "ownerName")));
                reply(exchange, out.has("error") ? 409 : 200, out);
                return;
            }
            if ("/v1/companions".equals(path) && "GET".equals(method)) {
                Map<String, String> query = query(exchange);
                JsonArray out = onServer(() -> companionList(string(query.get("ownerName")), string(query.get("companionName"))));
                reply(exchange, 200, wrapArray(out));
                return;
            }
            if ("/v1/observe".equals(path) && "GET".equals(method)) {
                Map<String, String> query = query(exchange);
                JsonObject out = onServer(() -> observeOwner(string(query.get("ownerName")), string(query.get("companionName"))));
                reply(exchange, out.has("error") ? 404 : 200, out);
                return;
            }
            if ("/v1/status".equals(path) && "GET".equals(method)) {
                Map<String, String> query = query(exchange);
                JsonObject out = onServer(() -> statusOwner(string(query.get("ownerName")), string(query.get("companionName"))));
                reply(exchange, out.has("error") ? 404 : 200, out);
                return;
            }
            if ("/v1/tasks".equals(path) && "POST".equals(method)) {
                JsonObject body = readBody(exchange);
                JsonObject out = enqueue(body);
                reply(exchange, out.has("error") ? 409 : 202, out);
                return;
            }
            if ("/v1/stop".equals(path) && "POST".equals(method)) {
                JsonObject body = readBody(exchange);
                JsonObject out = onServer(() -> stopOwner(string(body, "ownerName"), string(body, "companionName")));
                reply(exchange, out.has("error") ? 404 : 202, out);
                return;
            }
            if (path.startsWith("/v1/tasks/") && "GET".equals(method)) {
                UUID id = parseUuid(path.substring("/v1/tasks/".length()));
                TaskReceipt receipt = id == null ? null : TASKS.get(id);
                if (receipt == null) reply(exchange, 404, error("Unknown task receipt."));
                else reply(exchange, 200, receipt.toJson());
                return;
            }
            if (path.startsWith("/v1/tasks/") && path.endsWith("/cancel") && "POST".equals(method)) {
                String raw = path.substring("/v1/tasks/".length(), path.length() - "/cancel".length());
                UUID id = parseUuid(raw);
                JsonObject out = id == null ? error("Invalid task id.") : onServer(() -> cancelTask(id));
                reply(exchange, out.has("error") ? 404 : 202, out);
                return;
            }
            reply(exchange, 404, error("Unknown JARVIS bridge endpoint."));
        } catch (BodyTooLarge e) {
            reply(exchange, 413, error("Request body exceeds the 8 KiB limit."));
        } catch (Exception e) {
            reply(exchange, 503, error("JARVIS bridge unavailable: " + safeError(e)));
        } finally {
            exchange.close();
        }
    }

    private static boolean authorized(HttpExchange exchange) {
        BridgeConfig config = loadConfig();
        String header = exchange.getRequestHeaders().getFirst("Authorization");
        if (config.token.isEmpty() || header == null || !header.startsWith("Bearer ")) return false;
        byte[] expected = config.token.getBytes(StandardCharsets.UTF_8);
        byte[] supplied = header.substring(7).getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(expected, supplied);
    }

    private static JsonObject readBody(HttpExchange exchange) throws IOException, BodyTooLarge {
        byte[] bytes = exchange.getRequestBody().readNBytes(MAX_BODY + 1);
        if (bytes.length > MAX_BODY) throw new BodyTooLarge();
        JsonElement parsed = JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8));
        if (!parsed.isJsonObject()) throw new IllegalArgumentException("Expected a JSON object.");
        return parsed.getAsJsonObject();
    }

    private static void reply(HttpExchange exchange, int status, JsonObject body) throws IOException {
        byte[] bytes = GSON.toJson(body).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    private static <T> T onServer(Callable<T> work) throws Exception {
        MinecraftServer server = gameServer;
        if (server == null || !server.isRunning()) throw new IllegalStateException("Minecraft integrated/dedicated server is not running.");
        CompletableFuture<T> future = new CompletableFuture<>();
        server.execute(() -> {
            try { future.complete(work.call()); }
            catch (Throwable t) { future.completeExceptionally(t); }
        });
        return future.get(4, TimeUnit.SECONDS);
    }

    private static JsonObject joinOwner(String ownerName) {
        MinecraftServer server = gameServer;
        if (!validPlayer(ownerName)) return error("Configured ownerName must be a valid Java player name.");
        var owner = server.getPlayerList().getPlayerByName(ownerName);
        if (owner == null) return error("Configured JARVIS owner is not currently online in this Minecraft world.");
        List<CompanionEntity> found = ownedCompanions(server, owner.getUUID(), "");
        if (found.isEmpty()) {
            // Spawn through the upstream owner-scoped command so roster, permissions and caps
            // remain enforced by AI Companion itself. This is not a second Mineflayer player.
            server.getCommands().performPrefixedCommand(owner.createCommandSourceStack(), "companion spawn");
            found = ownedCompanions(server, owner.getUUID(), "");
        }
        if (found.isEmpty()) return error("AI Companion did not spawn. Check the configured companion roster and /companion permissions.");
        JsonObject out = new JsonObject();
        out.addProperty("ok", true);
        out.addProperty("joinedVerified", true);
        out.addProperty("ownerName", ownerName);
        out.add("companions", snapshots(found, ownerName));
        return out;
    }

    private static JsonArray companionList(String ownerName, String companionName) {
        MinecraftServer server = gameServer;
        if (!validPlayer(ownerName)) throw new IllegalArgumentException("ownerName is required.");
        var owner = server.getPlayerList().getPlayerByName(ownerName);
        if (owner == null) throw new IllegalArgumentException("Owner is not online.");
        return snapshots(ownedCompanions(server, owner.getUUID(), companionName), ownerName);
    }

    private static JsonObject observeOwner(String ownerName, String companionName) {
        MinecraftServer server = gameServer;
        if (!validPlayer(ownerName)) return error("ownerName is required.");
        var owner = server.getPlayerList().getPlayerByName(ownerName);
        if (owner == null) return error("Configured JARVIS owner is not online.");
        List<CompanionEntity> list = ownedCompanions(server, owner.getUUID(), companionName);
        if (list.size() != 1) return error(list.isEmpty() ? "No owner-bound AI Companion exists; call join first."
                : "More than one owned companion exists; configure JARVIS_MINECRAFT_AI_COMPANION_NAME.");
        JsonObject out = snapshot(list.get(0), ownerName);
        out.addProperty("ok", true);
        return out;
    }

    private static JsonObject statusOwner(String ownerName, String companionName) {
        JsonObject out = observeOwner(ownerName, companionName);
        if (out.has("error")) return out;
        String companionId = out.get("companionId").getAsString();
        UUID id = parseUuid(companionId);
        UUID activeId = id == null ? null : ACTIVE_BY_COMPANION.get(id);
        TaskReceipt receipt = activeId == null ? null : TASKS.get(activeId);
        out.add("task", receipt == null ? idleTask() : receipt.toJson());
        return out;
    }

    private static JsonObject idleTask() {
        JsonObject out = new JsonObject();
        out.addProperty("state", "idle");
        out.addProperty("completed", false);
        out.addProperty("verified", false);
        return out;
    }

    private static List<CompanionEntity> ownedCompanions(MinecraftServer server, UUID owner, String name) {
        List<CompanionEntity> result = new ArrayList<>();
        for (ServerLevel world : server.getAllLevels()) {
            for (Entity entity : world.getAllEntities()) {
                if (entity instanceof CompanionEntity companion && owner.equals(companion.getOwnerUuid())
                        && (name == null || name.isBlank() || companion.displayName().equalsIgnoreCase(name))) {
                    result.add(companion);
                }
            }
        }
        return result;
    }

    private static JsonArray snapshots(List<CompanionEntity> companions, String ownerName) {
        JsonArray array = new JsonArray();
        for (CompanionEntity companion : companions) array.add(snapshot(companion, ownerName));
        return array;
    }

    private static JsonObject snapshot(CompanionEntity companion, String ownerName) {
        PlayerEngineController controller = companion.getController();
        JsonObject out = new JsonObject();
        out.addProperty("companionId", companion.getUUID().toString());
        out.addProperty("name", companion.displayName());
        out.addProperty("ownerName", ownerName);
        out.addProperty("joined", controller != null);
        out.addProperty("health", companion.getHealth());
        out.addProperty("maxHealth", companion.getMaxHealth());
        out.addProperty("hunger", companion.hungerManager == null ? 20 : companion.hungerManager.getFoodLevel());
        out.addProperty("dimension", companion.level().dimension().location().toString());
        JsonObject position = new JsonObject();
        position.addProperty("x", companion.getX());
        position.addProperty("y", companion.getY());
        position.addProperty("z", companion.getZ());
        out.add("position", position);

        JsonObject raw = new JsonObject();
        int logs = 0, planks = 0, sticks = 0, food = 0;
        int woodenPickaxe = 0, stonePickaxe = 0, stoneSword = 0, cobblestone = 0;
        int rawIron = 0, ironIngot = 0, ironPickaxe = 0, diamondPickaxe = 0, diamonds = 0;
        int furnace = 0, coal = 0, table = 0;
        List<String> armor = new ArrayList<>();
        if (companion.inventory != null) {
            for (int i = 0; i < companion.inventory.getContainerSize(); i++) {
                var stack = companion.inventory.getItem(i);
                if (stack.isEmpty()) continue;
                String item = BuiltInRegistries.ITEM.getKey(stack.getItem()).getPath();
                int count = stack.getCount();
                raw.addProperty(item, (raw.has(item) ? raw.get(item).getAsInt() : 0) + count);
                if (item.endsWith("_log") || item.endsWith("_stem")) logs += count;
                if (item.endsWith("_planks")) planks += count;
                if ("stick".equals(item)) sticks += count;
                if ("cobblestone".equals(item) || "cobbled_deepslate".equals(item)) cobblestone += count;
                if ("wooden_pickaxe".equals(item)) woodenPickaxe += count;
                if ("stone_pickaxe".equals(item)) stonePickaxe += count;
                if ("stone_sword".equals(item)) stoneSword += count;
                if ("raw_iron".equals(item)) rawIron += count;
                if ("iron_ingot".equals(item)) ironIngot += count;
                if ("iron_pickaxe".equals(item)) ironPickaxe += count;
                if ("diamond_pickaxe".equals(item)) diamondPickaxe += count;
                if ("diamond".equals(item)) diamonds += count;
                if ("furnace".equals(item)) furnace += count;
                if ("coal".equals(item) || "charcoal".equals(item)) coal += count;
                if ("crafting_table".equals(item)) table += count;
                if (item.equals("bread") || item.equals("baked_potato") || item.equals("apple")
                        || item.equals("carrot") || item.equals("potato") || item.endsWith("_cooked")) food += count;
            }
            for (var stack : companion.inventory.armor) {
                if (!stack.isEmpty()) armor.add(BuiltInRegistries.ITEM.getKey(stack.getItem()).getPath());
            }
        }
        JsonObject inventory = new JsonObject();
        inventory.add("raw", raw);
        inventory.addProperty("logs", logs);
        inventory.addProperty("planks", planks);
        inventory.addProperty("sticks", sticks);
        inventory.addProperty("table", table);
        inventory.addProperty("woodenPickaxe", woodenPickaxe);
        inventory.addProperty("stonePickaxe", stonePickaxe);
        inventory.addProperty("stoneSword", stoneSword);
        inventory.addProperty("cobblestone", cobblestone);
        inventory.addProperty("rawIron", rawIron);
        inventory.addProperty("ironIngot", ironIngot);
        inventory.addProperty("ironPickaxe", ironPickaxe);
        inventory.addProperty("diamondPickaxe", diamondPickaxe);
        inventory.addProperty("diamonds", diamonds);
        inventory.addProperty("furnace", furnace);
        inventory.addProperty("coal", coal);
        inventory.addProperty("food", food);
        out.add("inventory", inventory);
        out.addProperty("wornNetherite", armor.contains("netherite_helmet") && armor.contains("netherite_chestplate")
                && armor.contains("netherite_leggings") && armor.contains("netherite_boots"));

        boolean busy = controller != null && controller.getUserTaskChain().isActive()
                && !controller.getUserTaskChain().isRunningIdleTask();
        out.addProperty("busy", busy);
        UUID activeId = ACTIVE_BY_COMPANION.get(companion.getUUID());
        TaskReceipt active = activeId == null ? null : TASKS.get(activeId);
        if (active != null) out.addProperty("nativeGoal", active.goal);
        else out.add("nativeGoal", null);
        out.addProperty("lastAction", active == null ? (controller == null ? "no PlayerEngine controller" :
                controller.getTaskRunner().statusReport) : active.command);

        JsonArray nearby = new JsonArray();
        ServerLevel level = (ServerLevel) companion.level();
        BlockPos origin = companion.blockPosition();
        for (int dx = -3; dx <= 3 && nearby.size() < 24; dx++) {
            for (int dy = -1; dy <= 2 && nearby.size() < 24; dy++) {
                for (int dz = -3; dz <= 3 && nearby.size() < 24; dz++) {
                    BlockPos pos = origin.offset(dx, dy, dz);
                    if (!level.hasChunkAt(pos)) continue;
                    var state = level.getBlockState(pos);
                    if (state.isAir()) continue;
                    JsonObject block = new JsonObject();
                    block.addProperty("name", BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath());
                    block.addProperty("x", pos.getX());
                    block.addProperty("y", pos.getY());
                    block.addProperty("z", pos.getZ());
                    nearby.add(block);
                }
            }
        }
        out.add("nearbyBlocks", nearby);
        JsonArray threats = new JsonArray();
        JsonArray villagers = new JsonArray();
        AABB entityBounds = AABB.ofSize(companion.position(), 24, 12, 24);
        java.util.Set<String> hostileTypes = java.util.Set.of("zombie","skeleton","creeper","spider",
                "enderman","witch","drowned","husk","stray","blaze","ghast","wither_skeleton",
                "piglin_brute","guardian","silverfish","slime","phantom","vindicator","evoker",
                "ravager","hoglin","zoglin","warden","breeze","bogged","pillager");
        for (Entity entity : level.getEntitiesOfClass(Entity.class, entityBounds)) {
            String type = BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).getPath();
            if (hostileTypes.contains(type) && threats.size() < 16) {
                JsonObject row = new JsonObject();
                row.addProperty("id", entity.getId());
                row.addProperty("name", type);
                row.addProperty("distance", entity.distanceTo(companion));
                row.addProperty("x", entity.getX());
                row.addProperty("y", entity.getY());
                row.addProperty("z", entity.getZ());
                threats.add(row);
            } else if ("villager".equals(type) && villagers.size() < 12) {
                JsonObject row = new JsonObject();
                row.addProperty("id", entity.getId());
                row.addProperty("distance", entity.distanceTo(companion));
                row.addProperty("x", entity.getX());
                row.addProperty("y", entity.getY());
                row.addProperty("z", entity.getZ());
                villagers.add(row);
            }
        }
        out.add("threats", threats);
        out.add("villagers", villagers);

        var owner = controller == null ? null : controller.getOwner();
        boolean ownerVisible = owner != null && owner.level() == companion.level();
        out.addProperty("ownerVisible", ownerVisible);
        if (ownerVisible) out.addProperty("ownerDistance", owner.distanceTo(companion));
        else out.add("ownerDistance", com.google.gson.JsonNull.INSTANCE);

        ServerLevel end = gameServer == null ? null : gameServer.getLevel(Level.END);
        boolean dragonDead = end != null && dragonPreviouslyKilled(end);
        out.addProperty("dragonDeadObserved", dragonDead);
        out.addProperty("exitPortalPresent", end != null && hasExitPortal(end));
        boolean dragonPresent = false;
        int crystals = 0;
        if (end != null) {
            for (Entity entity : end.getAllEntities()) {
                String id = BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).getPath();
                if ("ender_dragon".equals(id)) dragonPresent = true;
                if ("end_crystal".equals(id) && companion.level() == end && entity.distanceTo(companion) <= 128.0F) crystals++;
            }
        }
        out.addProperty("dragonPresent", dragonPresent);
        out.addProperty("crystalsNearby", crystals);
        out.addProperty("netherPortalNearby", hasBlock(level, origin, net.minecraft.world.level.block.Blocks.NETHER_PORTAL, 8));
        out.addProperty("smithingTableNearby", hasBlock(level, origin, net.minecraft.world.level.block.Blocks.SMITHING_TABLE, 8));
        return out;
    }

    private static boolean dragonPreviouslyKilled(ServerLevel end) {
        try {
            Object fight = end.getClass().getMethod("getDragonFight").invoke(end);
            if (fight == null) return false;
            Object result = fight.getClass().getMethod("hasPreviouslyKilledDragon").invoke(fight);
            return Boolean.TRUE.equals(result);
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return false;
        }
    }

    private static boolean hasExitPortal(ServerLevel end) {
        for (int x = -2; x <= 2; x++) for (int y = 58; y <= 72; y++)
            for (int z = -2; z <= 2; z++) {
                BlockPos pos = new BlockPos(x, y, z);
                if (end.hasChunkAt(pos) && end.getBlockState(pos).is(net.minecraft.world.level.block.Blocks.END_PORTAL))
                    return true;
            }
        return false;
    }

    private static boolean hasBlock(ServerLevel level, BlockPos origin, net.minecraft.world.level.block.Block target, int radius) {
        for (int dx = -radius; dx <= radius; dx++) for (int dy = -3; dy <= 3; dy++)
            for (int dz = -radius; dz <= radius; dz++) {
                BlockPos pos = origin.offset(dx, dy, dz);
                if (level.hasChunkAt(pos) && level.getBlockState(pos).is(target)) return true;
            }
        return false;
    }

    private static JsonObject enqueue(JsonObject body) {
        UUID requestId = parseUuid(string(body, "requestId"));
        UUID companionId = parseUuid(string(body, "companionId"));
        String ownerName = string(body, "ownerName");
        if (requestId == null || companionId == null || !validPlayer(ownerName)) return error("requestId, companionId and ownerName are required.");
        TaskReceipt duplicate = TASKS.get(requestId);
        if (duplicate != null) return duplicate.toJson();
        String command;
        String goal;
        try {
            command = mapRequest(body, ownerName);
            goal = body.has("goal") ? string(body, "goal") : string(body, "command");
            if (command.length() > 1800 || command.isBlank()) throw new IllegalArgumentException("Mapped PlayerEngine command is invalid.");
        } catch (Exception e) {
            return error("Unsupported or invalid PlayerEngine goal: " + safeError(e));
        }
        TaskReceipt receipt = new TaskReceipt(requestId, companionId, ownerName, goal, command);
        TASKS.put(requestId, receipt);
        TASK_ORDER.addLast(requestId);
        trimTasks();
        MinecraftServer server = gameServer;
        if (server == null || !server.isRunning()) {
            receipt.state = "failed";
            receipt.error = "Minecraft server is not running.";
            receipt.finishedAt = System.currentTimeMillis();
            return receipt.toJson();
        }
        server.execute(() -> dispatch(receipt, body));
        return receipt.toJson();
    }

    private static void dispatch(TaskReceipt receipt, JsonObject body) {
        try {
            if (!"queued".equals(receipt.state)) return;
            MinecraftServer server = gameServer;
            var owner = server == null ? null : server.getPlayerList().getPlayerByName(receipt.ownerName);
            if (owner == null) throw new IllegalStateException("Owner is not online.");
            CompanionEntity companion = findCompanion(server, receipt.companionId);
            if (companion == null || !owner.getUUID().equals(companion.getOwnerUuid()))
                throw new IllegalStateException("Companion id is not owned by the authenticated JARVIS owner.");
            PlayerEngineController controller = companion.getController();
            if (controller == null) throw new IllegalStateException("Companion has no active PlayerEngine controller.");
            UUID previousId = ACTIVE_BY_COMPANION.get(companion.getUUID());
            TaskReceipt previous = previousId == null ? null : TASKS.get(previousId);
            if (previous != null && ("queued".equals(previous.state) || "running".equals(previous.state)))
                throw new IllegalStateException("PlayerEngine companion is already executing a JARVIS mission.");
            if (controller.getUserTaskChain().isActive() && !controller.getUserTaskChain().isRunningIdleTask())
                throw new IllegalStateException("PlayerEngine companion is busy with another owner task.");

            boolean allowGamer = List.of("dragon_run", "netherite_dragon_run", "dragon_then_netherite_run")
                    .contains(receipt.goal);
            validateMappedCommands(controller.getCommandExecutor(), receipt.command, allowGamer);
            ACTIVE_BY_COMPANION.put(companion.getUUID(), receipt.id);
            receipt.state = "running";
            receipt.startedAt = System.currentTimeMillis();
            String line = controller.getCommandExecutor().getCommandPrefix() + receipt.command;
            controller.getCommandExecutor().execute(line,
                    () -> {
                        if ("running".equals(receipt.state)) {
                            receipt.state = "completed";
                            receipt.finishedAt = System.currentTimeMillis();
                        }
                        ACTIVE_BY_COMPANION.remove(companion.getUUID(), receipt.id);
                    },
                    error -> {
                        receipt.state = "failed";
                        receipt.error = error.getMessage() == null ? "PlayerEngine rejected the command." : error.getMessage().substring(0, Math.min(500, error.getMessage().length()));
                        receipt.finishedAt = System.currentTimeMillis();
                        ACTIVE_BY_COMPANION.remove(companion.getUUID(), receipt.id);
                    });
        } catch (Exception e) {
            receipt.state = "failed";
            receipt.error = safeError(e);
            receipt.finishedAt = System.currentTimeMillis();
        }
    }

    private static void validateMappedCommands(CommandExecutor executor, String commandLine, boolean allowGamer) {
        for (String part : commandLine.split(";")) {
            String trimmed = part.trim();
            if (trimmed.isEmpty()) throw new IllegalArgumentException("Empty command in sequence.");
            String name = trimmed.split("\\s+", 2)[0].toLowerCase(Locale.ROOT);
            if (executor.get(name) == null) throw new IllegalArgumentException("PlayerEngine command is unavailable: " + name);
            if (CommandExecutor.isOwnerOnly(name) && !(allowGamer && "gamer".equals(name)))
                throw new IllegalArgumentException("Owner-only PlayerEngine command is not permitted through this route: " + name);
        }
    }

    private static String mapRequest(JsonObject body, String ownerName) {
        String command = string(body, "command");
        if ("auto_goal".equals(command)) return mapGoal(body, ownerName);
        return switch (command) {
            case "follow", "come" -> "follow " + ownerName;
            case "guard" -> "bodyguard";
            case "stay", "stop", "auto_stop" -> "stop";
            case "collect_wood" -> "get log 1";
            case "craft_item" -> "get " + item(body, "item") + " " + bounded(body, "count", 1, 16);
            case "equip_item" -> "equip " + item(body, "item");
            case "navigate" -> gotoCommand(body.getAsJsonObject("position"));
            case "place_block" -> placeCommand(body);
            default -> throw new IllegalArgumentException("This action has no safe PlayerEngine mapping: " + command);
        };
    }

    private static String mapGoal(JsonObject body, String ownerName) {
        String goal = string(body, "goal");
        return switch (goal) {
            case "wood" -> "get log 16";
            case "tools" -> "get wooden_pickaxe 1;get stone_pickaxe 1;get iron_pickaxe 1";
            case "stone_age" -> "get stone_pickaxe 1;get stone_sword 1";
            case "iron_age" -> "get iron_pickaxe 1;get iron_sword 1";
            case "survive" -> "bodyguard";
            case "follow", "companion" -> "follow " + ownerName;
            case "guard" -> "bodyguard";
            case "dragon_run" -> "gamer";
            case "netherite_armor_run" -> netheriteArmorCommands();
            case "netherite_gear_run" -> netheriteGearCommands();
            case "netherite_dragon_run", "dragon_then_netherite_run" ->
                    "gamer;" + netheriteGearCommands();
            case "gather" -> "get " + resource(string(body, "resource")) + " " + bounded(body, "targetCount", 1, 64);
            case "craft" -> "get " + item(body, "item") + " " + bounded(body, "targetCount", 1, 16);
            case "equip" -> "equip " + item(body, "item");
            case "travel" -> gotoCommand(body.getAsJsonObject("destination"));
            case "build" -> buildCommand(body);
            case "farm_wheat" -> farmCommand(body);
            case "sequence" -> sequenceCommand(body, ownerName);
            default -> throw new IllegalArgumentException("No reviewed PlayerEngine mapping exists for goal " + goal + ".");
        };
    }

    private static String netheriteArmorCommands() {
        return "get netherite_helmet 1;get netherite_chestplate 1;get netherite_leggings 1;" +
                "get netherite_boots 1;equip netherite";
    }

    private static String netheriteGearCommands() {
        return netheriteArmorCommands() + ";get netherite_sword 1;get netherite_pickaxe 1;equip netherite_sword";
    }

    private static String sequenceCommand(JsonObject body, String ownerName) {
        JsonArray steps = body.getAsJsonArray("steps");
        if (steps == null || steps.size() < 1 || steps.size() > 8) throw new IllegalArgumentException("Sequence must contain 1–8 steps.");
        List<String> commands = new ArrayList<>();
        for (JsonElement element : steps) {
            if (!element.isJsonObject()) throw new IllegalArgumentException("Sequence step must be an object.");
            JsonObject step = element.getAsJsonObject();
            if (step.has("goal") && "sequence".equals(string(step, "goal"))) throw new IllegalArgumentException("Nested sequences are not supported.");
            commands.add(mapGoal(step, ownerName));
        }
        return String.join(";", commands);
    }

    private static String buildCommand(JsonObject body) {
        JsonObject p = body.getAsJsonObject("position");
        int x = coordinate(p, "x"), y = coordinate(p, "y"), z = coordinate(p, "z");
        int length = bounded(body, "length", 1, 8);
        String block = item(body, "block");
        String axis = string(body, "axis");
        if (!List.of("cobblestone", "dirt", "oak_planks", "spruce_planks", "birch_planks", "stone_bricks", "netherrack").contains(block))
            throw new IllegalArgumentException("Build block is not in the Guardian allowlist.");
        if (!List.of("x+", "x-", "z+", "z-").contains(axis)) throw new IllegalArgumentException("Build axis is invalid.");
        return "build_structure Build a straight " + length + "-block wall of " + block +
                " starting at position (" + x + ", " + y + ", " + z + ") extending " + axis + ". [use inventory]";
    }

    private static String farmCommand(JsonObject body) {
        JsonObject p = body.getAsJsonObject("position");
        int x = coordinate(p, "x"), y = coordinate(p, "y"), z = coordinate(p, "z");
        return "farm 16 " + x + " " + y + " " + z;
    }

    private static String placeCommand(JsonObject body) {
        String block = item(body, "item");
        JsonObject ref = body.getAsJsonObject("reference");
        JsonObject face = body.getAsJsonObject("face");
        int x = coordinate(ref, "x") + coordinate(face, "x");
        int y = coordinate(ref, "y") + coordinate(face, "y");
        int z = coordinate(ref, "z") + coordinate(face, "z");
        return "build_structure Place one " + block + " block at position (" + x + ", " + y + ", " + z + "). [use inventory]";
    }

    private static String gotoCommand(JsonObject position) {
        if (position == null) throw new IllegalArgumentException("Destination coordinates are required.");
        return "goto " + coordinate(position, "x") + " " + coordinate(position, "y") + " " + coordinate(position, "z");
    }

    private static String resource(String value) {
        return switch (value) {
            case "logs" -> "log";
            case "planks" -> "planks";
            case "sticks" -> "stick";
            case "cobblestone", "raw_iron", "iron_ingot", "diamond", "obsidian", "flint", "netherrack" -> value;
            default -> throw new IllegalArgumentException("Resource is not in the reviewed gather allowlist.");
        };
    }

    private static String item(JsonObject body, String key) {
        String value = string(body, key);
        if (!ITEM_NAME.matcher(value).matches()) throw new IllegalArgumentException("Invalid Minecraft item id.");
        return value;
    }

    private static int bounded(JsonObject body, String key, int min, int max) {
        if (!body.has(key) || !body.get(key).isJsonPrimitive() || !body.getAsJsonPrimitive(key).isNumber())
            throw new IllegalArgumentException(key + " must be an integer.");
        double raw = body.get(key).getAsDouble();
        if (raw != Math.rint(raw) || raw < min || raw > max) throw new IllegalArgumentException(key + " is outside the allowed range.");
        return (int) raw;
    }

    private static int coordinate(JsonObject body, String key) {
        if (body == null || !body.has(key) || !body.get(key).isJsonPrimitive() || !body.getAsJsonPrimitive(key).isNumber())
            throw new IllegalArgumentException("Coordinate " + key + " is missing.");
        double raw = body.get(key).getAsDouble();
        if (raw != Math.rint(raw) || Math.abs(raw) > 30_000_000) throw new IllegalArgumentException("Coordinate is outside the allowed world range.");
        return (int) raw;
    }

    private static JsonObject cancelTask(UUID id) {
        TaskReceipt receipt = TASKS.get(id);
        if (receipt == null) return error("Unknown task receipt.");
        if (!"queued".equals(receipt.state) && !"running".equals(receipt.state)) return receipt.toJson();
        CompanionEntity companion = findCompanion(gameServer, receipt.companionId);
        if (companion == null || companion.getController() == null) return error("Companion is not available for cancellation.");
        receipt.state = "cancelled";
        receipt.error = "JARVIS requested cancellation; physical game effects may take a tick to settle.";
        receipt.finishedAt = System.currentTimeMillis();
        companion.getController().cancelUserTask();
        ACTIVE_BY_COMPANION.remove(companion.getUUID(), receipt.id);
        return receipt.toJson();
    }

    private static JsonObject stopOwner(String ownerName, String companionName) {
        MinecraftServer server = gameServer;
        if (!validPlayer(ownerName)) return error("ownerName is required.");
        var owner = server.getPlayerList().getPlayerByName(ownerName);
        if (owner == null) return error("Owner is not online.");
        List<CompanionEntity> companions = ownedCompanions(server, owner.getUUID(), companionName);
        if (companions.isEmpty()) return error("No owned companion exists.");
        for (CompanionEntity companion : companions) {
            UUID active = ACTIVE_BY_COMPANION.get(companion.getUUID());
            if (active != null) cancelTask(active);
            if (companion.getController() != null) companion.getController().cancelUserTask();
        }
        JsonObject out = new JsonObject();
        out.addProperty("ok", true);
        out.addProperty("stopRequested", true);
        out.addProperty("physicallyStoppedVerified", false);
        out.addProperty("companionsAffected", companions.size());
        return out;
    }

    private static CompanionEntity findCompanion(MinecraftServer server, UUID id) {
        if (server == null || id == null) return null;
        for (ServerLevel world : server.getAllLevels()) {
            for (Entity entity : world.getAllEntities()) {
                if (entity instanceof CompanionEntity companion && id.equals(companion.getUUID())) return companion;
            }
        }
        return null;
    }

    private static JsonObject wrapArray(JsonArray array) {
        JsonObject out = new JsonObject();
        out.addProperty("ok", true);
        out.add("companions", array);
        return out;
    }

    private static Map<String, String> query(HttpExchange exchange) {
        java.util.HashMap<String, String> values = new java.util.HashMap<>();
        String raw = exchange.getRequestURI().getRawQuery();
        if (raw == null || raw.isBlank()) return values;
        for (String pair : raw.split("&")) {
            String[] parts = pair.split("=", 2);
            values.put(URLDecoder.decode(parts[0], StandardCharsets.UTF_8),
                    parts.length == 2 ? URLDecoder.decode(parts[1], StandardCharsets.UTF_8) : "");
        }
        return values;
    }

    private static boolean validPlayer(String value) {
        return value != null && PLAYER_NAME.matcher(value).matches();
    }

    private static UUID parseUuid(String value) {
        try { return value != null && UUID_TEXT.matcher(value).matches() ? UUID.fromString(value) : null; }
        catch (IllegalArgumentException ignored) { return null; }
    }

    private static String string(JsonObject object, String key) {
        return object != null && object.has(key) && object.get(key).isJsonPrimitive()
                ? object.get(key).getAsString() : "";
    }

    private static String string(String value) { return value == null ? "" : value; }

    private static JsonObject error(String message) {
        JsonObject out = new JsonObject();
        out.addProperty("ok", false);
        out.addProperty("error", message == null ? "Request failed." : message.substring(0, Math.min(500, message.length())));
        return out;
    }

    private static String safeError(Throwable error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName()
                : message.substring(0, Math.min(300, message.length()));
    }

    private static void trimTasks() {
        while (TASKS.size() > MAX_TASKS) {
            UUID oldest = TASK_ORDER.pollFirst();
            if (oldest == null) break;
            TaskReceipt record = TASKS.get(oldest);
            if (record != null && ("queued".equals(record.state) || "running".equals(record.state))) {
                TASK_ORDER.addLast(oldest);
                break;
            }
            TASKS.remove(oldest);
        }
    }

    private static final class BridgeConfig {
        final boolean enabled;
        final int port;
        final String token;
        BridgeConfig(boolean enabled, int port, String token) {
            this.enabled = enabled; this.port = port; this.token = token;
        }
    }

    private static final class TaskReceipt {
        final UUID id;
        final UUID companionId;
        final String ownerName;
        final String goal;
        final String command;
        volatile String state = "queued";
        volatile String error = "";
        volatile long startedAt = 0;
        volatile long finishedAt = 0;
        TaskReceipt(UUID id, UUID companionId, String ownerName, String goal, String command) {
            this.id = id; this.companionId = companionId; this.ownerName = ownerName; this.goal = goal; this.command = command;
        }
        JsonObject toJson() {
            JsonObject out = new JsonObject();
            out.addProperty("ok", !"failed".equals(state) && !"interrupted".equals(state));
            out.addProperty("taskId", id.toString());
            out.addProperty("companionId", companionId.toString());
            out.addProperty("goal", goal);
            out.addProperty("state", state);
            out.addProperty("accepted", !"failed".equals(state));
            out.addProperty("completed", "completed".equals(state));
            out.addProperty("verified", false);
            out.addProperty("command", command);
            out.addProperty("error", error);
            out.addProperty("startedAt", startedAt);
            out.addProperty("finishedAt", finishedAt);
            return out;
        }
    }

    private static final class BodyTooLarge extends Exception {}
}
