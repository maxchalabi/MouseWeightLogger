import Database from "@tauri-apps/plugin-sql";
import { applyUniqueColorAssignment, nextUnusedColor, planUniqueColors, usedColors } from "./colors";
import { addDays, nowISO, todayISO } from "./dates";
import type {
  Colony,
  ColonyRole,
  Mouse,
  MouseDraft,
  MouseStatus,
  RemoteMouse,
  RemoteSetting,
  RemoteWeight,
  WeighRow,
  Weight,
} from "./types";

let dbPromise: Promise<Database> | null = null;

type ColonyRow = {
  id: string;
  name: string;
  role: ColonyRole;
  shared: number;
  created_at: string;
  updated_at: string;
};

export type SyncMouse = Mouse & {
  dirty: number;
  photo_key: string | null;
  photo_dirty: number;
};

export type SyncWeight = Weight & {
  dirty: number;
};

export type SyncSetting = RemoteSetting & {
  dirty: number;
};

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function mapColony(row: ColonyRow): Colony {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    shared: Number(row.shared) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function timeMs(value: string): number {
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : 0;
}

function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return timeMs(a) === timeMs(b);
}

function remoteWins(
  local: { updated_at: string; dirty: number } | undefined,
  force: boolean,
  remoteUpdated: string,
): boolean {
  if (!local || force) return true;
  if (!Number(local.dirty)) return true;
  return timeMs(remoteUpdated) > timeMs(local.updated_at);
}

function isUniqueError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("unique");
}

async function tableExists(db: Database, name: string): Promise<boolean> {
  const rows = await db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = $1",
    [name],
  );
  return rows.length > 0;
}

async function hasColumn(db: Database, table: string, column: string): Promise<boolean> {
  if (!(await tableExists(db, table))) return false;
  try {
    await db.select(`SELECT ${column} FROM ${table} LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

async function ensureSchema(db: Database): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS colonies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'watcher')),
    shared INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS device_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS sync_state (
    colony_id TEXT PRIMARY KEY,
    last_pulled_at TEXT
  )`);

  let colonyId = await ensureDefaultColony(db);
  await migrateWeights(db);
  if (!colonyId && (await legacyMiceNeedColony(db) || (await legacySettingsNeedColony(db)))) {
    colonyId = await insertDefaultColony(db);
  }
  if (colonyId) {
    await migrateMice(db, colonyId);
    await migrateSettings(db, colonyId);
    await ensureActiveColony(db, colonyId);
  } else {
    if (!(await tableExists(db, "mice"))) await createMiceTable(db);
    if (!(await tableExists(db, "settings"))) await createSettingsTable(db);
    await clearMissingActiveColony(db);
  }
  await ensureDeviceId(db);
  await ensureBaselineRows(db);
  await ensureUniqueMouseColors(db);
}

async function markColoniesInitialized(db: Database): Promise<void> {
  await db.execute(
    `INSERT INTO device_state (key, value) VALUES ('colonies_initialized', '1')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
}

async function insertDefaultColony(db: Database): Promise<string> {
  const id = crypto.randomUUID();
  const stamp = nowISO();
  await db.execute(
    `INSERT INTO colonies (id, name, role, shared, created_at, updated_at)
     VALUES ($1, 'This computer', 'owner', 0, $2, $2)`,
    [id, stamp],
  );
  await markColoniesInitialized(db);
  return id;
}

async function ensureDefaultColony(db: Database): Promise<string | null> {
  const rows = await db.select<{ id: string }[]>(
    "SELECT id FROM colonies ORDER BY created_at ASC LIMIT 1",
  );
  if (rows[0]) {
    await markColoniesInitialized(db);
    return rows[0].id;
  }
  const flag = await db.select<{ value: string }[]>(
    "SELECT value FROM device_state WHERE key = 'colonies_initialized'",
  );
  if (flag[0]?.value === "1") return null;
  return insertDefaultColony(db);
}

async function legacyMiceNeedColony(db: Database): Promise<boolean> {
  return (await tableExists(db, "mice")) && !(await hasColumn(db, "mice", "colony_id"));
}

async function legacySettingsNeedColony(db: Database): Promise<boolean> {
  return (await tableExists(db, "settings")) && !(await hasColumn(db, "settings", "colony_id"));
}

async function clearMissingActiveColony(db: Database): Promise<void> {
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM device_state WHERE key = 'active_colony_id'",
  );
  if (!rows[0]?.value) return;
  const found = await db.select<{ id: string }[]>("SELECT id FROM colonies WHERE id = $1", [
    rows[0].value,
  ]);
  if (found[0]) return;
  await db.execute("DELETE FROM device_state WHERE key = 'active_colony_id'");
}

async function migrateMice(db: Database, colonyId: string): Promise<void> {
  if (!(await tableExists(db, "mice"))) {
    await createMiceTable(db);
    return;
  }
  if (await hasColumn(db, "mice", "colony_id")) return;

  const colorSql = (await hasColumn(db, "mice", "color")) ? "color" : "NULL";
  await db.execute("DROP TABLE IF EXISTS mice_v2");
  await createMiceTable(db, "mice_v2");
  await db.execute(
    `INSERT INTO mice_v2 (
      id, colony_id, name, sex, birthdate, strain, genotype, cage, ear_mark, experiment,
      notes, photo_path, color, baseline_weight_g, restriction_start, status,
      created_at, updated_at, deleted_at, dirty, photo_key, photo_dirty
    )
    SELECT
      id, $1, name, sex, birthdate, strain, genotype, cage, ear_mark, experiment,
      notes, photo_path, ${colorSql}, baseline_weight_g, restriction_start, status,
      created_at, updated_at, NULL, 0, NULL, 0
    FROM mice`,
    [colonyId],
  );
  await db.execute("DROP TABLE mice");
  await db.execute("ALTER TABLE mice_v2 RENAME TO mice");
  await createMiceIndexes(db);
}

async function createMiceTable(db: Database, name = "mice"): Promise<void> {
  await db.execute(`CREATE TABLE ${name} (
    id TEXT PRIMARY KEY,
    colony_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sex TEXT NOT NULL CHECK (sex IN ('M', 'F', 'U')),
    birthdate TEXT,
    strain TEXT,
    genotype TEXT,
    cage TEXT,
    ear_mark TEXT,
    experiment TEXT,
    notes TEXT,
    photo_path TEXT,
    color TEXT,
    baseline_weight_g REAL,
    restriction_start TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 0,
    photo_key TEXT,
    photo_dirty INTEGER NOT NULL DEFAULT 0
  )`);
  if (name === "mice") await createMiceIndexes(db);
}

async function createMiceIndexes(db: Database): Promise<void> {
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_mice_colony_status_name ON mice (colony_id, status, name)",
  );
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_mice_colony_name_live
     ON mice (colony_id, name) WHERE deleted_at IS NULL`,
  );
}

async function migrateWeights(db: Database): Promise<void> {
  if (!(await tableExists(db, "weights"))) {
    await createWeightsTable(db);
    return;
  }
  if (await hasColumn(db, "weights", "deleted_at")) return;

  await db.execute("DROP TABLE IF EXISTS weights_v2");
  await createWeightsTable(db, "weights_v2");
  await db.execute(
    `INSERT INTO weights_v2 (id, mouse_id, date, weight_g, note, created_at, updated_at, deleted_at, dirty)
     SELECT id, mouse_id, date, weight_g, note, created_at, updated_at, NULL, 0 FROM weights`,
  );
  await db.execute("DROP TABLE weights");
  await db.execute("ALTER TABLE weights_v2 RENAME TO weights");
  await createWeightsIndexes(db);
}

async function createWeightsTable(db: Database, name = "weights"): Promise<void> {
  await db.execute(`CREATE TABLE ${name} (
    id TEXT PRIMARY KEY,
    mouse_id TEXT NOT NULL,
    date TEXT NOT NULL,
    weight_g REAL NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 0
  )`);
  if (name === "weights") await createWeightsIndexes(db);
}

async function createWeightsIndexes(db: Database): Promise<void> {
  await db.execute("CREATE INDEX IF NOT EXISTS idx_weights_mouse_date ON weights (mouse_id, date)");
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_weights_mouse_date_live
     ON weights (mouse_id, date) WHERE deleted_at IS NULL`,
  );
}

async function migrateSettings(db: Database, colonyId: string): Promise<void> {
  if (!(await tableExists(db, "settings"))) {
    await createSettingsTable(db);
    return;
  }
  if (await hasColumn(db, "settings", "colony_id")) return;

  const stamp = nowISO();
  await db.execute("DROP TABLE IF EXISTS settings_v2");
  await createSettingsTable(db, "settings_v2");
  await db.execute(
    `INSERT INTO settings_v2 (colony_id, key, value, updated_at, dirty)
     SELECT $1, key, value, $2, 0 FROM settings`,
    [colonyId, stamp],
  );
  await db.execute("DROP TABLE settings");
  await db.execute("ALTER TABLE settings_v2 RENAME TO settings");
}

async function createSettingsTable(db: Database, name = "settings"): Promise<void> {
  await db.execute(`CREATE TABLE ${name} (
    colony_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    dirty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (colony_id, key)
  )`);
}

async function ensureBaselineRows(db: Database): Promise<void> {
  const stamp = nowISO();
  await db.execute(
    `INSERT INTO settings (colony_id, key, value, updated_at, dirty)
     SELECT id, 'baseline_percent', '80', $1, 0 FROM colonies
     WHERE NOT EXISTS (
       SELECT 1 FROM settings s WHERE s.colony_id = colonies.id AND s.key = 'baseline_percent'
     )`,
    [stamp],
  );
}

async function ensureActiveColony(db: Database, fallbackId: string): Promise<void> {
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM device_state WHERE key = 'active_colony_id'",
  );
  if (rows[0]?.value) {
    const found = await db.select<{ id: string }[]>("SELECT id FROM colonies WHERE id = $1", [
      rows[0].value,
    ]);
    if (found[0]) return;
  }
  await db.execute(
    `INSERT INTO device_state (key, value) VALUES ('active_colony_id', $1)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [fallbackId],
  );
}

async function ensureDeviceId(db: Database): Promise<void> {
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM device_state WHERE key = 'device_id'",
  );
  if (rows[0]?.value) return;
  await db.execute("INSERT INTO device_state (key, value) VALUES ('device_id', $1)", [
    crypto.randomUUID(),
  ]);
}

async function ensureUniqueMouseColors(db: Database): Promise<void> {
  const colonies = await db.select<{ id: string; role: ColonyRole }[]>(
    "SELECT id, role FROM colonies",
  );
  for (const colony of colonies) {
    if (colony.role !== "owner") continue;
    const mice = await db.select<Mouse[]>(
      `SELECT * FROM mice
       WHERE colony_id = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC, name COLLATE NOCASE`,
      [colony.id],
    );
    const updates = planUniqueColors(mice);
    if (updates.length) await writeMouseColors(db, updates);
  }
}

async function writeMouseColors(
  db: Database,
  updates: { id: string; color: string }[],
): Promise<void> {
  const stamp = nowISO();
  for (const { id, color } of updates) {
    await db.execute(
      "UPDATE mice SET color = $1, updated_at = $2, dirty = 1 WHERE id = $3 AND deleted_at IS NULL",
      [color, stamp, id],
    );
  }
}

async function activeColonyId(db: Database): Promise<string> {
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM device_state WHERE key = 'active_colony_id'",
  );
  if (!rows[0]?.value) throw new Error("No colony is selected.");
  return rows[0].value;
}

async function colonyRow(db: Database, id: string): Promise<ColonyRow> {
  const rows = await db.select<ColonyRow[]>("SELECT * FROM colonies WHERE id = $1", [id]);
  if (!rows[0]) throw new Error("That colony is not on this computer.");
  return rows[0];
}

async function requireActiveOwner(db: Database): Promise<string> {
  const id = await activeColonyId(db);
  const row = await colonyRow(db, id);
  if (row.role !== "owner") throw new Error("This colony is view-only.");
  return id;
}

async function requireColonyOwner(db: Database, id: string): Promise<void> {
  const row = await colonyRow(db, id);
  if (row.role !== "owner") throw new Error("This colony is view-only.");
}

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:mouseweight.db").then(async (db) => {
      await ensureSchema(db);
      return db;
    });
  }
  return dbPromise;
}

export async function getDeviceState(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM device_state WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setDeviceState(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO device_state (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function getDeviceId(): Promise<string> {
  const id = await getDeviceState("device_id");
  if (!id) throw new Error("This computer has no device id yet.");
  return id;
}

export async function getDeviceName(): Promise<string> {
  return (await getDeviceState("device_name")) ?? "This computer";
}

export async function setDeviceName(name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name this computer before sharing.");
  await setDeviceState("device_name", trimmed);
  return trimmed;
}

export async function listColonies(): Promise<Colony[]> {
  const db = await getDb();
  const rows = await db.select<ColonyRow[]>("SELECT * FROM colonies ORDER BY created_at ASC");
  return rows.map(mapColony);
}

export async function getColony(id: string): Promise<Colony> {
  const db = await getDb();
  return mapColony(await colonyRow(db, id));
}

export async function getActiveColony(): Promise<Colony | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM device_state WHERE key = 'active_colony_id'",
  );
  if (!rows[0]?.value) return null;
  const found = await db.select<ColonyRow[]>("SELECT * FROM colonies WHERE id = $1", [rows[0].value]);
  return found[0] ? mapColony(found[0]) : null;
}

export async function deleteColonyLocal(id: string): Promise<string[]> {
  const db = await getDb();
  const photos = await db.select<{ photo_path: string | null }[]>(
    "SELECT photo_path FROM mice WHERE colony_id = $1 AND photo_path IS NOT NULL",
    [id],
  );
  await db.execute("DELETE FROM weights WHERE mouse_id IN (SELECT id FROM mice WHERE colony_id = $1)", [
    id,
  ]);
  await db.execute("DELETE FROM mice WHERE colony_id = $1", [id]);
  await db.execute("DELETE FROM settings WHERE colony_id = $1", [id]);
  await db.execute("DELETE FROM sync_state WHERE colony_id = $1", [id]);
  await db.execute("DELETE FROM colonies WHERE id = $1", [id]);

  const active = await db.select<{ value: string }[]>(
    "SELECT value FROM device_state WHERE key = 'active_colony_id'",
  );
  if (active[0]?.value === id) {
    const next = await db.select<{ id: string }[]>(
      "SELECT id FROM colonies ORDER BY created_at ASC LIMIT 1",
    );
    if (next[0]) {
      await db.execute(
        `INSERT INTO device_state (key, value) VALUES ('active_colony_id', $1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [next[0].id],
      );
    } else {
      await db.execute("DELETE FROM device_state WHERE key = 'active_colony_id'");
    }
  }

  return photos.flatMap((row) => (row.photo_path ? [row.photo_path] : []));
}

export async function setActiveColony(id: string): Promise<Colony> {
  const db = await getDb();
  const row = await colonyRow(db, id);
  await setDeviceState("active_colony_id", id);
  return mapColony(row);
}

export async function createLocalColony(name: string): Promise<Colony> {
  const db = await getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Colony name is required.");
  const id = crypto.randomUUID();
  const stamp = nowISO();
  await db.execute(
    `INSERT INTO colonies (id, name, role, shared, created_at, updated_at)
     VALUES ($1, $2, 'owner', 0, $3, $3)`,
    [id, trimmed, stamp],
  );
  await db.execute(
    `INSERT INTO settings (colony_id, key, value, updated_at, dirty)
     VALUES ($1, 'baseline_percent', '80', $2, 0)`,
    [id, stamp],
  );
  return setActiveColony(id);
}

export async function renameColony(id: string, name: string): Promise<void> {
  const db = await getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Colony name is required.");
  await requireColonyOwner(db, id);
  await db.execute("UPDATE colonies SET name = $1, updated_at = $2 WHERE id = $3", [
    trimmed,
    nowISO(),
    id,
  ]);
}

export async function upsertColonyLocal(input: {
  id: string;
  name: string;
  role: ColonyRole;
  shared: boolean;
}): Promise<void> {
  const db = await getDb();
  const stamp = nowISO();
  await db.execute(
    `INSERT INTO colonies (id, name, role, shared, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       role = excluded.role,
       shared = excluded.shared,
       updated_at = excluded.updated_at`,
    [input.id, input.name, input.role, input.shared ? 1 : 0, stamp],
  );
  await db.execute(
    `INSERT INTO settings (colony_id, key, value, updated_at, dirty)
     VALUES ($1, 'baseline_percent', '80', $2, 0)
     ON CONFLICT(colony_id, key) DO NOTHING`,
    [input.id, stamp],
  );
}

export async function markColonyUnsynced(colonyId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE mice SET dirty = 1,
       photo_dirty = CASE
         WHEN photo_path IS NOT NULL AND deleted_at IS NULL THEN 1
         ELSE photo_dirty
       END
     WHERE colony_id = $1`,
    [colonyId],
  );
  await db.execute(
    `UPDATE weights SET dirty = 1
     WHERE mouse_id IN (SELECT id FROM mice WHERE colony_id = $1)`,
    [colonyId],
  );
  await db.execute("UPDATE settings SET dirty = 1 WHERE colony_id = $1", [colonyId]);
}

export async function setColonyShared(id: string, shared: boolean): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE colonies SET shared = $1, updated_at = $2 WHERE id = $3", [
    shared ? 1 : 0,
    nowISO(),
    id,
  ]);
}

export async function detachColony(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE colonies SET shared = 0, role = 'owner', updated_at = $1 WHERE id = $2",
    [nowISO(), id],
  );
}

export async function getLastPulledAt(colonyId: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ last_pulled_at: string | null }[]>(
    "SELECT last_pulled_at FROM sync_state WHERE colony_id = $1",
    [colonyId],
  );
  return rows[0]?.last_pulled_at ?? null;
}

export async function setLastPulledAt(colonyId: string, iso: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO sync_state (colony_id, last_pulled_at) VALUES ($1, $2)
     ON CONFLICT(colony_id) DO UPDATE SET last_pulled_at = excluded.last_pulled_at`,
    [colonyId, iso],
  );
}

export async function listMice(status?: MouseStatus): Promise<Mouse[]> {
  const db = await getDb();
  const colonyId = await activeColonyId(db);
  if (status) {
    return db.select<Mouse[]>(
      `SELECT * FROM mice
       WHERE colony_id = $1 AND status = $2 AND deleted_at IS NULL
       ORDER BY name COLLATE NOCASE`,
      [colonyId, status],
    );
  }
  return db.select<Mouse[]>(
    `SELECT * FROM mice
     WHERE colony_id = $1 AND deleted_at IS NULL
     ORDER BY status ASC, name COLLATE NOCASE`,
    [colonyId],
  );
}

export async function getMouse(id: string): Promise<Mouse | null> {
  const db = await getDb();
  const colonyId = await activeColonyId(db);
  const rows = await db.select<Mouse[]>(
    "SELECT * FROM mice WHERE id = $1 AND colony_id = $2 AND deleted_at IS NULL",
    [id, colonyId],
  );
  return rows[0] ?? null;
}

async function releaseName(db: Database, colonyId: string, name: string, keepId: string): Promise<void> {
  const rows = await db.select<{ id: string }[]>(
    `SELECT id FROM mice
     WHERE colony_id = $1 AND name = $2 AND deleted_at IS NULL AND id != $3`,
    [colonyId, name, keepId],
  );
  const stamp = nowISO();
  for (const row of rows) {
    let suffix = 2;
    let candidate = `${name} (${suffix})`;
    while (true) {
      const clash = await db.select<{ id: string }[]>(
        `SELECT id FROM mice
         WHERE colony_id = $1 AND name = $2 AND deleted_at IS NULL AND id != $3`,
        [colonyId, candidate, keepId],
      );
      if (clash.length === 0) break;
      suffix += 1;
      candidate = `${name} (${suffix})`;
    }
    await db.execute(
      "UPDATE mice SET name = $1, updated_at = $2, dirty = 1 WHERE id = $3",
      [candidate, stamp, row.id],
    );
  }
}

export async function upsertMouse(id: string | null, draft: MouseDraft): Promise<string> {
  const db = await getDb();
  const colonyId = await requireActiveOwner(db);
  const mouseId = id ?? crypto.randomUUID();
  const existing = id ? await getMouse(id) : null;
  const colony = await listMice();
  const requested = emptyToNull(draft.color) ?? nextUnusedColor(usedColors(colony, mouseId));
  const colorUpdates = applyUniqueColorAssignment(
    existing ? colony : [...colony, { id: mouseId, color: null }],
    mouseId,
    requested,
  );
  const assignedColor = colorUpdates.find((row) => row.id === mouseId)?.color ?? requested;
  const stamp = nowISO();
  const name = draft.name.trim();
  if (!name) throw new Error("Name is required.");

  try {
    if (existing) {
      await db.execute(
        `UPDATE mice SET
          name = $2, sex = $3, birthdate = $4, strain = $5, genotype = $6,
          cage = $7, ear_mark = $8, experiment = $9, notes = $10, photo_path = $11,
          color = $12, baseline_weight_g = $13, restriction_start = $14, status = $15,
          updated_at = $16, dirty = 1,
          photo_dirty = CASE
            WHEN IFNULL(photo_path, '') != IFNULL($11, '') THEN 1
            ELSE photo_dirty
          END
         WHERE id = $1 AND colony_id = $17 AND deleted_at IS NULL`,
        [
          mouseId,
          name,
          draft.sex,
          emptyToNull(draft.birthdate),
          emptyToNull(draft.strain),
          emptyToNull(draft.genotype),
          emptyToNull(draft.cage),
          emptyToNull(draft.ear_mark),
          emptyToNull(draft.experiment),
          emptyToNull(draft.notes),
          draft.photo_path,
          assignedColor,
          parseNumber(draft.baseline_weight_g),
          emptyToNull(draft.restriction_start),
          draft.status,
          stamp,
          colonyId,
        ],
      );
    } else {
      await db.execute(
        `INSERT INTO mice (
          id, colony_id, name, sex, birthdate, strain, genotype, cage, ear_mark, experiment,
          notes, photo_path, color, baseline_weight_g, restriction_start, status,
          created_at, updated_at, deleted_at, dirty, photo_key, photo_dirty
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NULL,1,NULL,$19
        )`,
        [
          mouseId,
          colonyId,
          name,
          draft.sex,
          emptyToNull(draft.birthdate),
          emptyToNull(draft.strain),
          emptyToNull(draft.genotype),
          emptyToNull(draft.cage),
          emptyToNull(draft.ear_mark),
          emptyToNull(draft.experiment),
          emptyToNull(draft.notes),
          draft.photo_path,
          assignedColor,
          parseNumber(draft.baseline_weight_g),
          emptyToNull(draft.restriction_start),
          draft.status,
          stamp,
          stamp,
          draft.photo_path ? 1 : 0,
        ],
      );
    }
  } catch (error) {
    if (isUniqueError(error)) throw new Error("A mouse with that name already exists.");
    throw error;
  }

  await writeMouseColors(
    db,
    colorUpdates.filter((row) => row.id !== mouseId),
  );
  return mouseId;
}

export async function setMouseColor(id: string, color: string): Promise<void> {
  const db = await getDb();
  await requireActiveOwner(db);
  const colony = await listMice();
  await writeMouseColors(db, applyUniqueColorAssignment(colony, id, color));
}

export async function setMouseStatus(id: string, status: MouseStatus): Promise<void> {
  const db = await getDb();
  await requireActiveOwner(db);
  await db.execute(
    "UPDATE mice SET status = $1, updated_at = $2, dirty = 1 WHERE id = $3 AND deleted_at IS NULL",
    [status, nowISO(), id],
  );
}

export async function setMousePhoto(id: string, photoPath: string | null): Promise<void> {
  const db = await getDb();
  await requireActiveOwner(db);
  await db.execute(
    `UPDATE mice SET photo_path = $1, updated_at = $2, dirty = 1, photo_dirty = 1
     WHERE id = $3 AND deleted_at IS NULL`,
    [photoPath, nowISO(), id],
  );
}

export async function listWeighRows(date: string): Promise<WeighRow[]> {
  const db = await getDb();
  const colonyId = await activeColonyId(db);
  return db.select<WeighRow[]>(
    `SELECT m.*,
      (SELECT w.weight_g FROM weights w
        WHERE w.mouse_id = m.id AND w.date = $1 AND w.deleted_at IS NULL) AS today_weight,
      (SELECT w.weight_g FROM weights w
        WHERE w.mouse_id = m.id AND w.date < $1 AND w.deleted_at IS NULL
        ORDER BY w.date DESC LIMIT 1) AS prev_weight,
      (SELECT w.date FROM weights w
        WHERE w.mouse_id = m.id AND w.date < $1 AND w.deleted_at IS NULL
        ORDER BY w.date DESC LIMIT 1) AS prev_date
     FROM mice m
     WHERE m.colony_id = $2 AND m.status = 'active' AND m.deleted_at IS NULL
     ORDER BY m.name COLLATE NOCASE`,
    [date, colonyId],
  );
}

export async function listWeights(mouseIds?: string[]): Promise<Weight[]> {
  const db = await getDb();
  const colonyId = await activeColonyId(db);
  if (mouseIds && mouseIds.length === 0) return [];
  const filter = mouseIds
    ? ` AND w.mouse_id IN (${mouseIds.map((_, i) => `$${i + 2}`).join(", ")})`
    : "";
  return db.select<Weight[]>(
    `SELECT w.* FROM weights w
     INNER JOIN mice m ON m.id = w.mouse_id
     WHERE m.colony_id = $1 AND m.deleted_at IS NULL AND w.deleted_at IS NULL${filter}
     ORDER BY w.date ASC`,
    mouseIds ? [colonyId, ...mouseIds] : [colonyId],
  );
}

export async function upsertWeight(mouseId: string, date: string, weightG: number): Promise<void> {
  const db = await getDb();
  await requireActiveOwner(db);
  const stamp = nowISO();
  const existing = await db.select<{ id: string; deleted_at: string | null }[]>(
    "SELECT id, deleted_at FROM weights WHERE mouse_id = $1 AND date = $2",
    [mouseId, date],
  );
  const current = existing.find((row) => !row.deleted_at) ?? existing[0];
  if (current) {
    await db.execute(
      `UPDATE weights SET weight_g = $1, updated_at = $2, deleted_at = NULL, dirty = 1 WHERE id = $3`,
      [weightG, stamp, current.id],
    );
    return;
  }
  await db.execute(
    `INSERT INTO weights (id, mouse_id, date, weight_g, note, created_at, updated_at, deleted_at, dirty)
     VALUES ($1, $2, $3, $4, NULL, $5, $5, NULL, 1)`,
    [crypto.randomUUID(), mouseId, date, weightG, stamp],
  );
}

export async function deleteWeight(mouseId: string, date: string): Promise<void> {
  const db = await getDb();
  await requireActiveOwner(db);
  const stamp = nowISO();
  await db.execute(
    `UPDATE weights SET deleted_at = $1, updated_at = $1, dirty = 1
     WHERE mouse_id = $2 AND date = $3 AND deleted_at IS NULL`,
    [stamp, mouseId, date],
  );
}

export async function deleteMouse(id: string): Promise<void> {
  const db = await getDb();
  await requireActiveOwner(db);
  const stamp = nowISO();
  await db.execute(
    `UPDATE weights SET deleted_at = $1, updated_at = $1, dirty = 1
     WHERE mouse_id = $2 AND deleted_at IS NULL`,
    [stamp, id],
  );
  await db.execute(
    "UPDATE mice SET deleted_at = $1, updated_at = $1, dirty = 1 WHERE id = $2 AND deleted_at IS NULL",
    [stamp, id],
  );
}

export async function getBaselinePercent(): Promise<number> {
  const db = await getDb();
  const colonyId = await activeColonyId(db);
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE colony_id = $1 AND key = 'baseline_percent'",
    [colonyId],
  );
  const n = Number(rows[0]?.value);
  if (Number.isFinite(n) && n > 0 && n <= 100) return n;
  return 80;
}

export async function setBaselinePercent(value: number): Promise<void> {
  const db = await getDb();
  const colonyId = await requireActiveOwner(db);
  const next = Math.min(100, Math.max(1, Math.round(value * 10) / 10));
  await db.execute(
    `INSERT INTO settings (colony_id, key, value, updated_at, dirty)
     VALUES ($1, 'baseline_percent', $2, $3, 1)
     ON CONFLICT(colony_id, key) DO UPDATE SET
       value = excluded.value, updated_at = excluded.updated_at, dirty = 1`,
    [colonyId, String(next), nowISO()],
  );
}

export async function listDirtyMice(colonyId: string): Promise<SyncMouse[]> {
  const db = await getDb();
  return db.select<SyncMouse[]>(
    "SELECT * FROM mice WHERE colony_id = $1 AND (dirty = 1 OR photo_dirty = 1)",
    [colonyId],
  );
}

export async function listDirtyWeights(colonyId: string): Promise<SyncWeight[]> {
  const db = await getDb();
  return db.select<SyncWeight[]>(
    `SELECT w.* FROM weights w
     INNER JOIN mice m ON m.id = w.mouse_id
     WHERE m.colony_id = $1 AND w.dirty = 1`,
    [colonyId],
  );
}

export async function listDirtySettings(colonyId: string): Promise<SyncSetting[]> {
  const db = await getDb();
  return db.select<SyncSetting[]>(
    "SELECT * FROM settings WHERE colony_id = $1 AND dirty = 1",
    [colonyId],
  );
}

export async function markMousePushed(
  id: string,
  updatedAt: string,
  photoKey: string | null,
  clearPhotoDirty: boolean,
): Promise<void> {
  const db = await getDb();
  if (clearPhotoDirty) {
    await db.execute(
      `UPDATE mice SET dirty = 0, photo_dirty = 0, photo_key = $1
       WHERE id = $2 AND updated_at = $3`,
      [photoKey, id, updatedAt],
    );
    return;
  }
  await db.execute("UPDATE mice SET dirty = 0 WHERE id = $1 AND updated_at = $2", [id, updatedAt]);
}

export async function markWeightPushed(id: string, updatedAt: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE weights SET dirty = 0 WHERE id = $1 AND updated_at = $2", [
    id,
    updatedAt,
  ]);
}

export async function markSettingPushed(
  colonyId: string,
  key: string,
  updatedAt: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE settings SET dirty = 0 WHERE colony_id = $1 AND key = $2 AND updated_at = $3",
    [colonyId, key, updatedAt],
  );
}

export async function attachDownloadedPhoto(
  id: string,
  path: string,
  photoKey: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE mice SET photo_path = $1, photo_key = $2, photo_dirty = 0
     WHERE id = $3 AND photo_dirty = 0`,
    [path, photoKey, id],
  );
}

export async function mergeRemoteMouse(
  remote: RemoteMouse,
  force: boolean,
): Promise<{ changed: boolean; needsPhoto: boolean }> {
  const db = await getDb();
  const rows = await db.select<SyncMouse[]>("SELECT * FROM mice WHERE id = $1", [remote.id]);
  const local = rows[0];
  if (!remoteWins(local, force, remote.updated_at)) {
    return { changed: false, needsPhoto: false };
  }
  if (
    local &&
    !Number(local.dirty) &&
    !Number(local.photo_dirty) &&
    local.photo_key === remote.photo_path &&
    local.name === remote.name &&
    local.sex === remote.sex &&
    local.birthdate === remote.birthdate &&
    local.strain === remote.strain &&
    local.genotype === remote.genotype &&
    local.cage === remote.cage &&
    local.ear_mark === remote.ear_mark &&
    local.experiment === remote.experiment &&
    local.notes === remote.notes &&
    local.color === remote.color &&
    local.baseline_weight_g === remote.baseline_weight_g &&
    local.restriction_start === remote.restriction_start &&
    local.status === remote.status &&
    local.colony_id === remote.colony_id &&
    sameInstant(local.updated_at, remote.updated_at) &&
    sameInstant(local.deleted_at, remote.deleted_at)
  ) {
    return {
      changed: false,
      needsPhoto: Boolean(remote.photo_path && !remote.deleted_at && !local.photo_path),
    };
  }

  if (!remote.deleted_at) await releaseName(db, remote.colony_id, remote.name, remote.id);
  const keepLocalPhoto = Boolean(local && Number(local.photo_dirty));
  const photoPath = keepLocalPhoto ? local.photo_path : remote.photo_path ? local?.photo_path ?? null : null;
  const photoKey = keepLocalPhoto ? local?.photo_key ?? null : remote.photo_path;
  const photoDirty = keepLocalPhoto ? 1 : 0;
  const stampCreated = local?.created_at ?? remote.created_at;

  await db.execute(
    `INSERT INTO mice (
      id, colony_id, name, sex, birthdate, strain, genotype, cage, ear_mark, experiment,
      notes, photo_path, color, baseline_weight_g, restriction_start, status,
      created_at, updated_at, deleted_at, dirty, photo_key, photo_dirty
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,0,$20,$21
    )
    ON CONFLICT(id) DO UPDATE SET
      colony_id = excluded.colony_id,
      name = excluded.name,
      sex = excluded.sex,
      birthdate = excluded.birthdate,
      strain = excluded.strain,
      genotype = excluded.genotype,
      cage = excluded.cage,
      ear_mark = excluded.ear_mark,
      experiment = excluded.experiment,
      notes = excluded.notes,
      photo_path = excluded.photo_path,
      color = excluded.color,
      baseline_weight_g = excluded.baseline_weight_g,
      restriction_start = excluded.restriction_start,
      status = excluded.status,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at,
      dirty = 0,
      photo_key = excluded.photo_key,
      photo_dirty = excluded.photo_dirty`,
    [
      remote.id,
      remote.colony_id,
      remote.name,
      remote.sex,
      remote.birthdate,
      remote.strain,
      remote.genotype,
      remote.cage,
      remote.ear_mark,
      remote.experiment,
      remote.notes,
      photoPath,
      remote.color,
      remote.baseline_weight_g,
      remote.restriction_start,
      remote.status,
      stampCreated,
      remote.updated_at,
      remote.deleted_at,
      photoKey,
      photoDirty,
    ],
  );

  const needsPhoto = Boolean(
    !keepLocalPhoto &&
      remote.photo_path &&
      !remote.deleted_at &&
      (local?.photo_key !== remote.photo_path || !local?.photo_path),
  );
  return { changed: true, needsPhoto };
}

export async function mergeRemoteWeight(remote: RemoteWeight, force: boolean): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<SyncWeight[]>(
    "SELECT * FROM weights WHERE id = $1 OR (mouse_id = $2 AND date = $3)",
    [remote.id, remote.mouse_id, remote.date],
  );
  const byId = rows.find((row) => row.id === remote.id);
  const otherLive = rows.find((row) => row.id !== remote.id && !row.deleted_at);

  if (
    byId &&
    !otherLive &&
    !Number(byId.dirty) &&
    byId.weight_g === remote.weight_g &&
    (byId.note ?? null) === (remote.note ?? null) &&
    byId.date === remote.date &&
    sameInstant(byId.updated_at, remote.updated_at) &&
    sameInstant(byId.deleted_at, remote.deleted_at)
  ) {
    return false;
  }

  if (byId && !remoteWins(byId, force, remote.updated_at)) return false;

  if (!byId && otherLive && !remote.deleted_at && !remoteWins(otherLive, force, remote.updated_at)) {
    await db.execute(
      `INSERT INTO weights (id, mouse_id, date, weight_g, note, created_at, updated_at, deleted_at, dirty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,1)
       ON CONFLICT(id) DO UPDATE SET
         deleted_at = excluded.deleted_at, updated_at = excluded.updated_at, dirty = 1`,
      [
        remote.id,
        remote.mouse_id,
        remote.date,
        remote.weight_g,
        remote.note,
        remote.created_at,
        remote.updated_at,
      ],
    );
    return true;
  }

  if (otherLive && (force || remoteWins(otherLive, force, remote.updated_at))) {
    await db.execute(
      `UPDATE weights SET deleted_at = $1, updated_at = $1, dirty = $2 WHERE id = $3`,
      [remote.updated_at, force ? 0 : 1, otherLive.id],
    );
  }

  await db.execute(
    `INSERT INTO weights (id, mouse_id, date, weight_g, note, created_at, updated_at, deleted_at, dirty)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0)
     ON CONFLICT(id) DO UPDATE SET
       mouse_id = excluded.mouse_id,
       date = excluded.date,
       weight_g = excluded.weight_g,
       note = excluded.note,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at,
       dirty = 0`,
    [
      remote.id,
      remote.mouse_id,
      remote.date,
      remote.weight_g,
      remote.note,
      byId?.created_at ?? remote.created_at,
      remote.updated_at,
      remote.deleted_at,
    ],
  );
  return true;
}

export async function mergeRemoteSetting(remote: RemoteSetting, force: boolean): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<SyncSetting[]>(
    "SELECT * FROM settings WHERE colony_id = $1 AND key = $2",
    [remote.colony_id, remote.key],
  );
  const local = rows[0];
  if (
    local &&
    !Number(local.dirty) &&
    local.value === remote.value &&
    sameInstant(local.updated_at, remote.updated_at)
  ) {
    return false;
  }
  if (!remoteWins(local, force, remote.updated_at)) return false;
  await db.execute(
    `INSERT INTO settings (colony_id, key, value, updated_at, dirty)
     VALUES ($1, $2, $3, $4, 0)
     ON CONFLICT(colony_id, key) DO UPDATE SET
       value = excluded.value, updated_at = excluded.updated_at, dirty = 0`,
    [remote.colony_id, remote.key, remote.value, remote.updated_at],
  );
  return true;
}

export async function seedDemoColony(): Promise<void> {
  const existing = await listMice();
  if (existing.length > 0) return;

  const start = addDays(todayISO(), -16);
  const demo: Array<{
    draft: MouseDraft;
    startG: number;
    drift: number;
    noise: number;
  }> = [
    {
      draft: {
        name: "Pip",
        sex: "F",
        birthdate: "2025-12-02",
        strain: "C57BL/6J",
        genotype: "WT",
        cage: "A3",
        ear_mark: "L",
        experiment: "Joystick push",
        notes: "Steady drinker. Baseline taken at restriction start.",
        photo_path: null,
        color: "",
        baseline_weight_g: "22.4",
        restriction_start: start,
        status: "active",
      },
      startG: 22.4,
      drift: -0.035,
      noise: 0.18,
    },
    {
      draft: {
        name: "Nib",
        sex: "M",
        birthdate: "2025-11-18",
        strain: "C57BL/6J",
        genotype: "WT",
        cage: "A3",
        ear_mark: "R",
        experiment: "Joystick push",
        notes: "",
        photo_path: null,
        color: "",
        baseline_weight_g: "26.1",
        restriction_start: start,
        status: "active",
      },
      startG: 26.1,
      drift: -0.05,
      noise: 0.22,
    },
    {
      draft: {
        name: "Clover",
        sex: "F",
        birthdate: "2025-10-09",
        strain: "C57BL/6J",
        genotype: "Emx1-GCaMP8",
        cage: "B1",
        ear_mark: "2",
        experiment: "Joystick push",
        notes: "Moved to inactive after imaging window.",
        photo_path: null,
        color: "",
        baseline_weight_g: "23.8",
        restriction_start: start,
        status: "inactive",
      },
      startG: 23.8,
      drift: -0.02,
      noise: 0.15,
    },
  ];

  for (const item of demo) {
    const id = await upsertMouse(null, item.draft);
    for (let i = 0; i <= 16; i += 1) {
      if (item.draft.status === "inactive" && i > 10) continue;
      const date = addDays(start, i);
      const wobble = Math.sin(i * 1.7 + item.startG) * item.noise;
      const grams = Math.round((item.startG + item.drift * i + wobble) * 10) / 10;
      await upsertWeight(id, date, grams);
    }
  }
}

export function draftFromMouse(mouse?: Mouse | null): MouseDraft {
  return {
    name: mouse?.name ?? "",
    sex: mouse?.sex ?? "U",
    birthdate: mouse?.birthdate ?? "",
    strain: mouse?.strain ?? "",
    genotype: mouse?.genotype ?? "",
    cage: mouse?.cage ?? "",
    ear_mark: mouse?.ear_mark ?? "",
    experiment: mouse?.experiment ?? "",
    notes: mouse?.notes ?? "",
    photo_path: mouse?.photo_path ?? null,
    color: mouse?.color ?? "",
    baseline_weight_g: mouse?.baseline_weight_g == null ? "" : String(mouse.baseline_weight_g),
    restriction_start: mouse?.restriction_start ?? "",
    status: mouse?.status ?? "active",
  };
}
