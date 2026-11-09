package com.neovetta.aicompanion.jarvis;

import adris.altoclef.TaskCatalogue;
import adris.altoclef.tasks.construction.PlaceBlockTask;
import adris.altoclef.tasksystem.Task;
import com.google.gson.JsonObject;
import com.neovetta.aicompanion.entity.CompanionEntity;
import net.minecraft.block.Block;
import net.minecraft.block.Blocks;
import net.minecraft.entity.Entity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.Registries;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Owner-requested survival construction: 1-64 exact cells, no world edits,
 * Creative mode, raw block mutation or synthetic inventory grants.
 *
 * A task is a sequential chain of existing pinned AltoClef tasks (collect
 * real blocks, then place one real block at a time). Completion requires
 * *every* original planned world cell to physically match the intended block.
 *
 * A rejected/failed stage ends the run without a completion claim. Core and
 * the Fabric journal own cancellation, deadline and uncertain-effect policy.
 */
public final class JarvisNativeVolumeTask extends Task {
    private static final Set<String> MATERIALS=Set.of(
        "cobblestone","cobbled_deepslate","stone","dirt",
        "oak_planks","spruce_planks","birch_planks","stone_bricks",
        "oak_log","glass","sandstone","netherrack");
    private static final int MAX_CELLS=64;
    private final CompanionEntity entity;
    private final ServerWorld world;
    private final List<BlockPos> cells;
    private final String material;
    private final Block block;
    private final String goal;
    private final long since=System.currentTimeMillis();
    private final int initialMaterials;
    private int index,verified;
    private boolean done,failed;
    private Task child;
    private String stage="admitted";

    public JarvisNativeVolumeTask(CompanionEntity entity,JsonObject args){
        this.entity=entity;
        this.world=(ServerWorld)entity.getWorld();
        this.goal=args.get("goal").getAsString();
        boolean shelter=goal.equals("shelter");
        if(!shelter && !goal.equals("build_volume"))
            throw new IllegalArgumentException("unsupported-volume-goal");
        this.material=shelter?"cobblestone":args.get("block").getAsString();
        if(!MATERIALS.contains(material))
            throw new IllegalArgumentException("volume-material-not-allowed");
        this.block=Registries.BLOCK.get(new Identifier("minecraft",material));
        if(block==Blocks.AIR || !TaskCatalogue.taskExists(material))
            throw new IllegalArgumentException("volume-block-not-in-pinned-catalogue");
        int width=args.get("width").getAsInt(),depth=args.get("depth").getAsInt();
        if(width<1||width>4||depth<1||depth>4)
            throw new IllegalArgumentException("volume-footprint-out-of-bounds");
        int height=shelter?4:args.get("height").getAsInt();
        if(height<1||height>4 || (shelter && (width<3||depth<3)))
            throw new IllegalArgumentException("volume-height-invalid");
        String shape=shelter?"shelter":args.get("shape").getAsString();
        if(!Set.of("shelter","floor","walls","roof","solid").contains(shape))
            throw new IllegalArgumentException("volume-shape-invalid");
        if(!shelter && (shape.equals("floor")||shape.equals("roof"))&&height!=1)
            throw new IllegalArgumentException("floor-and-roof-must-be-one-layer");

        BlockPos origin=shelter?selectShelterOrigin(width,depth):
            readPosition(args.getAsJsonObject("position"));
        if(entity.getBlockPos().getSquaredDistance(origin)>12*12)
            throw new IllegalArgumentException("building-origin-too-far");
        this.cells=List.copyOf(compute(origin,width,depth,height,shape));
        if(cells.isEmpty()||cells.size()>MAX_CELLS)
            throw new IllegalArgumentException("volume-cell-budget");

        // A protective preflight over EXACT cells; never load a chunk or
        // overwrite someone's structure. All cells must be AIR initially.
        Set<BlockPos> unique=new HashSet<>(cells);
        if(unique.size()!=cells.size())
            throw new IllegalArgumentException("volume-cells-overlap");
        for(BlockPos p:cells){
            if(p.getY()<world.getBottomY()+1 || p.getY()>=world.getTopY()-2 ||
               !loaded(p) || !world.getBlockState(p).isAir() ||
               entity.getBlockPos().equals(p))
                throw new IllegalArgumentException("volume-unloaded-or-obstructed");
            for(Entity other:world.getOtherEntities(entity,
                new Box(p).expand(0.05))){
                if(other instanceof LivingEntity && other.isAlive())
                    throw new IllegalArgumentException("volume-occupied-by-living-entity");
            }
        }
        // Shelter floor needs actual natural terrain beneath it, not a
        // magically suspended or creative-mode foundation.
        if(shelter)for(int dx=0;dx<width;dx++)for(int dz=0;dz<depth;dz++){
            BlockPos below=origin.add(dx,-1,dz);
            if(!loaded(below)||!world.getBlockState(below).isSolidBlock(world,below))
                throw new IllegalArgumentException("shelter-needs-solid-natural-foundation");
        }
        initialMaterials=count(material);
    }

    private boolean loaded(BlockPos p){
        return world.getChunkManager().isChunkLoaded(p.getX()>>4,p.getZ()>>4);
    }
    private static BlockPos readPosition(JsonObject o){
        if(o==null||o.size()!=3)throw new IllegalArgumentException("volume-origin-required");
        for(String k:List.of("x","y","z"))
            if(!o.has(k) || !o.get(k).getAsJsonPrimitive().isNumber())
                throw new IllegalArgumentException("volume-coordinate-missing");
        BlockPos p=new BlockPos(o.get("x").getAsInt(),o.get("y").getAsInt(),
            o.get("z").getAsInt());
        if(Math.abs(p.getX())>29999984 || Math.abs(p.getZ())>29999984)
            throw new IllegalArgumentException("volume-coordinate-world-bounds");
        return p;
    }
    private BlockPos selectShelterOrigin(int width,int depth){
        BlockPos center=entity.getBlockPos();
        for(int dz=2;dz<=4;dz++)for(int dx=2;dx<=4;dx++){
            BlockPos candidate=center.add(dx,0,dz);
            boolean safe=true;
            for(int x=0;x<width&&safe;x++)for(int z=0;z<depth&&safe;z++){
                BlockPos p=candidate.add(x,0,z);
                if(!loaded(p)||!loaded(p.down())||
                   !world.getBlockState(p.down()).isSolidBlock(world,p.down())){
                    safe=false;break;
                }
                for(int y=0;y<4;y++){
                    BlockPos target=p.up(y);
                    if(!loaded(target)||!world.getBlockState(target).isAir()){
                        safe=false;break;
                    }
                }
            }
            if(safe)return candidate;
        }
        throw new IllegalArgumentException("no-safe-loaded-shelter-site-near-companion");
    }
    private static List<BlockPos> compute(
        BlockPos origin,int width,int depth,int height,String shape){
        List<BlockPos> planned=new ArrayList<>();
        if(shape.equals("shelter")){
            // Floor -> entrance walls (two blocks high) -> roof, one empty
            // doorway at the front (south edge, x=floor(width/2)).
            for(int x=0;x<width;x++)for(int z=0;z<depth;z++)
                planned.add(origin.add(x,0,z));
            for(int y=1;y<=2;y++)for(int x=0;x<width;x++)
                for(int z=0;z<depth;z++){
                    boolean perimeter=x==0||z==0||x==width-1||z==depth-1;
                    if(!perimeter || (z==0 && x==width/2 && y==1))continue;
                    planned.add(origin.add(x,y,z));
                }
            for(int x=0;x<width;x++)for(int z=0;z<depth;z++)
                planned.add(origin.add(x,3,z));
        } else {
            for(int y=0;y<height;y++)for(int x=0;x<width;x++)
                for(int z=0;z<depth;z++){
                    boolean perimeter=x==0||z==0||x==width-1||z==depth-1;
                    if(shape.equals("solid")||
                        shape.equals("walls")&&perimeter||
                        (shape.equals("floor")||shape.equals("roof"))&&y==0)
                        planned.add(origin.add(x,y,z));
                }
        }
        return planned;
    }
    private int count(String material){
        int n=0;
        for(ItemStack s:entity.getLivingInventory().main){
            if(!s.isEmpty() &&
               Registries.ITEM.getId(s.getItem()).getPath().equals(material))
                n+=s.getCount();
        }
        return n;
    }
    private boolean built(BlockPos p){
        return loaded(p)&&world.getBlockState(p).isOf(block);
    }
    public String goal(){return goal;}
    public String stage(){return stage;}
    public long since(){return since;}
    public int cellsTotal(){return cells.size();}
    public int cellsVerified(){return verified;}
    public boolean complete(){return done&&!failed;}

    @Override protected void onStart(){stage="running";}
    @Override protected Task onTick(){
        if(failed||done)return null;
        // This is one actual survival acquire task, never a synthetic material
        // grant. A world with insufficient resources can stay BLOCKED.
        if(child==null && index==0 && count(material)<cells.size()){
            if(!TaskCatalogue.taskExists(material)){failed=true;stage="material-unavailable";return null;}
            stage="gather_real_blocks";
            child=TaskCatalogue.getItemTask(material,Math.max(count(material),cells.size()));
            return child;
        }
        if(child!=null && stage.equals("gather_real_blocks")){
            if(!child.isFinished())return child;
            if(count(material)<cells.size()){
                failed=true;stage="material-acquisition-unverified";return null;
            }
            child=null;stage="building";
        }
        while(index<cells.size() && built(cells.get(index))){
            index++;verified++;child=null;
        }
        if(index>=cells.size()){
            done=verified==cells.size() && cells.stream().allMatch(this::built);
            stage=done?"complete":"world-readback-mismatch";
            if(!done)failed=true;
            return null;
        }
        BlockPos p=cells.get(index);
        if(!loaded(p)||!world.getBlockState(p).isAir()){
            failed=true;stage="construction-cell-changed-before-placement";return null;
        }
        if(child==null)child=new PlaceBlockTask(p,block);
        if(child.isFinished()){
            if(!built(p)){
                failed=true;stage="placement-claim-without-physical-block";return null;
            }
            index++;verified++;child=null;
            stage="building";
            return onTick();
        }
        stage="building";
        return child;
    }
    @Override protected void onStop(Task interruptTask){
        if(!done){failed=true;stage="interrupted";}
    }
    @Override public boolean isFinished(){return done&&!failed;}
    @Override protected boolean isEqual(Task other){
        return other instanceof JarvisNativeVolumeTask t && t.since==since;
    }
    @Override protected String toDebugString(){
        return "JARVIS real-survival volume "+goal+" "+stage+" "+verified+"/"+cells.size();
    }
}
