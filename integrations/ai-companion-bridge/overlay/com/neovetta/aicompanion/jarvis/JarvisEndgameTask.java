package com.neovetta.aicompanion.jarvis;

import adris.altoclef.AltoClefController;
import adris.altoclef.TaskCatalogue;
import adris.altoclef.tasks.misc.EquipArmorTask;
import adris.altoclef.tasks.misc.HoldItemTask;
import adris.altoclef.tasks.speedrun.beatgame.BeatMinecraftTask;
import adris.altoclef.tasksystem.Task;
import adris.altoclef.util.ItemTarget;
import com.google.gson.JsonObject;
import com.neovetta.aicompanion.entity.CompanionEntity;
import net.minecraft.block.Blocks;
import net.minecraft.entity.Entity;
import net.minecraft.entity.boss.dragon.EnderDragonEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;

/**
 * One JARVIS-owned mission, carried out by the native AltoClef task runner.
 *
 * No LLM or additional agent is created here. Each subtask is an upstream
 * AltoClef action. The final isFinished() predicate is based on actual server
 * world evidence, never on text, dispatch, or an existing inventory alone.
 *
 * Does not resurrect past completion on restart. A game/server restart ends
 * this run; the Core must reconcile and authorize a fresh one.
 */
public final class JarvisEndgameTask extends Task {
    private static final String[] ARMOR_NAMES = {
        "netherite_boots","netherite_leggings",
        "netherite_chestplate","netherite_helmet"
    };
    private static final Item[] ARMOR_ITEMS = {
        Items.NETHERITE_BOOTS, Items.NETHERITE_LEGGINGS,
        Items.NETHERITE_CHESTPLATE, Items.NETHERITE_HELMET
    };
    private final CompanionEntity companion;
    private final String goal;
    private final boolean needsDragon;
    private final boolean needsArmor;
    private final boolean needsSword;
    private final boolean dragonFirst;
    private final BeatMinecraftTask beatTask;
    private final long since = System.currentTimeMillis();
    private boolean initialDragonKilled;
    private boolean dragonSeen;
    private boolean dragonKilled;
    private boolean exitPortalObserved;
    private boolean endReturned;
    private boolean netheriteEquipped;
    private boolean completed;
    private boolean interrupted;
    private String stage = "admitted";
    private long lastWorldSample;

    public JarvisEndgameTask(CompanionEntity companion, String goal) {
        this.companion=companion;
        this.goal=goal;
        this.needsDragon=goal.equals("dragon_run") ||
                goal.equals("netherite_dragon_run") ||
                goal.equals("dragon_then_netherite_run");
        this.needsArmor=!goal.equals("dragon_run");
        this.needsSword=goal.equals("netherite_gear_run") ||
                goal.equals("netherite_dragon_run") ||
                goal.equals("dragon_then_netherite_run");
        this.dragonFirst=goal.equals("dragon_run") ||
                goal.equals("dragon_then_netherite_run");
        if(!java.util.Set.of("dragon_run","netherite_armor_run",
                "netherite_gear_run","netherite_dragon_run",
                "dragon_then_netherite_run").contains(goal))
            throw new IllegalArgumentException("unsupported-endgame-goal");

        MinecraftServer server=companion.getServer();
        if(server==null)throw new IllegalArgumentException("game-server-unavailable");
        ServerWorld end=server.getWorld(World.END);
        if(needsDragon && (end==null || end.getEnderDragonFight()==null))
            throw new IllegalArgumentException("End-fight-not-available");
        initialDragonKilled=needsDragon &&
                end.getEnderDragonFight().hasPreviouslyKilled();
        if(initialDragonKilled)
            throw new IllegalArgumentException("Dragon already defeated before this mission; cannot claim a new kill");
        // The upstream constructor reads its static config; initialize first
        // to preserve pinned BeatMinecraftTask's expected lifecycle.
        BeatMinecraftTask.getConfig();
        this.beatTask=needsDragon?
                new BeatMinecraftTask(companion.getController()):null;
    }

    public String goal() { return goal; }
    public long since() { return since; }
    public String stage() { return stage; }
    public boolean completed() { return completed; }
    public boolean dragonKilled() { return dragonKilled; }
    public boolean exitPortalObserved() { return exitPortalObserved; }
    public boolean endReturned() { return endReturned; }
    public boolean netheriteEquipped() { return netheriteEquipped; }

    @Override protected void onStart() {
        stage="running";
    }

    private boolean wearingNetherite() {
        for(int i=0;i<ARMOR_NAMES.length;i++){
            ItemStack equipped=companion.getLivingInventory().armor.get(i);
            if(equipped.isEmpty()||equipped.getItem()!=ARMOR_ITEMS[i])return false;
        }
        return true;
    }
    private boolean holdingSword() {
        ItemStack stack=companion.getLivingInventory().getMainHandStack();
        return !stack.isEmpty() && stack.getItem()==Items.NETHERITE_SWORD;
    }
    private boolean hasInInventory(Item item) {
        for(ItemStack stack:companion.getLivingInventory().main)
            if(!stack.isEmpty()&&stack.getItem()==item)return true;
        return false;
    }

    private void sampleRealDragon() {
        if(!needsDragon || initialDragonKilled)return;
        long now=System.currentTimeMillis();
        if(now-lastWorldSample<600)return;
        lastWorldSample=now;
        MinecraftServer server=companion.getServer();
        if(server==null)return;
        ServerWorld end=server.getWorld(World.END);
        if(end==null||end.getEnderDragonFight()==null)return;
        for(Entity entity:end.iterateEntities()){
            if(entity instanceof EnderDragonEntity && entity.isAlive()){
                dragonSeen=true;
                break;
            }
        }
        boolean killedFlag=end.getEnderDragonFight().hasPreviouslyKilled();
        if(dragonSeen && killedFlag)dragonKilled=true;
        // The vanilla exit portal is generated at x=z=0 after a successful
        // fight. Read loaded blocks only; never force a chunk to load.
        if(dragonKilled && end.getChunkManager().isChunkLoaded(0,0)){
            for(int y=0;y<=128;y++){
                BlockPos pos=new BlockPos(0,y,0);
                if(end.getBlockState(pos).isOf(Blocks.END_PORTAL)){
                    exitPortalObserved=true;
                    break;
                }
            }
        }
        if(dragonKilled && exitPortalObserved &&
                companion.getWorld().getRegistryKey().equals(World.OVERWORLD))
            endReturned=true;
    }

    @Override protected Task onTick() {
        if(interrupted || completed)return null;
        sampleRealDragon();
        if(needsDragon && dragonFirst && !endReturned){
            stage="dragon_fight_and_return";
            return beatTask;
        }
        if(needsArmor && !wearingNetherite()){
            for(int i=0;i<ARMOR_NAMES.length;i++){
                ItemStack equipped=companion.getLivingInventory().armor.get(i);
                if(!equipped.isEmpty()&&equipped.getItem()==ARMOR_ITEMS[i])
                    continue;
                if(!hasInInventory(ARMOR_ITEMS[i])){
                    stage="smith_"+ARMOR_NAMES[i];
                    return TaskCatalogue.getItemTask(ARMOR_NAMES[i],1);
                }
                stage="equip_"+ARMOR_NAMES[i];
                return new EquipArmorTask(ARMOR_ITEMS[i]);
            }
        }
        netheriteEquipped=wearingNetherite();
        if(needsSword && !holdingSword()){
            if(!hasInInventory(Items.NETHERITE_SWORD)){
                stage="smith_netherite_sword";
                return TaskCatalogue.getItemTask("netherite_sword",1);
            }
            stage="hold_netherite_sword";
            return new HoldItemTask(new ItemTarget(Items.NETHERITE_SWORD));
        }
        if(needsDragon && !endReturned){
            stage="dragon_fight_and_return";
            return beatTask;
        }
        // Require the same mission's End progression plus the exact
        // current equipped slots; no historical world flag grants success.
        netheriteEquipped=wearingNetherite();
        completed=(!needsDragon ||
                (dragonSeen && dragonKilled && exitPortalObserved && endReturned)) &&
                (!needsArmor || netheriteEquipped) &&
                (!needsSword || holdingSword());
        stage=completed?"complete":"awaiting_game_proof";
        return null;
    }

    public JsonObject milestones() {
        // Re-sample while the task is running or after its callback so
        // a signed status never relies solely on an AltoClef callback.
        sampleRealDragon();
        netheriteEquipped=wearingNetherite();
        JsonObject out=new JsonObject();
        out.addProperty("dragonSeen",dragonSeen);
        out.addProperty("dragonKilled",dragonKilled);
        out.addProperty("exitPortalObserved",exitPortalObserved);
        out.addProperty("endReturned",endReturned);
        out.addProperty("netheriteEquipped",netheriteEquipped && (!needsSword || holdingSword()));
        out.addProperty("armorEquipped",netheriteEquipped);
        out.addProperty("swordHeld",holdingSword());
        out.addProperty("nativeStage",stage);
        out.addProperty("missionComplete",completed);
        return out;
    }

    @Override protected void onStop(Task interruptTask) {
        if(!completed) interrupted=true;
    }
    @Override public boolean isFinished(){return completed;}
    @Override protected boolean isEqual(Task other) {
        return other instanceof JarvisEndgameTask t &&
            t.goal.equals(goal) && t.since==since;
    }
    @Override protected String toDebugString(){
        return "JARVIS native endgame: "+goal+" / "+stage;
    }
}
