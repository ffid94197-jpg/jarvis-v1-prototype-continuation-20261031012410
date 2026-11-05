package com.neovetta.aicompanion.jarvis;

import com.neovetta.aicompanion.entity.CompanionEntity;
import net.minecraft.block.Blocks;
import net.minecraft.enchantment.EnchantmentHelper;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.screen.EnchantmentScreenHandler;
import net.minecraft.screen.ScreenHandlerContext;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;

import java.util.List;

/**
 * OWNER-ASSISTED (not independent bot-XP) vanilla enchanting transaction.
 *
 * JARVIS cannot truthfully enchant using bot XP: the pinned upstream
 * CompanionEntity has no autonomous XP levels or vanilla experience-orb
 * pickup. This implementation requires the live human owner to explicitly
 * authorize spending THEIR actual vanilla XP and the companion to own the
 * real item and lapis. The game's own EnchantmentScreenHandler produces the
 * item/seed/cost; no synthetic enchantments, free materials or creative mode.
 *
 * Must execute on Minecraft's server thread AFTER native journal ADMITTED.
 * A dropped acknowledgement is EFFECT_UNKNOWN and never blindly retried.
 */
final class JarvisNativeOwnerEnchant {
    private JarvisNativeOwnerEnchant(){}

    static final class Result {
        final String inputItem,outputItem;
        final int option,requiredLevel,xpBefore,xpAfter;
        final int lapisBefore,lapisAfter,enchantmentCount;
        final boolean verified;
        Result(String inputItem,String outputItem,int option,int requiredLevel,
               int xpBefore,int xpAfter,int lapisBefore,int lapisAfter,
               int enchantmentCount,boolean verified){
            this.inputItem=inputItem;this.outputItem=outputItem;this.option=option;
            this.requiredLevel=requiredLevel;this.xpBefore=xpBefore;this.xpAfter=xpAfter;
            this.lapisBefore=lapisBefore;this.lapisAfter=lapisAfter;
            this.enchantmentCount=enchantmentCount;this.verified=verified;
        }
    }

    static Result enchant(CompanionEntity companion,ServerPlayerEntity owner,
                          BlockPos table,String requestedItem,int option){
        if(option<0||option>2 || requestedItem==null||
           !requestedItem.matches("[a-z0-9_]{1,64}"))
            throw new IllegalArgumentException("enchant-request-invalid");
        ServerWorld world=(ServerWorld)companion.getWorld();
        if(owner.getServerWorld()!=world || !owner.isAlive() ||
           owner.isCreative() || companion.isDead())
            throw new IllegalArgumentException("enchant-requires-live-survival-owner");
        if(owner.getBlockPos().getSquaredDistance(table)>4.5*4.5 ||
           companion.getBlockPos().getSquaredDistance(table)>4.5*4.5)
            throw new IllegalArgumentException("owner-and-companion-must-be-at-table");
        if(!world.getChunkManager().isChunkLoaded(table.getX()>>4,table.getZ()>>4) ||
           !world.getBlockState(table).isOf(Blocks.ENCHANTING_TABLE))
            throw new IllegalArgumentException("enchant-requires-real-loaded-table");
        List<ItemStack> main=companion.getLivingInventory().main;
        int source=-1,lapisBefore=0;
        for(int i=0;i<main.size();i++){
            ItemStack stack=main.get(i);
            if(stack.isEmpty())continue;
            if(stack.isOf(Items.LAPIS_LAZULI))lapisBefore+=stack.getCount();
            String name=Registries.ITEM.getId(stack.getItem()).getPath();
            if(name.equals(requestedItem)){
                if(source!=-1 || stack.getCount()!=1 || !stack.isEnchantable() ||
                   !EnchantmentHelper.get(stack).isEmpty())
                    throw new IllegalArgumentException("one-unenchanted-source-stack-required");
                source=i;
            }
        }
        if(source<0)throw new IllegalArgumentException("owner-item-not-in-companion-inventory");
        int cost=option+1;
        if(lapisBefore<cost)throw new IllegalArgumentException("companion-lacks-actual-lapis");
        int xpBefore=owner.experienceLevel;
        if(xpBefore<cost)throw new IllegalArgumentException("owner-experience-insufficient");
        ItemStack original=main.get(source).copy();

        // THIS is vanilla's own screen handler, with the real table context,
        // bookshelf count and the owner's existing enchantment seed. It owns
        // the same option logic as the GUI instead of arbitrary upgrades.
        EnchantmentScreenHandler handler=new EnchantmentScreenHandler(
            0,owner.getInventory(),ScreenHandlerContext.create(world,table));
        handler.getSlot(0).setStack(original.copy());
        handler.getSlot(1).setStack(new ItemStack(Items.LAPIS_LAZULI,cost));
        int required=handler.enchantmentLevel[option];
        if(required<=0 || xpBefore<required ||
           !handler.canUse(owner) ||
           handler.getLapisCount()!=cost)
            throw new IllegalArgumentException("vanilla-enchant-option-unavailable");

        // The owner's explicit XP authorization must already have been
        // checked by Guardian and the Core gameplay gate. The game handler
        // itself deducts XP, lapis, advances the seed and enchants the item.
        if(!handler.onButtonClick(owner,option))
            throw new IllegalStateException("vanilla-enchant-option-failed");
        ItemStack enchanted=handler.getSlot(0).getStack().copy();
        int lapisRemaining=handler.getLapisCount();
        int xpAfter=owner.experienceLevel;
        int applied=EnchantmentHelper.get(enchanted).size();
        if(enchanted.isEmpty() || enchanted.getCount()!=1 ||
           applied<1 || xpAfter!=xpBefore-cost || lapisRemaining!=0)
            throw new IllegalStateException("vanilla-enchant-postcondition-unknown");

        // The bot's actual inventory pays the lapis and receives the actual
        // enchanted object. Same server-thread transaction: no external
        // tool, async gap, synthetic inventory or duplicated output slot.
        int remaining=cost;
        for(int i=0;i<main.size()&&remaining>0;i++){
            ItemStack stack=main.get(i);
            if(stack.isEmpty()||!stack.isOf(Items.LAPIS_LAZULI))continue;
            int n=Math.min(remaining,stack.getCount());
            stack.decrement(n);
            if(stack.isEmpty())main.set(i,ItemStack.EMPTY);
            remaining-=n;
        }
        if(remaining!=0)throw new IllegalStateException("enchant-lapis-conservation-unknown");
        main.set(source,enchanted);
        companion.getLivingInventory().markDirty();
        int lapisAfter=0;
        for(ItemStack stack:main)
            if(!stack.isEmpty() && stack.isOf(Items.LAPIS_LAZULI))
                lapisAfter+=stack.getCount();
        boolean verified=lapisAfter==lapisBefore-cost &&
            owner.experienceLevel==xpAfter &&
            ItemStack.areEqual(main.get(source),enchanted) &&
            !EnchantmentHelper.get(main.get(source)).isEmpty();
        return new Result(requestedItem,
            Registries.ITEM.getId(enchanted.getItem()).getPath(),option,required,
            xpBefore,xpAfter,lapisBefore,lapisAfter,applied,verified);
    }
}
