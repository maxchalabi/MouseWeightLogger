import { useEffect, useMemo, useState } from "react";
import { ageLabel } from "../lib/dates";
import { exportColonyCsv } from "../lib/export";
import {
  deleteMouse,
  getBaselinePercent,
  listMice,
  seedDemoColony,
  setBaselinePercent,
  setMouseStatus,
} from "../lib/db";
import { UNGROUPED_COHORT, cohortName, groupMiceByCohort, listCohorts } from "../lib/cohorts";
import { sexGlyph, sexLabel } from "../lib/sex";
import type { Mouse } from "../lib/types";
import { MouseAvatar } from "./MouseAvatar";
import { MouseForm } from "./MouseForm";

export function Colony() {
  const [mice, setMice] = useState<Mouse[]>([]);
  const [showInactive, setShowInactive] = useState(true);
  const [editing, setEditing] = useState<Mouse | null | "new">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [baselinePct, setBaselinePct] = useState(80);
  const [cohortFilter, setCohortFilter] = useState("all");

  async function refresh() {
    setMice(await listMice());
  }

  useEffect(() => {
    void Promise.all([refresh(), getBaselinePercent().then(setBaselinePct)]).catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, []);

  const cohorts = useMemo(() => listCohorts(mice), [mice]);
  const groups = useMemo(() => {
    const visible = mice.filter((m) => {
      if (!showInactive && m.status !== "active") return false;
      if (cohortFilter !== "all" && cohortName(m) !== cohortFilter) return false;
      return true;
    });
    return groupMiceByCohort(visible);
  }, [cohortFilter, mice, showInactive]);

  async function toggleStatus(mouse: Mouse) {
    try {
      await setMouseStatus(mouse.id, mouse.status === "active" ? "inactive" : "active");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(mouse: Mouse) {
    const ok = window.confirm(
      `Delete ${mouse.name} and all of their weights? This cannot be undone.`,
    );
    if (!ok) return;
    try {
      await deleteMouse(mouse.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted">Roster</p>
          <h1 className="font-serif text-4xl font-medium tracking-tight">Mice</h1>
          <p className="mt-2 text-sm text-muted">
            {mice.filter((m) => m.status === "active").length} active · {mice.length} total
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            className="rounded-full border border-line px-3 py-1.5 text-sm text-muted"
          >
            {showInactive ? "Hide inactive" : "Show inactive"}
          </button>
          <label className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm text-muted">
            Cohort
            <select
              value={cohortFilter}
              onChange={(e) => setCohortFilter(e.target.value)}
              className="bg-transparent text-ink outline-none [&>option]:bg-panel"
            >
              <option value="all">All</option>
              {cohorts.map((cohort) => (
                <option key={cohort} value={cohort}>
                  {cohort}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm text-muted">
            Min
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={baselinePct}
              onChange={(e) => setBaselinePct(Number(e.target.value) || 0)}
              onBlur={() =>
                void setBaselinePercent(baselinePct).catch((err) => setError(String(err)))
              }
              className="w-12 bg-transparent text-center text-ink outline-none"
              aria-label="Minimum baseline percent"
            />
            %
          </label>
          <button
            type="button"
            onClick={() =>
              void exportColonyCsv()
                .then((ok) => ok && setNotice("CSV saved."))
                .catch((err) => setError(String(err)))
            }
            className="rounded-full border border-line px-3 py-1.5 text-sm"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-bg"
          >
            Add mouse
          </button>
        </div>
      </header>

      {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {notice && <p className="rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok">{notice}</p>}

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-panel px-8 py-14 text-center">
          <p className="font-serif text-2xl">No mice to show</p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg"
            >
              Add a mouse
            </button>
            {mice.length === 0 && (
              <button
                type="button"
                onClick={() =>
                  void seedDemoColony()
                    .then(refresh)
                    .catch((err) => setError(String(err)))
                }
                className="rounded-full border border-line px-4 py-2 text-sm"
              >
                Load sample colony
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(({ cohort, mice: cohortMice }) => (
            <section key={cohort}>
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="font-serif text-xl">{cohort}</h2>
                <span className="text-xs text-muted">{cohortMice.length}</span>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {cohortMice.map((mouse) => (
                  <li
                    key={mouse.id}
                    className={`rounded-2xl p-4 ${
                      mouse.status === "inactive"
                        ? "border border-dashed border-muted/40 bg-bg"
                        : "border border-line bg-panel"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <MouseAvatar
                        name={mouse.name}
                        id={mouse.id}
                        color={mouse.color}
                        photoPath={mouse.photo_path}
                        muted={mouse.status === "inactive"}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => setEditing(mouse)}
                            className="flex min-w-0 items-center gap-2 text-left"
                          >
                            <h3 className="truncate font-serif text-2xl">{mouse.name}</h3>
                            {mouse.status === "inactive" && (
                              <span className="shrink-0 rounded-full bg-muted/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                                Inactive
                              </span>
                            )}
                          </button>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setEditing(mouse)}
                              className="whitespace-nowrap text-xs text-muted hover:text-ink"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void toggleStatus(mouse)}
                              className="whitespace-nowrap text-xs text-muted hover:text-ink"
                            >
                              {mouse.status === "active" ? "Inactive" : "Reactivate"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void remove(mouse)}
                              className="whitespace-nowrap text-xs text-bad hover:text-bad/80"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        <p className="mt-1 text-xs uppercase tracking-wider text-muted">
                          <span aria-label={sexLabel(mouse.sex)}>{sexGlyph(mouse.sex)}</span>
                          {ageLabel(mouse.birthdate) ? ` · ${ageLabel(mouse.birthdate)}` : ""}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm text-muted">
                          {[mouse.strain, mouse.genotype, mouse.cage && `cage ${mouse.cage}`]
                            .filter(Boolean)
                            .join(" · ") || "No extra details yet"}
                        </p>
                        {mouse.baseline_weight_g != null && (
                          <p className="mt-1 text-xs text-accent-dim">
                            Baseline {mouse.baseline_weight_g.toFixed(1)} g
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {editing !== null && (
        <MouseForm
          mouse={editing === "new" ? null : editing}
          mice={mice}
          cohorts={cohorts.filter((c) => c !== UNGROUPED_COHORT)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
          onDeleted={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
    </section>
  );
}

