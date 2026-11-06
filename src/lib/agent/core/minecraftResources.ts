/** Shared vanilla resource allowlist for the Core, Guardian and PlayerEngine. */
export const MINECRAFT_SAFE_GATHER_RESOURCES = Object.freeze([
  "logs", "planks", "sticks", "cobblestone", "raw_iron", "iron_ingot",
  "diamond", "obsidian", "flint", "netherrack",
  "dirt", "sand", "red_sand", "gravel", "mud", "soul_sand", "soul_soil",
  "moss_block", "andesite", "diorite", "granite", "tuff", "calcite",
  "cobbled_deepslate", "blackstone", "basalt",
  "coal", "raw_copper", "raw_gold", "redstone", "lapis_lazuli", "emerald", "quartz"
] as const);

export type MinecraftSafeGatherResource = typeof MINECRAFT_SAFE_GATHER_RESOURCES[number];
