'use strict';
/**
 * Build a compact, read-only snapshot for the JARVIS-owned Minecraft language
 * interpreter. This is context, never authority: all model output is still
 * validated by friend_protocol and executed by the existing controller.
 */
function safeText(value, max = 48) {
  return typeof value === 'string'
    ? value.replace(/[\\x00-\\x1f\\x7f]/g, ' ').slice(0, max)
    : null;
}
function safePosition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const key of ['x', 'y', 'z']) {
    if (!Number.isFinite(value[key]) || Math.abs(value[key]) > 30000000) return null;
    out[key] = Math.round(value[key] * 10) / 10;
  }
  return out;
}
function buildLanguageContext(world, runtime = {}) {
  const raw = world?.inventory?.raw && typeof world.inventory.raw === 'object'
    ? world.inventory.raw : {};
  const inventory = {};
  for (const [name, count] of Object.entries(raw).slice(0, 24)) {
    if (!/^[a-z0-9_]{1,64}$/.test(name) ||
        !Number.isFinite(count) || count <= 0) continue;
    inventory[name] = Math.floor(count);
  }
  const threats = (Array.isArray(world?.threats) ? world.threats : [])
    .slice(0, 3)
    .map(item => ({
      name: safeText(item?.name, 32),
      distance: Number.isFinite(item?.distance) ? Math.round(item.distance * 10) / 10 : null
    }));
  const equipment = {};
  for (const slot of ['hand', 'head', 'torso', 'legs', 'feet', 'off-hand']) {
    const name = safeText(world?.equipped?.[slot], 48);
    if (name) equipment[slot] = name;
  }
  const mission = runtime?.mission || {};
  const activeMission = {
    goal: safeText(mission.goal, 48),
    status: safeText(mission.status, 24),
    steps: Number.isInteger(mission.steps) ? Math.max(0, mission.steps) : 0,
    resource: safeText(mission.resource, 32),
    targetCount: Number.isInteger(mission.targetCount) ? mission.targetCount : null,
    item: safeText(mission.item, 48),
    sequenceIndex: Number.isInteger(mission.sequenceIndex) ? mission.sequenceIndex : null
  };
  const snapshot = {
    gameMode: safeText(runtime.gameMode, 24) || 'unknown',
    dimension: safeText(world?.dimension, 32) || 'unknown',
    position: safePosition(world?.position),
    health: Number.isFinite(world?.health) ? Math.max(0, Math.min(20, world.health)) : null,
    hunger: Number.isFinite(world?.hunger) ? Math.max(0, Math.min(20, world.hunger)) : null,
    owner: {
      visible: world?.ownerVisible === true,
      distance: Number.isFinite(world?.ownerDistance) ? Math.max(0, world.ownerDistance) : null
    },
    inventory,
    equipped: equipment,
    nearbyThreats: threats,
    workstations: {
      craftingTable: world?.workbenchNearby === true,
      furnace: world?.furnaceNearby === true,
      smithingTable: world?.smithingTableNearby === true
    },
    portals: {
      netherNearby: world?.netherPortalNearby === true,
      endPortalPresent: world?.endPortalPresent === true,
      endPortalActivated: world?.endPortalActivated === true,
      exitPortalPresent: world?.exitPortalPresent === true
    },
    activeMission,
    lastAction: safeText(runtime.lastAction, 120)
  };
  let text = JSON.stringify(snapshot);
  if (text.length <= 4000) return text;
  // Inventory and threat detail are the only expandable collections. Keep the
  // JSON valid and retain all control-relevant fields when applying the cap.
  snapshot.inventory = Object.fromEntries(Object.entries(inventory).slice(0, 12));
  snapshot.nearbyThreats = threats.slice(0, 1);
  snapshot.lastAction = null;
  text = JSON.stringify(snapshot);
  return text.slice(0, 4000);
}
module.exports = { buildLanguageContext, safePosition };
