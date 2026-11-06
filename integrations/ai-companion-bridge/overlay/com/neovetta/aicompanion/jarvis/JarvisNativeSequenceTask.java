package com.neovetta.aicompanion.jarvis;

import adris.altoclef.TaskCatalogue;
import adris.altoclef.tasks.container.SmeltInFurnaceTask;
import adris.altoclef.tasks.resources.CollectCropTask;
import adris.altoclef.tasks.entity.KillEntityTask;
import adris.altoclef.tasks.misc.EquipArmorTask;
import adris.altoclef.tasks.misc.HoldItemTask;
import adris.altoclef.tasks.movement.GetToBlockTask;
import adris.altoclef.tasks.construction.PlaceBlockTask;
import adris.altoclef.tasksystem.Task;
import adris.altoclef.util.ItemTarget;
import adris.altoclef.util.SmeltTarget;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.neovetta.aicompanion.entity.CompanionEntity;
import net.minecraft.block.Block;
import net.minecraft.block.Blocks;
import net.minecraft.block.CropBlock;
import net.minecraft.block.BlockState;
import net.minecraft.entity.Entity;
import net.minecraft.entity.mob.HostileEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** JARVIS-owned bounded sequence of upstream AltoClef tasks.
 * Typed plans only; no shell, model code, free-form command interpreter or
 * direct crafting/inventory mutation. Each stage advances after a real
 * postcondition and never repeats after an ambiguous result.
 */
public final class JarvisNativeSequenceTask extends Task {
    private static final Set<String> GATHER=Set.of("logs","planks","sticks","cobblestone","raw_iron","iron_ingot",
        "diamond","obsidian","flint","netherrack","dirt","sand","red_sand","gravel","mud",
        "soul_sand","soul_soil","moss_block","andesite","diorite","granite","tuff","calcite",
        "cobbled_deepslate","blackstone","basalt","coal","raw_copper","raw_gold","redstone",
        "lapis_lazuli","emerald","quartz");
    private static final Set<String> BUILD_BLOCKS=Set.of(
        "cobblestone","cobbled_deepslate","stone","dirt",
        "oak_planks","spruce_planks","birch_planks","stone_bricks",
        "oak_log","glass","sandstone","netherrack");
    private static final Set<String> CRAFT=Set.of("stick","crafting_table","chest",
        "furnace","ladder","bread","shield","torch");
    private static final Map<String,String> SMELT=Map.of(
        "iron_ingot","raw_iron","gold_ingot","raw_gold","glass","sand",
        "charcoal","log","netherite_scrap","ancient_debris",
        "cooked_beef","beef","cooked_porkchop","porkchop",
        "cooked_chicken","chicken");
    private final CompanionEntity entity;
    private final ServerPlayerEntity owner;
    private boolean transferVerified,tradeVerified,enchantVerified;
    private final List<JsonObject> steps=new ArrayList<>();
    private int index;
    private Task current;
    private boolean failed;
    private String stage="admitted";
    private String currentItem;
    private int currentBefore;
    private int currentQuantity;
    private String equipmentSlot;
    private BlockPos destination;
    private int arrivalRange;
    private int equipmentProgress;
    private String[] equipmentTargets;
    private BlockPos[] construction;
    private String constructionMaterial;
    private int constructionIndex;
    private JarvisNativeVolumeTask volumeStage;
    private Block cropBlock;
    private String cropItem;
    private int cropInitialCount;
    private int cropTargetCount;
    private int harvestedCropCount;
    private final Set<BlockPos> cropCells=new HashSet<>();
    private final Map<BlockPos,Integer> lastCropAge=new HashMap<>();
    private Entity combatTarget;
    private String combatMob;
    private final long since=System.currentTimeMillis();

    public JarvisNativeSequenceTask(CompanionEntity entity,ServerPlayerEntity owner,JsonArray input){
        this.entity=entity;
        this.owner=owner;
        if(input==null||input.size()<1||input.size()>8)
            throw new IllegalArgumentException("stage-count");
        for(JsonElement element:input){
            if(!element.isJsonObject())throw new IllegalArgumentException("stage-shape");
            JsonObject row=element.getAsJsonObject();
            if(row.size()<1||row.size()>11)
                throw new IllegalArgumentException("stage-width");
            String goal=row.get("goal").getAsString();
            if(!Set.of("gather","craft","smelt","equip","travel","tools","stone_age","iron_age","build",
                "farm_wheat","farm_crop","build_volume","shelter","defeat_hostile","transfer","trade","enchant").contains(goal))
                throw new IllegalArgumentException("unsupported-native-stage");
            // Validate the ENTIRE owner's declared sequence before admitting
            // the first effect; no partially executed surprise operations.
            validateStage(row,goal);
            steps.add(row.deepCopy());
        }
    }
    private static void validateStage(JsonObject row,String goal) {
        int count;
        if(Set.of("gather","craft","smelt").contains(goal)){
            if(row.size()!=3)throw new IllegalArgumentException("item-stage-fields");
            String item=goal.equals("gather")?row.get("resource").getAsString():
                row.get("item").getAsString();
            count=row.get("targetCount").getAsInt();
            if(count<1||count>64 || (!goal.equals("gather") && count>16))
                throw new IllegalArgumentException("stage-count");
            if(!(goal.equals("gather")?GATHER:goal.equals("craft")?CRAFT:SMELT.keySet()).contains(item))
                throw new IllegalArgumentException("stage-resource");
        } else if(Set.of("tools","stone_age","iron_age").contains(goal)) {
            if(row.size()!=1)throw new IllegalArgumentException("preset-has-unexpected-arguments");
        } else if(goal.equals("build")) {
            if(row.size()!=5)throw new IllegalArgumentException("build-stage-fields");
            JsonObject point=row.getAsJsonObject("position");
            if(point==null || point.size()!=3)throw new IllegalArgumentException("build-stage-position");
            for(String k:List.of("x","y","z"))
                if(!point.has(k)||Math.abs(point.get(k).getAsInt())>29999980)
                    throw new IllegalArgumentException("build-stage-coordinate");
            String material=row.get("block").getAsString();
            if(!BUILD_BLOCKS.contains(material))
                throw new IllegalArgumentException("build-stage-material");
            String axis=row.get("axis").getAsString();
            int length=row.get("length").getAsInt();
            if(!Set.of("x+","x-","z+","z-").contains(axis)||length<1||length>8)
                throw new IllegalArgumentException("build-stage-size");
        } else if(goal.equals("transfer")) {
            if(row.size()!=5)throw new IllegalArgumentException("transfer-stage-fields");
            JsonObject point=row.getAsJsonObject("position");
            if(point==null||point.size()!=3)throw new IllegalArgumentException("transfer-stage-position");
            for(String k:List.of("x","y","z"))
                if(!point.has(k)||Math.abs(point.get(k).getAsInt())>29999984)
                    throw new IllegalArgumentException("transfer-stage-coordinate");
            if(!row.get("item").getAsString().matches("[a-z0-9_]{1,64}")||
               row.get("targetCount").getAsInt()<1||row.get("targetCount").getAsInt()>64||
               !Set.of("deposit","withdraw").contains(row.get("operation").getAsString()))
                throw new IllegalArgumentException("transfer-stage-bounds");
        } else if(goal.equals("trade")) {
            if(row.size()!=11)throw new IllegalArgumentException("trade-stage-fields");
            int id=row.get("entityId").getAsInt(),offer=row.get("offerIndex").getAsInt(),
                times=row.get("times").getAsInt(),uses=row.get("expectedUses").getAsInt();
            String first=row.get("expectedFirstItem").getAsString();
            String second=row.get("expectedSecondItem").getAsString();
            String output=row.get("expectedOutputItem").getAsString();
            if(id<0||id>200000||offer<0||offer>7||times<1||times>4||
               uses<0||uses>10000||
               !first.matches("minecraft:[a-z0-9_]{1,64}")||
               !(second.isEmpty()||second.matches("minecraft:[a-z0-9_]{1,64}"))||
               !output.matches("minecraft:[a-z0-9_]{1,64}")||
               row.get("expectedFirstCount").getAsInt()<1||row.get("expectedFirstCount").getAsInt()>64||
               row.get("expectedSecondCount").getAsInt()<0||row.get("expectedSecondCount").getAsInt()>64||
               row.get("expectedOutputCount").getAsInt()<1||row.get("expectedOutputCount").getAsInt()>64)
                throw new IllegalArgumentException("trade-stage-bounds");
        } else if(goal.equals("enchant")) {
            if(row.size()!=5||!row.get("ownerXpConsent").getAsBoolean())
                throw new IllegalArgumentException("enchant-stage-owner-consent");
            JsonObject point=row.getAsJsonObject("position");
            if(point==null||point.size()!=3)throw new IllegalArgumentException("enchant-stage-position");
            for(String k:List.of("x","y","z"))
                if(!point.has(k)||Math.abs(point.get(k).getAsInt())>29999984)
                    throw new IllegalArgumentException("enchant-stage-coordinate");
            if(!row.get("item").getAsString().matches("[a-z0-9_]{1,64}")||
               row.get("choice").getAsInt()<0||row.get("choice").getAsInt()>2)
                throw new IllegalArgumentException("enchant-stage-bounds");
        } else if(Set.of("farm_wheat","farm_crop").contains(goal)) {
            String crop=goal.equals("farm_wheat")?"wheat":row.get("crop").getAsString();
            if((goal.equals("farm_wheat") && row.size()!=5) ||
               (goal.equals("farm_crop") && row.size()!=6) ||
               !Set.of("wheat","carrots","potatoes","beetroot").contains(crop) ||
               (goal.equals("farm_crop") && crop.equals("wheat")))
                throw new IllegalArgumentException("farm-stage-fields-or-crop");
            int width=row.get("width").getAsInt(),depth=row.get("depth").getAsInt();
            int target=row.get("targetCount").getAsInt();
            JsonObject point=row.getAsJsonObject("position");
            if(width<1||width>4||depth<1||depth>4||target<1||target>16||
               point==null||point.size()!=3)
                throw new IllegalArgumentException("farm-stage-bounds");
            for(String k:List.of("x","y","z"))
                if(!point.has(k)||Math.abs(point.get(k).getAsInt())>29999984)
                    throw new IllegalArgumentException("farm-stage-coordinate");
        } else if(goal.equals("build_volume")) {
            if(row.size()!=7)throw new IllegalArgumentException("volume-stage-fields");
            JsonObject point=row.getAsJsonObject("position");
            if(point==null||point.size()!=3)throw new IllegalArgumentException("volume-stage-position");
            for(String k:List.of("x","y","z"))
                if(!point.has(k)||Math.abs(point.get(k).getAsInt())>29999984)
                    throw new IllegalArgumentException("volume-stage-coordinate");
            String material=row.get("block").getAsString();
            int width=row.get("width").getAsInt(),depth=row.get("depth").getAsInt(),
                height=row.get("height").getAsInt();
            String shape=row.get("shape").getAsString();
            if(!BUILD_BLOCKS.contains(material)||
               width<1||width>4||depth<1||depth>4||height<1||height>3||
               width*depth*height>64||
               !Set.of("floor","walls","solid","roof").contains(shape)||
               ((shape.equals("floor")||shape.equals("roof"))&&height!=1))
                throw new IllegalArgumentException("volume-stage-bounds");
        } else if(goal.equals("shelter")) {
            if(row.size()!=1&&row.size()!=3)throw new IllegalArgumentException("shelter-stage-fields");
            if(row.has("width")&&(row.get("width").getAsInt()<3||row.get("width").getAsInt()>4 ||
               row.get("depth").getAsInt()<3||row.get("depth").getAsInt()>4))
                throw new IllegalArgumentException("shelter-stage-bounds");
        } else if(goal.equals("defeat_hostile")) {
            if(row.size()!=3)throw new IllegalArgumentException("combat-stage-fields");
            String mob=row.get("mob").getAsString();
            int id=row.get("entityId").getAsInt();
            if(!Set.of("zombie","husk","drowned","skeleton","stray","spider","cave_spider",
                    "witch","pillager","blaze","endermite","silverfish","slime","magma_cube",
                    "zoglin","hoglin","phantom","wither_skeleton").contains(mob) ||
               id<0||id>200000)
                throw new IllegalArgumentException("combat-stage-target");
        } else if(goal.equals("equip")){
            if(row.size()!=3)throw new IllegalArgumentException("equip-stage-fields");
            String item=row.get("item").getAsString();
            String slot=row.get("destination").getAsString();
            if(!item.matches("[a-z0-9_]{1,64}") ||
                 !Set.of("hand","head","torso","legs","feet").contains(slot))
                throw new IllegalArgumentException("stage-equip");
            if(!"hand".equals(slot) && !(item.endsWith("_helmet") && slot.equals("head") ||
                item.endsWith("_chestplate") && slot.equals("torso") ||
                item.endsWith("_leggings") && slot.equals("legs") ||
                item.endsWith("_boots") && slot.equals("feet")))
                throw new IllegalArgumentException("stage-armor-slot");
        } else if(goal.equals("travel")) {
            if(row.size()!=3)throw new IllegalArgumentException("travel-stage-fields");
            JsonObject p=row.getAsJsonObject("destination");
            if(p==null || p.size()!=3)throw new IllegalArgumentException("stage-position");
            for(String key:List.of("x","y","z")){
                int v=p.get(key).getAsInt();
                if(Math.abs(v)>29999984)throw new IllegalArgumentException("stage-world-bounds");
            }
            int range=row.get("arrivalRange").getAsInt();
            if(range<1||range>8)throw new IllegalArgumentException("stage-arrival");
        }
    }
    public long since(){return since;}
    public int index(){return index;}
    public int total(){return steps.size();}
    public String stage(){return stage;}

    private int count(String wanted){
        int n=0;
        for(ItemStack stack:entity.getLivingInventory().main){
            if(stack.isEmpty())continue;
            String name=Registries.ITEM.getId(stack.getItem()).getPath();
            if(name.equals(wanted)||"log".equals(wanted)&&name.endsWith("_log"))
                n+=stack.getCount();
        }
        return n;
    }
    private boolean wearing(String item,String slot){
        if("hand".equals(slot)){
            ItemStack held=entity.getLivingInventory().getMainHandStack();
            return !held.isEmpty() && Registries.ITEM.getId(held.getItem()).getPath().equals(item);
        }
        int idx=switch(slot){case "feet"->0;case "legs"->1;case "torso"->2;case "head"->3;default->-1;};
        if(idx<0)return false;
        ItemStack worn=entity.getLivingInventory().armor.get(idx);
        return !worn.isEmpty() && Registries.ITEM.getId(worn.getItem()).getPath().equals(item);
    }
    private Task prepare(JsonObject row) {
        String goal=row.get("goal").getAsString();
        currentItem=null;currentBefore=0;currentQuantity=0;
        equipmentSlot=null;destination=null;
        equipmentTargets=null;equipmentProgress=0;
        construction=null;constructionMaterial=null;constructionIndex=0;
        volumeStage=null;cropBlock=null;cropItem=null;cropCells.clear();lastCropAge.clear();
        cropInitialCount=0;cropTargetCount=0;harvestedCropCount=0;combatTarget=null;combatMob=null;
        transferVerified=false;tradeVerified=false;enchantVerified=false;
        stage=goal+"["+index+"]";
        if(Set.of("gather","craft","smelt").contains(goal)){
            currentItem=goal.equals("gather")?row.get("resource").getAsString():row.get("item").getAsString();
            if(currentItem.equals("logs"))currentItem="log";
            if(currentItem.equals("sticks"))currentItem="stick";
            currentQuantity=row.get("targetCount").getAsInt();
            currentBefore=count(currentItem);
            if(currentBefore+currentQuantity>256)throw new IllegalArgumentException("item-budget");
            if(goal.equals("smelt")){
                String material=SMELT.get(currentItem);
                Item output=Registries.ITEM.get(new Identifier("minecraft",currentItem));
                return new SmeltInFurnaceTask(new SmeltTarget(
                    new ItemTarget(output,currentBefore+currentQuantity),
                    new ItemTarget(material,currentQuantity)));
            }
            if(!TaskCatalogue.taskExists(currentItem))
                throw new IllegalArgumentException("unknown-catalogue-resource");
            return TaskCatalogue.getItemTask(currentItem,currentBefore+currentQuantity);
        }
        if(Set.of("tools","stone_age","iron_age").contains(goal)) {
            equipmentTargets=goal.equals("iron_age")?
                new String[]{"iron_pickaxe","iron_sword"}:
                new String[]{"stone_pickaxe","stone_sword"};
            return nextEquipmentTarget();
        }
        if(Set.of("farm_wheat","farm_crop").contains(goal)) {
            String crop=goal.equals("farm_wheat")?"wheat":row.get("crop").getAsString();
            cropBlock=crop.equals("wheat")?Blocks.WHEAT:
                crop.equals("carrots")?Blocks.CARROTS:
                crop.equals("beetroot")?Blocks.BEETROOTS:Blocks.POTATOES;
            Item item=crop.equals("wheat")?Items.WHEAT:
                crop.equals("carrots")?Items.CARROT:
                crop.equals("beetroot")?Items.BEETROOT:Items.POTATO;
            Item seed=crop.equals("wheat")?Items.WHEAT_SEEDS:
                crop.equals("beetroot")?Items.BEETROOT_SEEDS:item;
            JsonObject p=row.getAsJsonObject("position");
            BlockPos origin=new BlockPos(p.get("x").getAsInt(),p.get("y").getAsInt(),p.get("z").getAsInt());
            int width=row.get("width").getAsInt(),depth=row.get("depth").getAsInt();
            cropTargetCount=row.get("targetCount").getAsInt();
            if(entity.getBlockPos().getSquaredDistance(origin)>12*12)
                throw new IllegalArgumentException("farm-stage-origin-not-nearby");
            ServerWorld world=(ServerWorld)entity.getWorld();
            for(int dx=0;dx<width;dx++)for(int dz=0;dz<depth;dz++) {
                BlockPos pos=origin.add(dx,0,dz);
                if(!world.getChunkManager().isChunkLoaded(pos.getX()>>4,pos.getZ()>>4) ||
                   !world.getBlockState(pos.down()).isOf(Blocks.FARMLAND))
                    throw new IllegalArgumentException("farm-stage-field-not-loaded-farmland");
                Block existing=world.getBlockState(pos).getBlock();
                if(existing!=cropBlock && existing!=Blocks.AIR)
                    throw new IllegalArgumentException("farm-stage-unrelated-crop-cell");
                cropCells.add(pos);
            }
            cropItem=Registries.ITEM.getId(item).getPath();
            cropInitialCount=count(cropItem);
            if(cropInitialCount+cropTargetCount>256)
                throw new IllegalArgumentException("farm-stage-output-budget");
            return new CollectCropTask(new ItemTarget(item,cropInitialCount+cropTargetCount),
                new Block[]{cropBlock},new Item[]{seed},cropCells::contains);
        }
        if(goal.equals("build_volume") || goal.equals("shelter")) {
            volumeStage=new JarvisNativeVolumeTask(entity,row);
            return volumeStage;
        }
        if(goal.equals("defeat_hostile")) {
            int entityId=row.get("entityId").getAsInt();
            combatMob=row.get("mob").getAsString();
            ServerWorld world=(ServerWorld)entity.getWorld();
            for(Entity candidate:world.iterateEntities()) {
                if(candidate.getId()==entityId && candidate instanceof HostileEntity &&
                   candidate.isAlive() &&
                   candidate.getPos().squaredDistanceTo(entity.getPos())<=12*12 &&
                   Registries.ENTITY_TYPE.getId(candidate.getType()).getPath().equals(combatMob)) {
                    combatTarget=candidate;break;
                }
            }
            if(combatTarget==null)
                throw new IllegalArgumentException("combat-stage-target-not-currently-observed");
            return new KillEntityTask(combatTarget);
        }
        if(goal.equals("build")) {
            JsonObject p=row.getAsJsonObject("position");
            BlockPos origin=new BlockPos(p.get("x").getAsInt(),p.get("y").getAsInt(),p.get("z").getAsInt());
            int length=row.get("length").getAsInt();
            String axis=row.get("axis").getAsString();
            constructionMaterial=row.get("block").getAsString();
            construction=new BlockPos[length];
            ServerWorld world=(ServerWorld)entity.getWorld();
            if(count(constructionMaterial)<length)
                throw new IllegalArgumentException("not-enough-owner-building-material");
            for(int i=0;i<length;i++){
                BlockPos pos=origin.add(axis.equals("x+")?i:axis.equals("x-")?-i:0,
                    0,axis.equals("z+")?i:axis.equals("z-")?-i:0);
                if(entity.getBlockPos().getSquaredDistance(pos)>12*12 ||
                   !world.getChunkManager().isChunkLoaded(pos.getX()>>4,pos.getZ()>>4) ||
                   !world.getBlockState(pos).isAir())
                    throw new IllegalArgumentException("build-cell-not-safe-or-empty");
                construction[i]=pos;
            }
            return nextConstruction();
        }
        if(goal.equals("equip")){
            currentItem=row.get("item").getAsString();
            equipmentSlot=row.get("destination").getAsString();
            Item item=Registries.ITEM.get(new Identifier("minecraft",currentItem));
            if(item==Items.AIR)throw new IllegalArgumentException("invalid-gear");
            return equipmentSlot.equals("hand")?
                new HoldItemTask(new ItemTarget(item)):
                new EquipArmorTask(item);
        }
        JsonObject p=row.getAsJsonObject("destination");
        destination=new BlockPos(p.get("x").getAsInt(),p.get("y").getAsInt(),p.get("z").getAsInt());
        arrivalRange=row.get("arrivalRange").getAsInt();
        if(entity.getBlockPos().getSquaredDistance(destination)>160*160)
            throw new IllegalArgumentException("stage-travel-beyond-bounded-range");
        return new GetToBlockTask(destination);
    }

    private Task nextConstruction() {
        if(construction==null || constructionIndex>=construction.length)
            throw new IllegalStateException("construction-stage-complete");
        Block material=Registries.BLOCK.get(new Identifier("minecraft",constructionMaterial));
        if(material==Blocks.AIR)throw new IllegalArgumentException("unknown-material");
        return new PlaceBlockTask(construction[constructionIndex],material);
    }
    private Task nextEquipmentTarget() {
        if(equipmentTargets==null || equipmentProgress>=equipmentTargets.length)
            throw new IllegalStateException("equipment-stage-finished");
        currentItem=equipmentTargets[equipmentProgress];
        currentBefore=count(currentItem);
        currentQuantity=currentBefore>0?0:1;
        if(!TaskCatalogue.taskExists(currentItem))throw new IllegalArgumentException("catalogue-equipment-missing");
        return TaskCatalogue.getItemTask(currentItem,Math.max(1,currentBefore));
    }
    private void sampleFarmCells() {
        if(cropCells.isEmpty() || cropBlock==null)return;
        ServerWorld world=(ServerWorld)entity.getWorld();
        for(BlockPos pos:cropCells) {
            if(!world.getChunkManager().isChunkLoaded(pos.getX()>>4,pos.getZ()>>4))continue;
            BlockState state=world.getBlockState(pos);
            int age=-1;
            if(state.isOf(cropBlock) && cropBlock instanceof CropBlock crop)
                age=crop.getAge(state);
            else if(!state.isAir())age=-2;
            Integer previous=lastCropAge.put(pos,age);
            if(previous!=null && previous==7 && age>=-1 && age<7 && harvestedCropCount<256)
                harvestedCropCount++;
        }
    }
    private void executeImmediate(JsonObject row) {
        String goal=row.get("goal").getAsString();
        if(goal.equals("transfer")) {
            JsonObject p=row.getAsJsonObject("position");
            BlockPos pos=new BlockPos(p.get("x").getAsInt(),p.get("y").getAsInt(),p.get("z").getAsInt());
            String item=row.get("item").getAsString(),direction=row.get("operation").getAsString();
            int amount=row.get("targetCount").getAsInt();
            JarvisNativeInventoryTransfer.Result moved=
                JarvisNativeInventoryTransfer.move(entity,pos,item,amount,direction);
            transferVerified=moved.moved==amount &&
                moved.afterPlayer==(direction.equals("deposit")?moved.beforePlayer-amount:moved.beforePlayer+amount) &&
                moved.afterContainer==(direction.equals("deposit")?moved.beforeContainer+amount:moved.beforeContainer-amount);
            if(!transferVerified)throw new IllegalStateException("sequence-transfer-receipt-mismatch");
            return;
        }
        if(goal.equals("trade")) {
            JarvisNativeVillagerTrade.Result traded=JarvisNativeVillagerTrade.execute(entity,row);
            tradeVerified=traded.verified;
            if(!tradeVerified)throw new IllegalStateException("sequence-trade-receipt-mismatch");
            return;
        }
        if(goal.equals("enchant")) {
            if(!"1".equals(System.getenv("JARVIS_MC_BRIDGE_OWNER_XP_ENCHANT_ENABLE"))||
               owner==null||!row.get("ownerXpConsent").getAsBoolean())
                throw new IllegalArgumentException("sequence-enchant-owner-xp-opt-in-required");
            JsonObject p=row.getAsJsonObject("position");
            BlockPos table=new BlockPos(p.get("x").getAsInt(),p.get("y").getAsInt(),p.get("z").getAsInt());
            JarvisNativeOwnerEnchant.Result enchanted=JarvisNativeOwnerEnchant.enchant(
                entity,owner,table,row.get("item").getAsString(),row.get("choice").getAsInt());
            enchantVerified=enchanted.verified;
            if(!enchantVerified)throw new IllegalStateException("sequence-enchant-receipt-mismatch");
            return;
        }
        throw new IllegalArgumentException("unknown-immediate-sequence-stage");
    }

    private boolean physicallyDone(){
        if(transferVerified||tradeVerified||enchantVerified)return true;
        if(volumeStage!=null)return volumeStage.complete();
        if(cropBlock!=null)
            return harvestedCropCount>=cropTargetCount &&
                count(cropItem)>=cropInitialCount+cropTargetCount;
        if(combatTarget!=null)return !combatTarget.isAlive();
        if(construction!=null){
            BlockPos pos=construction[constructionIndex];
            ServerWorld world=(ServerWorld)entity.getWorld();
            if(!world.getChunkManager().isChunkLoaded(pos.getX()>>4,pos.getZ()>>4))return false;
            return Registries.BLOCK.getId(world.getBlockState(pos).getBlock())
                .getPath().equals(constructionMaterial);
        }
        if(currentItem!=null && equipmentSlot!=null)
            return wearing(currentItem,equipmentSlot);
        if(currentItem!=null)
            return count(currentItem)>=currentBefore+currentQuantity;
        return destination!=null && entity.getBlockPos().isWithinDistance(destination,arrivalRange);
    }
    private static final class ReceiptTickTask extends Task {
        private boolean done;
        @Override protected void onStart(){}
        @Override protected Task onTick(){done=true;return null;}
        @Override protected void onStop(Task interruptTask){done=true;}
        @Override public boolean isFinished(){return done;}
        @Override protected boolean isEqual(Task other){return other instanceof ReceiptTickTask;}
        @Override protected String toDebugString(){return "JARVIS native transaction receipt";}
    }

    @Override protected void onStart(){stage="running";}
    @Override protected Task onTick(){
        if(failed || index>=steps.size())return null;
        sampleFarmCells();
        if(current==null){
            JsonObject row=steps.get(index);
            String goal=row.get("goal").getAsString();
            try {
                if(Set.of("transfer","trade","enchant").contains(goal)) {
                    transferVerified=false;tradeVerified=false;enchantVerified=false;
                    stage=goal+"["+index+"]";
                    executeImmediate(row);
                    if(!physicallyDone())throw new IllegalStateException("sequence-transaction-postcondition-unverified");
                    current=new ReceiptTickTask();
                    return current;
                }
                current=prepare(row);
            }
            catch(Exception ex){failed=true;stage="blocked:"+ex.getClass().getSimpleName();return null;}
            return current;
        }
        if(current.isFinished()){
            if(!physicallyDone()){
                failed=true;stage="postcondition-unverified";return null;
            }
            if(equipmentTargets!=null && equipmentProgress+1<equipmentTargets.length){
                equipmentProgress++;
                current=nextEquipmentTarget();
                stage="equipment["+index+":"+equipmentProgress+"]";
                return current;
            }
            if(construction!=null && constructionIndex+1<construction.length){
                constructionIndex++;
                current=nextConstruction();
                stage="construct["+index+":"+constructionIndex+"]";
                return current;
            }
            index++;
            current=null;
            stage=index>=steps.size()?"complete":"stage-complete";
            return index>=steps.size()?null:onTick();
        }
        return current;
    }
    @Override protected void onStop(Task interruptTask){
        if(index<steps.size()) {failed=true;stage="interrupted";}
    }
    @Override public boolean isFinished(){return index==steps.size()&&!failed;}
    @Override protected boolean isEqual(Task other){
        return other instanceof JarvisNativeSequenceTask x && x.since==since;
    }
    @Override protected String toDebugString(){return "JARVIS owner sequence "+stage;}
}
