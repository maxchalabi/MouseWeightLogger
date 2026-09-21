import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { csvEscape, todayISO } from "./dates";
import { listMice, listWeights } from "./db";

export async function exportColonyCsv(): Promise<boolean> {
  const [mice, weights] = await Promise.all([listMice(), listWeights()]);
  const header = [
    "mouse_name",
    "date",
    "weight_g",
    "weight_note",
    "sex",
    "status",
    "birthdate",
    "strain",
    "genotype",
    "cage",
    "ear_mark",
    "experiment",
    "color",
    "baseline_weight_g",
    "percent_baseline",
    "restriction_start",
    "notes",
  ];
  const lines = [header.join(",")];

  const weightsByMouse = new Map<string, typeof weights>();
  for (const w of weights) {
    const list = weightsByMouse.get(w.mouse_id) ?? [];
    list.push(w);
    weightsByMouse.set(w.mouse_id, list);
  }

  for (const mouse of mice) {
    const series = weightsByMouse.get(mouse.id) ?? [];
    if (series.length === 0) {
      lines.push(mouseRow(mouse, "", "", "", ""));
      continue;
    }
    for (const w of series) {
      const pct =
        mouse.baseline_weight_g && mouse.baseline_weight_g > 0
          ? ((w.weight_g / mouse.baseline_weight_g) * 100).toFixed(1)
          : "";
      lines.push(mouseRow(mouse, w.date, w.weight_g, w.note, pct));
    }
  }

  const path = await save({
    defaultPath: `mouse-weights-${todayISO()}.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return false;
  await invoke("write_export", { path, contents: `${lines.join("\n")}\n` });
  return true;
}

function mouseRow(
  mouse: {
    name: string;
    sex: string;
    status: string;
    birthdate: string | null;
    strain: string | null;
    genotype: string | null;
    cage: string | null;
    ear_mark: string | null;
    experiment: string | null;
    color: string | null;
    baseline_weight_g: number | null;
    restriction_start: string | null;
    notes: string | null;
  },
  date: string,
  weight: string | number,
  note: string | null,
  pct: string,
): string {
  return [
    csvEscape(mouse.name),
    csvEscape(date),
    csvEscape(weight),
    csvEscape(note),
    csvEscape(mouse.sex),
    csvEscape(mouse.status),
    csvEscape(mouse.birthdate),
    csvEscape(mouse.strain),
    csvEscape(mouse.genotype),
    csvEscape(mouse.cage),
    csvEscape(mouse.ear_mark),
    csvEscape(mouse.experiment),
    csvEscape(mouse.color),
    csvEscape(mouse.baseline_weight_g),
    csvEscape(pct),
    csvEscape(mouse.restriction_start),
    csvEscape(mouse.notes),
  ].join(",");
}
