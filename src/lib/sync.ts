import { invoke } from "@tauri-apps/api/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { nowISO } from "./dates";
import {
  attachDownloadedPhoto,
  deleteColonyLocal,
  detachColony,
  getColony,
  getDeviceId,
  getDeviceName,
  getDeviceState,
  listDirtyMice,
  listDirtySettings,
  listDirtyWeights,
  markColonyUnsynced,
  markMousePushed,
  markSettingPushed,
  markWeightPushed,
  mergeRemoteMouse,
  mergeRemoteSetting,
  mergeRemoteWeight,
  renameColony,
  setActiveColony,
  setColonyShared,
  setDeviceName,
  setDeviceState,
  setLastPulledAt,
  upsertColonyLocal,
  type SyncMouse,
  type SyncWeight,
} from "./db";
import { SYNC_ANON_KEY, SYNC_URL } from "./sync-config";
import type { Colony, ColonyMember, ColonyRole, RemoteMouse, RemoteSetting, RemoteWeight } from "./types";

let client: SupabaseClient | null = null;
let sessionPromise: Promise<string> | null = null;
let syncChain: Promise<unknown> = Promise.resolve();

export function syncConfigured(): boolean {
  return Boolean(configOrNull());
}

function configOrNull(): { url: string; key: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL || SYNC_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY || SYNC_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

function config(): { url: string; key: string } {
  const ready = configOrNull();
  if (!ready) throw new Error("The shared colony could not be reached.");
  return ready;
}

function getSupabase(): SupabaseClient {
  const { url, key } = config();
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
    });
    client.auth.onAuthStateChange((_event, session) => {
      if (session) void persistSession(session.access_token, session.refresh_token, session.user.id);
    });
  }
  return client;
}

async function persistSession(accessToken: string, refreshToken: string, userId: string): Promise<void> {
  await setDeviceState("access_token", accessToken);
  await setDeviceState("refresh_token", refreshToken);
  await setDeviceState("auth_user_id", userId);
}

export function ensureDeviceSession(): Promise<string> {
  if (!sessionPromise) {
    sessionPromise = openSession().finally(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

async function openSession(): Promise<string> {
  const supabase = getSupabase();
  const access = await getDeviceState("access_token");
  const refresh = await getDeviceState("refresh_token");
  if (access && refresh) {
    const { data, error } = await supabase.auth.setSession({
      access_token: access,
      refresh_token: refresh,
    });
    if (!error && data.session) {
      await persistSession(data.session.access_token, data.session.refresh_token, data.session.user.id);
      return data.session.user.id;
    }
  }

  const { url, key } = config();
  const response = await fetch(`${url}/functions/v1/device-session`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      device_id: await getDeviceId(),
      device_name: await getDeviceName(),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Could not start a sync session.");
  }
  const { error } = await supabase.auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  });
  if (error) throw new Error(error.message);
  await persistSession(payload.access_token, payload.refresh_token, payload.user_id);
  return payload.user_id as string;
}

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  await ensureDeviceSession();
  const { url, key } = config();
  const session = (await getSupabase().auth.getSession()).data.session;
  const response = await fetch(`${url}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Sync request failed.");
  }
  return payload as T;
}

export async function shareColony(colonyId: string): Promise<void> {
  const colony = await getColony(colonyId);
  if (colony.role !== "owner") throw new Error("Only an owner can share this colony.");
  await callFunction("create-colony", { id: colony.id, name: colony.name });
  await setColonyShared(colonyId, true);
  await markColonyUnsynced(colonyId);
  await syncColony(colonyId);
}

export async function joinColony(code: string): Promise<Colony> {
  const result = await callFunction<{ colony_id: string; name: string; role: ColonyRole }>(
    "redeem-invite",
    { code },
  );
  await upsertColonyLocal({
    id: result.colony_id,
    name: result.name,
    role: result.role,
    shared: true,
  });
  await setActiveColony(result.colony_id);
  await syncColony(result.colony_id);
  return getColony(result.colony_id);
}

export async function createInvite(
  colonyId: string,
  role: ColonyRole,
): Promise<{ code: string; expires_at: string; role: ColonyRole }> {
  return callFunction("create-invite", { colony_id: colonyId, role });
}

export async function listMembers(colonyId: string): Promise<ColonyMember[]> {
  await ensureDeviceSession();
  const { data, error } = await getSupabase()
    .from("colony_members")
    .select("*")
    .eq("colony_id", colonyId)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ColonyMember[];
}

export async function setMember(
  colonyId: string,
  userId: string,
  role: ColonyRole | "revoke",
): Promise<void> {
  await callFunction("set-member", { colony_id: colonyId, user_id: userId, role });
}

export async function leaveColony(colonyId: string): Promise<void> {
  const userId = await getDeviceState("auth_user_id");
  if (!userId) throw new Error("This computer has not joined sync yet.");
  await setMember(colonyId, userId, "revoke");
  await detachColony(colonyId);
}

export async function removeColonyFromThisComputer(colonyId: string): Promise<void> {
  const colony = await getColony(colonyId);
  if (colony.shared && syncConfigured()) {
    const userId = await getDeviceState("auth_user_id");
    if (userId) {
      try {
        await setMember(colonyId, userId, "revoke");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes("not in this colony")) throw error;
      }
    }
  }
  const photos = await deleteColonyLocal(colonyId);
  if (photos.length) {
    await invoke("delete_photo_files", { paths: photos });
  }
}

export async function publishDeviceName(name: string): Promise<void> {
  const trimmed = await setDeviceName(name);
  if (!syncConfigured()) return;
  if (!(await getDeviceState("auth_user_id"))) return;
  await callFunction("set-member", { device_name: trimmed });
}

export async function renameSharedColony(colonyId: string, name: string): Promise<void> {
  const colony = await getColony(colonyId);
  if (colony.role !== "owner") throw new Error("This colony is view-only.");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Colony name is required.");
  if (colony.shared) {
    await ensureDeviceSession();
    const { error } = await getSupabase()
      .from("colonies")
      .update({ name: trimmed, updated_at: nowISO() })
      .eq("id", colonyId);
    if (error) throw new Error(error.message);
  }
  await renameColony(colonyId, trimmed);
}

export function syncColony(colonyId: string): Promise<boolean> {
  const run = syncChain.then(() => runSync(colonyId));
  syncChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function currentUserId(): Promise<string | null> {
  return getDeviceState("auth_user_id");
}

export function subscribeChanges(onChange: () => void): () => void {
  if (!syncConfigured()) return () => undefined;
  const supabase = getSupabase();
  const channel = supabase
    .channel(`colony-sync-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "mice" }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "weights" }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, () => onChange())
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

async function runSync(colonyId: string): Promise<boolean> {
  const colony = await getColony(colonyId);
  if (!colony.shared) return false;
  const userId = await ensureDeviceSession();
  const supabase = getSupabase();
  const { data: membership, error: memberError } = await supabase
    .from("colony_members")
    .select("role, revoked_at")
    .eq("colony_id", colonyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!membership || membership.revoked_at) {
    await detachColony(colonyId);
    throw new Error("You were removed from this colony. A private copy stays on this computer.");
  }

  const { data: remoteColony, error: colonyError } = await supabase
    .from("colonies")
    .select("name")
    .eq("id", colonyId)
    .maybeSingle();
  if (colonyError) throw new Error(colonyError.message);

  let changed =
    membership.role !== colony.role || Boolean(remoteColony && remoteColony.name !== colony.name);
  if (changed) {
    await upsertColonyLocal({
      id: colony.id,
      name: remoteColony?.name || colony.name,
      role: membership.role,
      shared: true,
    });
  }

  const watcher = membership.role !== "owner";
  if (await pullColony(colonyId, watcher)) changed = true;
  if (!watcher) await pushColony(colonyId);
  await setLastPulledAt(colonyId, nowISO());
  return changed;
}

async function pullColony(colonyId: string, force: boolean): Promise<boolean> {
  // Read the whole colony each time. updated_at is stamped by whichever
  // computer made the edit, so a cursor would drop edits from a clock that
  // is behind. sync_state.last_pulled_at only records the last success.
  const supabase = getSupabase();
  const { data: mice, error } = await supabase.from("mice").select("*").eq("colony_id", colonyId);
  if (error) throw new Error(error.message);
  const remoteMice = ((mice ?? []) as RemoteMouse[]).map(normalizeMouse);
  let changed = false;
  const photoIds: string[] = [];
  for (const mouse of remoteMice) {
    const result = await mergeRemoteMouse(mouse, force);
    if (result.changed) changed = true;
    if (result.needsPhoto && mouse.photo_path) photoIds.push(mouse.id);
  }

  const ids = remoteMice.map((mouse) => mouse.id);
  const remoteWeights: RemoteWeight[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const { data, error: weightError } = await supabase.from("weights").select("*").in("mouse_id", slice);
    if (weightError) throw new Error(weightError.message);
    remoteWeights.push(...((data ?? []) as RemoteWeight[]));
  }
  for (const weight of remoteWeights) {
    if (await mergeRemoteWeight(normalizeWeight(weight), force)) changed = true;
  }

  const { data: settings, error: settingsError } = await supabase
    .from("settings")
    .select("*")
    .eq("colony_id", colonyId);
  if (settingsError) throw new Error(settingsError.message);
  for (const setting of (settings ?? []) as RemoteSetting[]) {
    if (await mergeRemoteSetting({ ...setting, value: String(setting.value) }, force)) changed = true;
  }

  for (const id of photoIds) {
    const mouse = remoteMice.find((row) => row.id === id);
    if (!mouse?.photo_path) continue;
    await downloadPhoto(id, mouse.photo_path);
    changed = true;
  }
  return changed;
}

async function pushColony(colonyId: string): Promise<void> {
  const supabase = getSupabase();
  const mice = (await listDirtyMice(colonyId)).sort(
    (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
  );
  const photoErrors: string[] = [];
  for (const mouse of mice) {
    const uploaded = await pushMousePhoto(supabase, mouse, photoErrors);
    const photoKey = uploaded.clearPhoto ? uploaded.photoKey : mouse.photo_key;
    const { error } = await supabase.from("mice").upsert(toRemoteMouse(mouse, photoKey));
    if (error) throw new Error(error.message);
    if (uploaded.clearPhoto || !Number(mouse.photo_dirty)) {
      await markMousePushed(mouse.id, mouse.updated_at, photoKey, uploaded.clearPhoto);
    }
  }

  const weights = (await listDirtyWeights(colonyId)).sort(
    (a, b) => Number(Boolean(b.deleted_at)) - Number(Boolean(a.deleted_at)),
  );
  for (const weight of weights) {
    const { error } = await supabase.from("weights").upsert(toRemoteWeight(weight));
    if (error) throw new Error(error.message);
    await markWeightPushed(weight.id, weight.updated_at);
  }

  const settings = await listDirtySettings(colonyId);
  for (const row of settings) {
    const { error } = await supabase.from("settings").upsert(
      {
        colony_id: row.colony_id,
        key: row.key,
        value: row.value,
        updated_at: row.updated_at,
      },
      { onConflict: "colony_id,key" },
    );
    if (error) throw new Error(error.message);
    await markSettingPushed(row.colony_id, row.key, row.updated_at);
  }

  if (photoErrors.length) throw new Error(photoErrors[0]);
}

async function pushMousePhoto(
  supabase: SupabaseClient,
  mouse: SyncMouse,
  photoErrors: string[],
): Promise<{ photoKey: string | null; clearPhoto: boolean }> {
  if (!Number(mouse.photo_dirty)) return { photoKey: mouse.photo_key, clearPhoto: false };
  try {
    if (mouse.photo_path && !mouse.deleted_at) {
      const photoKey = `${mouse.colony_id}/${mouse.id}`;
      const encoded = await invoke<string>("read_photo_base64", { path: mouse.photo_path });
      const bytes = base64ToBytes(encoded);
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      const body = new Blob([copy], { type: mimeFromPath(mouse.photo_path) });
      const { error } = await supabase.storage.from("photos").upload(photoKey, body, {
        upsert: true,
        contentType: mimeFromPath(mouse.photo_path),
      });
      if (error) throw new Error(error.message);
      return { photoKey, clearPhoto: true };
    }
    await supabase.storage.from("photos").remove([`${mouse.colony_id}/${mouse.id}`]);
    return { photoKey: null, clearPhoto: true };
  } catch (error) {
    photoErrors.push(error instanceof Error ? error.message : String(error));
    return { photoKey: mouse.photo_key, clearPhoto: false };
  }
}

async function downloadPhoto(mouseId: string, key: string): Promise<void> {
  const { data, error } = await getSupabase().storage.from("photos").download(key);
  if (error || !data) throw new Error(error?.message || "Could not download a photo.");
  const path = await invoke<string>("write_photo", {
    mouseId,
    ext: extFromMime(data.type),
    dataBase64: bytesToBase64(new Uint8Array(await data.arrayBuffer())),
  });
  await attachDownloadedPhoto(mouseId, path, key);
}

function toRemoteMouse(mouse: SyncMouse, photoKey: string | null): RemoteMouse {
  return {
    id: mouse.id,
    colony_id: mouse.colony_id,
    name: mouse.name,
    sex: mouse.sex,
    birthdate: mouse.birthdate,
    strain: mouse.strain,
    genotype: mouse.genotype,
    cage: mouse.cage,
    ear_mark: mouse.ear_mark,
    experiment: mouse.experiment,
    notes: mouse.notes,
    photo_path: photoKey,
    color: mouse.color,
    baseline_weight_g: mouse.baseline_weight_g,
    restriction_start: mouse.restriction_start,
    status: mouse.status,
    created_at: mouse.created_at,
    updated_at: mouse.updated_at,
    deleted_at: mouse.deleted_at,
  };
}

function toRemoteWeight(weight: SyncWeight): RemoteWeight {
  return {
    id: weight.id,
    mouse_id: weight.mouse_id,
    date: weight.date,
    weight_g: weight.weight_g,
    note: weight.note,
    created_at: weight.created_at,
    updated_at: weight.updated_at,
    deleted_at: weight.deleted_at,
  };
}

function normalizeMouse(row: RemoteMouse): RemoteMouse {
  return {
    ...row,
    birthdate: row.birthdate ?? null,
    strain: row.strain ?? null,
    genotype: row.genotype ?? null,
    cage: row.cage ?? null,
    ear_mark: row.ear_mark ?? null,
    experiment: row.experiment ?? null,
    notes: row.notes ?? null,
    photo_path: row.photo_path ?? null,
    color: row.color ?? null,
    baseline_weight_g: row.baseline_weight_g ?? null,
    restriction_start: row.restriction_start ?? null,
    deleted_at: row.deleted_at ?? null,
  };
}

function normalizeWeight(row: RemoteWeight): RemoteWeight {
  return {
    ...row,
    note: row.note ?? null,
    deleted_at: row.deleted_at ?? null,
  };
}

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "heic") return "image/heic";
  return "image/jpeg";
}

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("heic")) return "heic";
  return "jpg";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
