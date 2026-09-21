import type { Mouse } from "./types";

export const UNGROUPED_COHORT = "Ungrouped";

export function cohortName(mouse: Mouse): string {
  const name = mouse.experiment?.trim();
  return name ? name : UNGROUPED_COHORT;
}

export function listCohorts(mice: Mouse[]): string[] {
  const names = new Set(mice.map(cohortName));
  return [...names].sort((a, b) => {
    if (a === UNGROUPED_COHORT) return 1;
    if (b === UNGROUPED_COHORT) return -1;
    return a.localeCompare(b);
  });
}

export function groupMiceByCohort(mice: Mouse[]): { cohort: string; mice: Mouse[] }[] {
  const buckets = new Map<string, Mouse[]>();
  for (const mouse of mice) {
    const key = cohortName(mouse);
    const list = buckets.get(key) ?? [];
    list.push(mouse);
    buckets.set(key, list);
  }
  return listCohorts(mice).map((cohort) => ({
    cohort,
    mice: (buckets.get(cohort) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
  }));
}
