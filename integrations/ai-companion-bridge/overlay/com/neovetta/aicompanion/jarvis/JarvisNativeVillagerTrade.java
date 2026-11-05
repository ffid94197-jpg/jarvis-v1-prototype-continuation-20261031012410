package com.neovetta.aicompanion.jarvis;

import com.google.gson.JsonObject;
import com.neovetta.aicompanion.entity.CompanionEntity;
import net.minecraft.entity.Entity;
import net.minecraft.entity.passive.VillagerEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.Registries;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.village.TradeOffer;
import net.minecraft.village.TradeOfferList;

import java.util.ArrayList;
import java.util.List;

/**
 * Native, strictly owner-authorized villager trade.
 *
 * Runs on the Minecraft server thread only, after the parent bridge has
 * validated Core/Guardian identity and written ADMITTED to its native journal.
 * No free items, creative commands, synthetic trades or LLM effects.
 * The exact live offer and its adjusted price MUST match a fresh signed
 * villager_offers readback supplied as trusted operation parameters.
 */
final class JarvisNativeVillagerTrade {
    private JarvisNativeVillagerTrade(){}

    static final class Result {
        final int villagerId,offerIndex,times,usesBefore,usesAfter;
        final int firstBefore,firstAfter,secondBefore,secondAfter;
        final int outputBefore,outputAfter;
        final String firstItem,secondItem,outputItem;
        final int firstCount,secondCount,outputCount;
        final boolean verified;

        Result(int villagerId,int offerIndex,int times,int usesBefore,int usesAfter,
               int firstBefore,int firstAfter,int secondBefore,int secondAfter,
               int outputBefore,int outputAfter,String firstItem,String secondItem,
               String outputItem,int firstCount,int secondCount,int outputCount,
               boolean verified){
            this.villagerId=villagerId;this.offerIndex=offerIndex;this.times=times;
            this.usesBefore=usesBefore;this.usesAfter=usesAfter;
            this.firstBefore=firstBefore;this.firstAfter=firstAfter;
            this.secondBefore=secondBefore;this.secondAfter=secondAfter;
            this.outputBefore=outputBefore;this.outputAfter=outputAfter;
            this.firstItem=firstItem;this.secondItem=secondItem;this.outputItem=outputItem;
            this.firstCount=firstCount;this.secondCount=secondCount;this.outputCount=outputCount;
            this.verified=verified;
        }
    }

    static String itemId(ItemStack item){
        return item.isEmpty() ? "" : Registries.ITEM.getId(item.getItem()).toString();
    }

    static int count(List<ItemStack> slots,ItemStack template) {
        if(template.isEmpty())return 0;
        int result=0;
        for(ItemStack stack:slots){
            if(!stack.isEmpty() && ItemStack.areItemsEqual(stack,template)){
                result+=stack.getCount();
                if(result>4096)throw new IllegalArgumentException("inventory-count-overflow");
            }
        }
        return result;
    }

    private static List<ItemStack> copy(List<ItemStack> slots){
        List<ItemStack> cloned=new ArrayList<>(slots.size());
        for(ItemStack s:slots)cloned.add(s.copy());
        return cloned;
    }

    private static void spend(List<ItemStack> slots,ItemStack template){
        if(template.isEmpty())return;
        int remaining=template.getCount();
        for(int i=0;i<slots.size() && remaining>0;i++){
            ItemStack stack=slots.get(i);
            // Vanilla villager trading ignores input NBT. Never destroy a
            // different item type or silently allow missing currency.
            if(stack.isEmpty()||!ItemStack.areItemsEqual(stack,template))continue;
            int n=Math.min(stack.getCount(),remaining);
            stack.decrement(n);
            if(stack.isEmpty())slots.set(i,ItemStack.EMPTY);
            remaining-=n;
        }
        if(remaining!=0)throw new IllegalArgumentException("trade-insufficient-materials");
    }

    private static void acquire(List<ItemStack> slots,ItemStack output){
        if(output.isEmpty()||output.getCount()<1)
            throw new IllegalArgumentException("trade-empty-output");
        int remaining=output.getCount();
        for(int i=0;i<slots.size()&&remaining>0;i++){
            ItemStack stack=slots.get(i);
            if(stack.isEmpty()||!ItemStack.canCombine(stack,output))continue;
            int n=Math.min(remaining,stack.getMaxCount()-stack.getCount());
            if(n>0){stack.increment(n);remaining-=n;}
        }
        for(int i=0;i<slots.size()&&remaining>0;i++){
            if(!slots.get(i).isEmpty())continue;
            int n=Math.min(remaining,output.getMaxCount());
            slots.set(i,output.copyWithCount(n));
            remaining-=n;
        }
        if(remaining!=0)throw new IllegalArgumentException("trade-inventory-full");
    }

    private static int expectedDelta(ItemStack item,ItemStack first,
                                     ItemStack second,ItemStack output){
        if(item.isEmpty())return 0;
        int delta=0;
        if(ItemStack.areItemsEqual(item,first))delta-=first.getCount();
        if(!second.isEmpty()&&ItemStack.areItemsEqual(item,second))delta-=second.getCount();
        if(ItemStack.areItemsEqual(item,output))delta+=output.getCount();
        return delta;
    }

    static Result execute(CompanionEntity companion,JsonObject args) {
        int entityId=args.get("entityId").getAsInt();
        int offerIndex=args.get("offerIndex").getAsInt();
        int times=args.get("times").getAsInt();
        if(entityId<0||entityId>200000||offerIndex<0||offerIndex>7||
           times<1||times>4)
            throw new IllegalArgumentException("trade-target-or-budget-invalid");
        VillagerEntity villager=null;
        ServerWorld world=(ServerWorld)companion.getWorld();
        for(Entity entity:world.iterateEntities()){
            if(entity instanceof VillagerEntity v && v.getId()==entityId &&
               v.isAlive() && !v.isBaby() &&
               v.squaredDistanceTo(companion)<=4.5*4.5){
                villager=v;break;
            }
        }
        if(villager==null)throw new IllegalArgumentException("villager-not-nearby");
        TradeOfferList offers=villager.getOffers();
        if(offerIndex>=offers.size())throw new IllegalArgumentException("villager-offer-not-found");
        TradeOffer offer=offers.get(offerIndex);
        if(offer.isDisabled()||offer.getUses()+times>offer.getMaxUses())
            throw new IllegalArgumentException("villager-offer-exhausted");
        ItemStack first=offer.getAdjustedFirstBuyItem();
        ItemStack second=offer.getSecondBuyItem();
        ItemStack output=offer.copySellItem();
        if(first.isEmpty()||first.getCount()<1||first.getCount()>64||
           second.getCount()>64||output.isEmpty()||output.getCount()<1||
           output.getCount()>64)
            throw new IllegalArgumentException("unsupported-villager-offer");
        // Price can change at restock. Reject a new price instead of silently
        // charging a different amount than the immediately observed offer.
        if(!itemId(first).equals(args.get("expectedFirstItem").getAsString()) ||
           first.getCount()!=args.get("expectedFirstCount").getAsInt() ||
           !itemId(second).equals(args.get("expectedSecondItem").getAsString()) ||
           second.getCount()!=args.get("expectedSecondCount").getAsInt() ||
           !itemId(output).equals(args.get("expectedOutputItem").getAsString()) ||
           output.getCount()!=args.get("expectedOutputCount").getAsInt() ||
           offer.getUses()!=args.get("expectedUses").getAsInt())
            throw new IllegalArgumentException("villager-price-changed-refuse");
        int beforeUses=offer.getUses();
        List<ItemStack> original=copy(companion.getLivingInventory().main);
        int beforeFirst=count(original,first);
        int beforeSecond=count(original,second);
        int beforeOutput=count(original,output);
        List<ItemStack> planned=copy(original);
        for(int n=0;n<times;n++){
            spend(planned,first);
            spend(planned,second);
            acquire(planned,output);
        }
        // No inventory change until the complete amount and output capacity
        // are preflighted; no async / network call within the transaction.
        List<ItemStack> main=companion.getLivingInventory().main;
        if(main.size()!=planned.size())
            throw new IllegalArgumentException("inventory-shape-changed");
        for(int i=0;i<planned.size();i++)
            main.set(i,planned.get(i).copy());
        companion.getLivingInventory().markDirty();
        // MerchantEntity.trade increments vanilla uses and awards the
        // villager's profession XP; never manually synthesize a trade offer.
        for(int n=0;n<times;n++)villager.trade(offer);
        int afterFirst=count(main,first),afterSecond=count(main,second);
        int afterOutput=count(main,output);
        boolean exact=offer.getUses()==beforeUses+times &&
            afterFirst==beforeFirst+times*expectedDelta(first,first,second,output) &&
            afterSecond==beforeSecond+times*expectedDelta(second,first,second,output) &&
            afterOutput==beforeOutput+times*expectedDelta(output,first,second,output);
        for(int i=0;i<main.size();i++)
            if(!ItemStack.areEqual(main.get(i),planned.get(i)))exact=false;
        return new Result(entityId,offerIndex,times,beforeUses,offer.getUses(),
            beforeFirst,afterFirst,beforeSecond,afterSecond,beforeOutput,afterOutput,
            itemId(first),itemId(second),itemId(output),
            first.getCount(),second.getCount(),output.getCount(),exact);
    }
}
