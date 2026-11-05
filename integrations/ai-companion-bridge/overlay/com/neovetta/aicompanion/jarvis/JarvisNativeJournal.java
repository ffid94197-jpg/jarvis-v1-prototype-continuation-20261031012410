package com.neovetta.aicompanion.jarvis;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Durable, no-secrets intent journal for the JARVIS native gameplay bridge.
 *
 * A crash between task admission and a verified receipt must never turn into
 * an unconditional retry. Each effect writes ADMITTED BEFORE touching AltoClef,
 * then a terminal outcome only after the game-server postcondition is observed.
 *
 * On restart, every ADMITTED or EFFECT_UNKNOWN record quarantines that owner
 * companion. Only a separately authorized owner RESUME can explicitly mark
 * the prior effect as RECONCILED_UNKNOWN. It NEVER resurrects the old task.
 *
 * All calls must run on the Minecraft server thread. This is not a substitute
 * for the Core's independent Guardian audit or database effect journal.
 */
final class JarvisNativeJournal {
    private static final int MAX_RECORDS = 100_000;
    private final Path root;
    private final Set<UUID> known = new HashSet<>();
    private final Map<UUID, UUID> pending = new HashMap<>();
    private final Map<UUID, JsonObject> records = new HashMap<>();

    private JarvisNativeJournal(Path root) {this.root=root;}

    static JarvisNativeJournal load() throws IOException {
        Path root=FabricLoader.getInstance().getConfigDir().resolve("jarvis-native-ledger");
        Files.createDirectories(root);
        JarvisNativeJournal ledger=new JarvisNativeJournal(root);
        try (DirectoryStream<Path> ds=Files.newDirectoryStream(root)) {
            for (Path file:ds) {
                String name=file.getFileName().toString();
                if (name.endsWith(".pending")) {
                    throw new IOException("Unfinished native journal transaction: "+name);
                }
                if (!name.endsWith(".json")) continue;
                if (ledger.known.size()>=MAX_RECORDS)
                    throw new IOException("Native journal capacity exhausted");
                String key=name.substring(0,name.length()-5);
                UUID id;
                try { id=UUID.fromString(key); }
                catch (IllegalArgumentException ex) {
                    throw new IOException("Malformed native journal file name",ex);
                }
                JsonObject row;
                try {
                    row=JsonParser.parseString(Files.readString(file,StandardCharsets.UTF_8)).getAsJsonObject();
                    if (!id.toString().equals(row.get("runId").getAsString()))
                        throw new IllegalArgumentException("journal name mismatch");
                    UUID.fromString(row.get("coreTaskId").getAsString());
                    UUID.fromString(row.get("companionUuid").getAsString());
                } catch (Exception ex) {
                    throw new IOException("Corrupt native journal record; refusing gameplay",ex);
                }
                if (!ledger.known.add(id))
                    throw new IOException("Duplicate native journal run");
                ledger.records.put(id,row);
                String state=row.get("state").getAsString();
                if ("ADMITTED".equals(state)||"EFFECT_UNKNOWN".equals(state)) {
                    ledger.pending.put(id,UUID.fromString(row.get("companionUuid").getAsString()));
                } else if (!Set.of("OBSERVED","FAILED","CANCELLED","RECONCILED_UNKNOWN").contains(state)) {
                    throw new IOException("Unknown terminal native journal state: "+state);
                }
            }
        }
        return ledger;
    }

    boolean hasUnresolved(UUID companion) {
        return pending.containsValue(companion);
    }

    boolean known(UUID runId) {return known.contains(runId);}

    /** An unloaded but once-owned entity may still exist in a saved chunk.
     * Never spawn a second configured UUID just because it is not loaded.
     * Owner/admin reconciliation of old world state is a separate operation.
     */
    boolean hasSpawnHistory(UUID companion) {
        for(JsonObject record:records.values()){
            if(record.has("operation") && record.has("companionUuid") &&
               "spawn".equals(record.get("operation").getAsString()) &&
               companion.toString().equals(record.get("companionUuid").getAsString()))
                return true;
        }
        return false;
    }

    void admit(UUID runId,UUID coreTaskId,UUID companion,String world,String op) throws IOException {
        if (known.size()>=MAX_RECORDS) throw new IOException("Native journal full");
        if (known.contains(runId)) throw new IOException("Duplicate native mutation ID");
        if (hasUnresolved(companion)) throw new IOException("Native effect reconciliation required");
        JsonObject record=new JsonObject();
        record.addProperty("version",1);
        record.addProperty("runId",runId.toString());
        record.addProperty("coreTaskId",coreTaskId.toString());
        record.addProperty("companionUuid",companion.toString());
        record.addProperty("worldId",world);
        record.addProperty("operation",op);
        record.addProperty("state","ADMITTED");
        record.addProperty("admittedAt",System.currentTimeMillis());
        write(runId,record);
        known.add(runId);
        records.put(runId,record);
        pending.put(runId,companion);
    }

    void settle(UUID runId,String status) throws IOException {
        if (!Set.of("OBSERVED","FAILED","CANCELLED","EFFECT_UNKNOWN").contains(status))
            throw new IOException("Invalid native terminal outcome");
        JsonObject prior=records.get(runId);
        if(prior==null || !known.contains(runId))throw new IOException("Unknown native effect");
        JsonObject updated=prior.deepCopy();
        updated.addProperty("state",status);
        updated.addProperty("settledAt",System.currentTimeMillis());
        write(runId,updated);
        records.put(runId,updated);
        if (status.equals("EFFECT_UNKNOWN")) {
            pending.put(runId,UUID.fromString(prior.get("companionUuid").getAsString()));
        } else pending.remove(runId);
    }

    void reconcileAfterExplicitOwnerResume(UUID companion) throws IOException {
        Set<UUID> affected=new HashSet<>();
        for(Map.Entry<UUID,UUID> entry:pending.entrySet())
            if(entry.getValue().equals(companion))affected.add(entry.getKey());
        for(UUID id:affected) {
            JsonObject prior=records.get(id);
            JsonObject updated=prior.deepCopy();
            updated.addProperty("state","RECONCILED_UNKNOWN");
            updated.addProperty("settledAt",System.currentTimeMillis());
            // If any durable write fails, the remaining pending records stay
            // quarantined. Already reconciled writes remain truthful.
            write(id,updated);
            records.put(id,updated);
            pending.remove(id);
        }
    }

    private void write(UUID runId,JsonObject row) throws IOException {
        Path target=root.resolve(runId.toString()+".json");
        Path temp=root.resolve(runId.toString()+".pending");
        byte[] content=row.toString().getBytes(StandardCharsets.UTF_8);
        try (FileChannel ch=FileChannel.open(temp,
                StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE)) {
            ByteBuffer buffer=ByteBuffer.wrap(content);
            while(buffer.hasRemaining())ch.write(buffer);
            ch.force(true);
        }
        try {
            Files.move(temp,target,StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } catch(IOException ex) {
            // Retain pending marker so next boot refuses to guess.
            throw new IOException("Native journal atomic commit failed",ex);
        }
    }
}
