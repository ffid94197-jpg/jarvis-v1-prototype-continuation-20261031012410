/** Single-node encrypted local model store. Never returned to the browser. */
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink, open } from "node:fs/promises";
import { join } from "node:path";
import { validateModelSettings, validateRoutingSettings, DEFAULT_ROUTING, publicProfile, ModelSettingsError, type RoutingSettings, type ModelProfile } from "./contracts";

type VaultData = { version: 1; activeId: string | null; profiles: ModelProfile[]; routing?: RoutingSettings };
const MAX_PROFILES = 24;
const locks = new Map<string, Promise<unknown>>();
function rootDir() { return join(process.cwd(), ".jarvis-private", "model-vault"); }
function ownerFile(ownerId: string) {
  if (!ownerId || ownerId.length > 256) throw new ModelSettingsError("Invalid owner.");
  return join(rootDir(), createHash("sha256").update(ownerId).digest("hex") + ".enc");
}
async function key(): Promise<Buffer> {
  await mkdir(rootDir(), { recursive: true, mode: 0o700 });
  const filename = join(rootDir(), "master.key");
  try {
    // 'wx' prevents replacing an existing key. Never rotate implicitly: doing
    // so would orphan encrypted API keys during an update or restart.
    const h = await open(filename, "wx", 0o600);
    try { await h.writeFile(randomBytes(32)); } finally { await h.close(); }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  const b = await readFile(filename);
  if (b.length !== 32) throw new Error("Model vault master key missing or corrupt; do not reset it.");
  return b;
}
function encrypt(data: VaultData, k: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const payload = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()]);
  return Buffer.concat([Buffer.from("JMV1"), iv, c.getAuthTag(), payload]);
}
function decrypt(bytes: Buffer, k: Buffer): VaultData {
  if (bytes.length < 32 || bytes.subarray(0,4).toString() !== "JMV1") throw new Error("Model vault format invalid.");
  const d = createDecipheriv("aes-256-gcm", k, bytes.subarray(4,16));
  d.setAuthTag(bytes.subarray(16,32));
  const obj = JSON.parse(Buffer.concat([d.update(bytes.subarray(32)),d.final()]).toString("utf8")) as VaultData;
  if (obj.version !== 1 || !Array.isArray(obj.profiles) || obj.profiles.length > MAX_PROFILES) throw new Error("Model vault data invalid.");
  return obj;
}
async function load(ownerId: string): Promise<VaultData> {
  const filename = ownerFile(ownerId);
  try { return decrypt(await readFile(filename), await key()); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version:1, activeId:null, profiles:[] }; throw e; }
}
async function persist(ownerId: string, data: VaultData) {
  const filename = ownerFile(ownerId);
  const tmp = filename + "." + randomUUID() + ".tmp";
  const body = encrypt(data, await key());
  await writeFile(tmp, body, { mode: 0o600, flag: "wx" });
  try { await rename(tmp, filename); }
  finally { await unlink(tmp).catch(() => undefined); }
}
async function serialized<T>(ownerId: string, callback: () => Promise<T>): Promise<T> {
  const previous = locks.get(ownerId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(callback);
  const next = current.then(() => undefined, () => undefined);
  locks.set(ownerId, next);
  try { return await current; }
  finally { if (locks.get(ownerId) === next) locks.delete(ownerId); }
}
export async function listModels(ownerId: string) {
  const data = await load(ownerId);
  return { activeId: data.activeId, profiles: data.profiles.map(publicProfile), routing:data.routing ?? DEFAULT_ROUTING };
}
export async function selectedModel(ownerId: string): Promise<ModelProfile | null> {
  const data = await load(ownerId);
  return data.profiles.find(p => p.id === data.activeId) ?? null;
}
export async function getModel(ownerId: string, id: string): Promise<ModelProfile | null> {
  return (await load(ownerId)).profiles.find(p => p.id === id) ?? null;
}
export async function saveModel(ownerId: string, raw: unknown) {
  return serialized(ownerId, async () => {
    const data = await load(ownerId);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ModelSettingsError("Invalid profile.");
    const input = raw as Record<string, unknown>;
    const id = typeof input.id === "string" ? input.id : "";
    const prev = id ? data.profiles.find(p => p.id === id) : undefined;
    if (id && !prev) throw new ModelSettingsError("Profile not found.");
    if (!prev && data.profiles.length >= MAX_PROFILES) throw new ModelSettingsError("Model profile limit reached.");
    const settings = validateModelSettings({ ...input, apiKey: input.apiKey || prev?.apiKey || "" });
    const now = new Date().toISOString();
    const profile: ModelProfile = { ...settings, id:prev?.id ?? randomUUID(), createdAt:prev?.createdAt ?? now, updatedAt:now };
    if (prev) data.profiles[data.profiles.findIndex(p => p.id === prev.id)] = profile;
    else data.profiles.push(profile);
    await persist(ownerId, data);
    return publicProfile(profile);
  });
}
export async function activateModel(ownerId: string, id: string | null) {
  return serialized(ownerId, async () => {
    const data = await load(ownerId);
    if (id !== null && !data.profiles.some(p => p.id === id)) throw new ModelSettingsError("Profile not found.");
    data.activeId = id;
    await persist(ownerId, data);
    return { activeId: id };
  });
}
export async function removeModel(ownerId: string, id: string) {
  return serialized(ownerId, async () => {
    const data = await load(ownerId);
    if (!data.profiles.some(p => p.id === id)) throw new ModelSettingsError("Profile not found.");
    data.profiles = data.profiles.filter(p => p.id !== id);
    if (data.activeId === id) data.activeId = null;
    await persist(ownerId, data);
    return { activeId: data.activeId };
  });
}

export async function routingSnapshot(ownerId:string) {
  const d=await load(ownerId);
  return {profiles:d.profiles, activeId:d.activeId, routing:d.routing ?? DEFAULT_ROUTING};
}
export async function setRouting(ownerId:string, raw:unknown) {
  return serialized(ownerId, async()=>{
    const d=await load(ownerId);
    d.routing=validateRoutingSettings(raw);
    await persist(ownerId,d);
    return {routing:d.routing};
  });
}
