package com.neovetta.aicompanion.jarvis;

import adris.altoclef.TaskCatalogue;
import adris.altoclef.tasks.container.SmeltInFurnaceTask;
import adris.altoclef.tasks.misc.EquipArmorTask;
import adris.altoclef.tasks.misc.HoldItemTask;
import adris.altoclef.tasks.movement.GetToBlockTask;
import adris.altoclef.tasksystem.Task;
import adris.altoclef.util.ItemTarget;
import adris.altoclef.util.SmeltTarget;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.neovetta.aicompanion.entity.CompanionEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** JARVIS-owned bounded sequence of upstream AltoClef tasks.
 * Typed plans only; no shell, model code, free-form command interpreter or
 * direct crafting/inventory mutation. Each stage advances after a real
 * postcondition and never repeats after an ambiguous result.
 */
public final class JarvisNativeSequenceTask extends Task {
    private static final Set<String> GATHER=Set.of("logs","planks","sticks","cobblestone",
        "raw_iron","iron_ingot","diamond","obsidian","flint","netherrack");
    private static final Set<String> CRAFT=Set.of("stick","crafting_table","chest",
        "furnace","ladder","bread","shield","torch");
    private static final Map<String,String> SMELT=Map.of(
        "iron_ingot","raw_iron","gold_ingot","raw_gold","glass","sand",
        "charcoal","log","netherite_scrap","ancient_debris",
        "cooked_beef","beef","cooked_porkchop","porkchop",
        "cooked_chicken","chicken");
    private final CompanionEntity entity;
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
    private final long since=System.currentTimeMillis();

    public JarvisNativeSequenceTask(CompanionEntity entity,JsonArray input){
        this.entity=entity;
        if(input==null||input.size()<1||input.size()>8)
            throw new IllegalArgumentException("stage-count");
        for(JsonElement element:input){
            if(!element.isJsonObject())throw new IllegalArgumentException("stage-shape");
            JsonObject row=element.getAsJsonObject();
            if(row.size()<1||row.size()>7)
                throw new IllegalArgumentException("stage-width");
            String goal=row.get("goal").getAsString();
            if(!Set.of("gather","craft","smelt","equip","travel").contains(goal))
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
            String item=goal.equals("gather")?row.get("resource").getAsString():
                row.get("item").getAsString();
            count=row.get("targetCount").getAsInt();
            if(count<1||count>64 || (!goal.equals("gather") && count>16))
                throw new IllegalArgumentException("stage-count");
            if(!(goal.equals("gather")?GATHER:goal.equals("craft")?CRAFT:SMELT.keySet()).contains(item))
                throw new IllegalArgumentException("stage-resource");
        } else if(goal.equals("equip")){
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
        } else {
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

    private boolean physicallyDone(){
        if(currentItem!=null && equipmentSlot!=null)
            return wearing(currentItem,equipmentSlot);
        if(currentItem!=null)
            return count(currentItem)>=currentBefore+currentQuantity;
        return destination!=null && entity.getBlockPos().isWithinDistance(destination,arrivalRange);
    }
    @Override protected void onStart(){stage="running";}
    @Override protected Task onTick(){
        if(failed || index>=steps.size())return null;
        if(current==null){
            try {current=prepare(steps.get(index));}
            catch(Exception ex){failed=true;stage="blocked:"+ex.getClass().getSimpleName();return null;}
            return current;
        }
        if(current.isFinished()){
            if(!physicallyDone()){
                failed=true;stage="postcondition-unverified";return null;
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
