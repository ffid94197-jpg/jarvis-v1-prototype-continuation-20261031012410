package com.neovetta.aicompanion.jarvis;

import com.neovetta.aicompanion.entity.CompanionEntity;
import net.minecraft.block.entity.BarrelBlockEntity;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.ChestBlockEntity;
import net.minecraft.inventory.Inventory;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;

import java.util.List;

/**
 * Exact, server-thread item transfer for an owner's explicitly selected
 * loaded chest or barrel. All mutation authority is supplied by JarvisBridgeServer
 * after Guardian identity, owner, scope, and durable effect admission.
 * No world scanning, container ownership guess, creative inventory, or loot cheats.
 */
final class JarvisNativeInventoryTransfer {
    private JarvisNativeInventoryTransfer() {}
    static final class Result {
        final int moved;
        final int beforePlayer,afterPlayer,beforeContainer,afterContainer;
        Result(int moved,int bp,int ap,int bc,int ac) {
            this.moved=moved;beforePlayer=bp;afterPlayer=ap;
            beforeContainer=bc;afterContainer=ac;
        }
    }
    private static int count(List<ItemStack> slots,Item item) {
        int n=0;
        for(ItemStack stack:slots)if(!stack.isEmpty()&&stack.getItem()==item)n+=stack.getCount();
        return n;
    }
    private static int countContainer(Inventory inv,Item item) {
        int n=0;
        for(int i=0;i<inv.size();i++){
            ItemStack s=inv.getStack(i);
            if(!s.isEmpty()&&s.getItem()==item)n+=s.getCount();
        }
        return n;
    }
    private static int capacity(List<ItemStack> slots,Item item) {
        int n=0;
        for(ItemStack s:slots){
            if(s.isEmpty())n+=item.getMaxCount();
            else if(s.getItem()==item)n+=Math.max(0,Math.min(s.getMaxCount(),item.getMaxCount())-s.getCount());
        }
        return n;
    }
    private static int capacityContainer(Inventory inv,Item item) {
        int n=0;
        for(int i=0;i<inv.size();i++){
            ItemStack s=inv.getStack(i);
            if(s.isEmpty())n+=item.getMaxCount();
            else if(s.getItem()==item)n+=Math.max(0,Math.min(s.getMaxCount(),item.getMaxCount())-s.getCount());
        }
        return n;
    }
    private static void remove(List<ItemStack> slots,Item item,int count) {
        int remaining=count;
        for(int i=0;i<slots.size()&&remaining>0;i++){
            ItemStack s=slots.get(i);
            if(s.isEmpty()||s.getItem()!=item)continue;
            int take=Math.min(remaining,s.getCount());
            s.decrement(take);remaining-=take;
            if(s.isEmpty())slots.set(i,ItemStack.EMPTY);
        }
        if(remaining!=0)throw new IllegalStateException("source-count-changed");
    }
    private static void add(List<ItemStack> slots,Item item,int count) {
        int remaining=count;
        for(int i=0;i<slots.size()&&remaining>0;i++){
            ItemStack s=slots.get(i);
            if(s.isEmpty()||s.getItem()!=item)continue;
            int take=Math.min(remaining,s.getMaxCount()-s.getCount());
            if(take>0){s.increment(take);remaining-=take;}
        }
        for(int i=0;i<slots.size()&&remaining>0;i++){
            if(!slots.get(i).isEmpty())continue;
            int take=Math.min(remaining,item.getMaxCount());
            slots.set(i,new ItemStack(item,take));remaining-=take;
        }
        if(remaining!=0)throw new IllegalStateException("destination-capacity-changed");
    }
    static Result move(CompanionEntity companion,BlockPos pos,String name,int amount,String direction) {
        if(!name.matches("[a-z0-9_]{1,64}")||amount<1||amount>64||
                !direction.equals("deposit")&&!direction.equals("withdraw"))
            throw new IllegalArgumentException("transfer-invalid-request");
        ServerWorld world=(ServerWorld)companion.getWorld();
        if(companion.getBlockPos().getSquaredDistance(pos)>4.5*4.5 ||
                !world.getChunkManager().isChunkLoaded(pos.getX()>>4,pos.getZ()>>4))
            throw new IllegalArgumentException("container-not-in-local-loaded-range");
        BlockEntity block=world.getBlockEntity(pos);
        if(!(block instanceof ChestBlockEntity) && !(block instanceof BarrelBlockEntity))
            throw new IllegalArgumentException("only-vanilla-chest-or-barrel-supported");
        if(!(block instanceof Inventory inv))throw new IllegalArgumentException("container-is-not-inventory");
        Item item=Registries.ITEM.get(new Identifier("minecraft",name));
        if(item==Items.AIR || item.getMaxCount()<1)
            throw new IllegalArgumentException("unknown-or-invalid-item");
        List<ItemStack> main=companion.getLivingInventory().main;
        int bp=count(main,item),bc=countContainer(inv,item);
        boolean deposit=direction.equals("deposit");
        if((deposit?bp:bc)<amount)
            throw new IllegalArgumentException("not-enough-source-items");
        if((deposit?capacityContainer(inv,item):capacity(main,item))<amount)
            throw new IllegalArgumentException("no-destination-capacity");
        // All checks are complete. This function is called only from the
        // Minecraft server thread. Reserve destination space first, then
        // remove the exact amount from source, with no async gap.
        if(deposit) {
            int remaining=amount;
            for(int i=0;i<inv.size()&&remaining>0;i++){
                ItemStack s=inv.getStack(i);
                if(s.isEmpty()||s.getItem()!=item)continue;
                int take=Math.min(remaining,s.getMaxCount()-s.getCount());
                if(take>0){s.increment(take);remaining-=take;}
            }
            for(int i=0;i<inv.size()&&remaining>0;i++){
                if(!inv.getStack(i).isEmpty())continue;
                int take=Math.min(remaining,item.getMaxCount());
                inv.setStack(i,new ItemStack(item,take));remaining-=take;
            }
            if(remaining!=0)throw new IllegalStateException("container-capacity-race");
            remove(main,item,amount);
        } else {
            add(main,item,amount);
            int remaining=amount;
            for(int i=0;i<inv.size()&&remaining>0;i++){
                ItemStack s=inv.getStack(i);
                if(s.isEmpty()||s.getItem()!=item)continue;
                int take=Math.min(remaining,s.getCount());
                s.decrement(take);remaining-=take;
                if(s.isEmpty())inv.setStack(i,ItemStack.EMPTY);
            }
            if(remaining!=0)throw new IllegalStateException("container-source-race");
        }
        inv.markDirty();
        companion.getLivingInventory().markDirty();
        int ap=count(main,item),ac=countContainer(inv,item);
        if(ap!=(deposit?bp-amount:bp+amount) || ac!=(deposit?bc+amount:bc-amount))
            throw new IllegalStateException("transfer-postcondition-unknown");
        return new Result(amount,bp,ap,bc,ac);
    }
}
