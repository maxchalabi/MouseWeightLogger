import Database from "@tauri-apps/plugin-sql";
import { applyUniqueColorAssignment, nextUnusedColor, planUniqueColors, usedColors } from "./colors";
import { addDays, nowISO, todayISO } from "./dates";
import type { Mouse, MouseDraft, MouseStatus, WeighRow, Weight } from "./types";

let dbPromise: Promise<Database> | null = null;

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

async function ensureSchema(db: Database): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  try {
    await db.execute("ALTER TABLE mice ADD COLUMN color TEXT");
  } catch {
    // column already exists
  }
  await ensureUniqueMouseColors(db);
}

async function ensureUniqueMouseColors(db: Database): Promise<void> {
  try {
    const mice = await db.select<Mouse[]>(
      "SELECT * FROM mice ORDER BY created_at ASC, name COLLATE NOCASE",
    );
    const stamp = nowISO();
    for (const { id, color } of planUniqueColors(mice)) {
      await db.execute("UPDATE mice SET color = $1, updated_at = $2 WHERE id = $3", [
        color,
        stamp,
        id,
      ]);
    }
  } catch {
    // mice table may not exist yet on a brand-new install
  }
}

async function writeMouseColors(
  db: Database,
  updates: { id: string; color: string }[],
): Promise<void> {
  const stamp = nowISO();
  for (const { id, color } of updates) {
    await db.execute("UPDATE mice SET color = $1, updated_at = $2 WHERE id = $3", [
      color,
      stamp,
      id,
    ]);
  }
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

export async function listMice(status?: MouseStatus): Promise<Mouse[]> {
  const db = await getDb();
  if (status) {
    return db.select<Mouse[]>(
      "SELECT * FROM mice WHERE status = $1 ORDER BY name COLLATE NOCASE",
      [status],
    );
  }
  return db.select<Mouse[]>("SELECT * FROM mice ORDER BY status ASC, name COLLATE NOCASE");
}

export async function getMouse(id: string): Promise<Mouse | null> {
  const db = await getDb();
  const rows = await db.select<Mouse[]>("SELECT * FROM mice WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function upsertMouse(id: string | null, draft: MouseDraft): Promise<string> {
  const db = await getDb();
  const mouseId = id ?? crypto.randomUUID();
  const existing = id ? await getMouse(id) : null;
  const colony = await listMice();
  const requested =
    emptyToNull(draft.color) ?? nextUnusedColor(usedColors(colony, mouseId));
  const colorUpdates = applyUniqueColorAssignment(
    existing ? colony : [...colony, { id: mouseId, color: null }],
    mouseId,
    requested,
  );
  const assignedColor = colorUpdates.find((row) => row.id === mouseId)?.color ?? requested;
  const stamp = nowISO();
  const payload = [
    mouseId,
    draft.name.trim(),
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
  ];

  try {
    if (existing) {
      await db.execute(
        `UPDATE mice SET
          name = $2, sex = $3, birthdate = $4, strain = $5, genotype = $6,
          cage = $7, ear_mark = $8, experiment = $9, notes = $10, photo_path = $11,
          color = $12, baseline_weight_g = $13, restriction_start = $14, status = $15, updated_at = $17
         WHERE id = $1`,
        payload,
      );
    } else {
      await db.execute(
        `INSERT INTO mice (
          id, name, sex, birthdate, strain, genotype, cage, ear_mark, experiment,
          notes, photo_path, color, baseline_weight_g, restriction_start, status, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        payload,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("unique")) {
      throw new Error("A mouse with that name already exists.");
    }
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
  const colony = await listMice();
  await writeMouseColors(db, applyUniqueColorAssignment(colony, id, color));
}

export async function setMouseStatus(id: string, status: MouseStatus): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE mice SET status = $1, updated_at = $2 WHERE id = $3", [
    status,
    nowISO(),
    id,
  ]);
}

export async function setMousePhoto(id: string, photoPath: string | null): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE mice SET photo_path = $1, updated_at = $2 WHERE id = $3", [
    photoPath,
    nowISO(),
    id,
  ]);
}

export async function listWeighRows(date: string): Promise<WeighRow[]> {
  const db = await getDb();
  return db.select<WeighRow[]>(
    `SELECT m.*,
      (SELECT w.weight_g FROM weights w WHERE w.mouse_id = m.id AND w.date = $1) AS today_weight,
      (SELECT w.weight_g FROM weights w WHERE w.mouse_id = m.id AND w.date < $1 ORDER BY w.date DESC LIMIT 1) AS prev_weight,
      (SELECT w.date FROM weights w WHERE w.mouse_id = m.id AND w.date < $1 ORDER BY w.date DESC LIMIT 1) AS prev_date
     FROM mice m
     WHERE m.status = 'active'
     ORDER BY m.name COLLATE NOCASE`,
    [date],
  );
}

export async function listWeights(mouseIds?: string[]): Promise<Weight[]> {
  const db = await getDb();
  if (!mouseIds) {
    return db.select<Weight[]>("SELECT * FROM weights ORDER BY date ASC");
  }
  if (mouseIds.length === 0) return [];
  const placeholders = mouseIds.map((_, i) => `$${i + 1}`).join(", ");
  return db.select<Weight[]>(
    `SELECT * FROM weights WHERE mouse_id IN (${placeholders}) ORDER BY date ASC`,
    mouseIds,
  );
}

export async function upsertWeight(mouseId: string, date: string, weightG: number): Promise<void> {
  const db = await getDb();
  const stamp = nowISO();
  await db.execute(
    `INSERT INTO weights (id, mouse_id, date, weight_g, note, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NULL, $5, $5)
     ON CONFLICT(mouse_id, date) DO UPDATE SET
       weight_g = excluded.weight_g,
       updated_at = excluded.updated_at`,
    [crypto.randomUUID(), mouseId, date, weightG, stamp],
  );
}

export async function deleteWeight(mouseId: string, date: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM weights WHERE mouse_id = $1 AND date = $2", [mouseId, date]);
}

export async function deleteMouse(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM weights WHERE mouse_id = $1", [id]);
  await db.execute("DELETE FROM mice WHERE id = $1", [id]);
}

export async function getBaselinePercent(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = $1",
    ["baseline_percent"],
  );
  const n = Number(rows[0]?.value);
  if (Number.isFinite(n) && n > 0 && n <= 100) return n;
  return 80;
}

export async function setBaselinePercent(value: number): Promise<void> {
  const db = await getDb();
  const next = Math.min(100, Math.max(1, Math.round(value * 10) / 10));
  await db.execute(
    `INSERT INTO settings (key, value) VALUES ('baseline_percent', $1)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(next)],
  );
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
    baseline_weight_g:
      mouse?.baseline_weight_g == null ? "" : String(mouse.baseline_weight_g),
    restriction_start: mouse?.restriction_start ?? "",
    status: mouse?.status ?? "active",
  };
}
