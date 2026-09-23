import { useEffect, useMemo, useRef, useState } from "react";
import { percentTone } from "../lib/colors";
import { sexGlyph, sexLabel } from "../lib/sex";
import { ageLabel, formatPrettyDate, formatShortDate, todayISO } from "../lib/dates";
import { useActiveColony } from "../lib/colony-context";
import { deleteWeight, getBaselinePercent, listWeighRows, seedDemoColony, upsertWeight } from "../lib/db";
import type { WeighRow } from "../lib/types";
import { MouseAvatar } from "./MouseAvatar";

type Props = {
  onOpenColony: () => void;
};

function pctOfBaseline(weight: number | null, baseline: number | null): number | null {
  if (weight == null || baseline == null || baseline <= 0) return null;
  return (weight / baseline) * 100;
}

export function Today({ onOpenColony }: Props) {
  const [date, setDate] = useState(todayISO);
  const [rows, setRows] = useState<WeighRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [baselinePct, setBaselinePct] = useState(80);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const { active, revision, canEdit } = useActiveColony();

  async function refresh(nextDate = date) {
    setLoading(true);
    try {
      const next = await listWeighRows(nextDate);
      setRows(next);
      setDrafts((prev) =>
        Object.fromEntries(
          next.map((row) => {
            const field = inputRefs.current[row.id];
            if (field && document.activeElement === field) return [row.id, prev[row.id] ?? ""];
            return [row.id, row.today_weight == null ? "" : String(row.today_weight)];
          }),
        ),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(date);
    void getBaselinePercent().then(setBaselinePct);
  }, [date, active.id, revision]);

  const weighed = rows.filter((row) => row.today_weight != null).length;

  const firstEmptyId = useMemo(
    () => rows.find((row) => row.today_weight == null)?.id ?? rows[0]?.id ?? null,
    [rows],
  );

  useEffect(() => {
    if (!canEdit || !firstEmptyId || loading) return;
    inputRefs.current[firstEmptyId]?.focus();
  }, [canEdit, firstEmptyId, loading, date]);

  function focusNext(fromId: string) {
    const index = rows.findIndex((row) => row.id === fromId);
    const next =
      rows.slice(index + 1).find((row) => row.today_weight == null) ??
      rows[index + 1] ??
      rows[0];
    if (next) inputRefs.current[next.id]?.focus();
  }

  async function commit(row: WeighRow, raw: string, moveNext: boolean) {
    if (!canEdit) return;
    const trimmed = raw.trim();
    if (!trimmed) {
      if (row.today_weight != null) {
        setBusyId(row.id);
        try {
          await deleteWeight(row.id, date);
          await refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusyId(null);
        }
      }
      if (moveNext) focusNext(row.id);
      return;
    }

    const value = Number(trimmed);
    if (!Number.isFinite(value) || value <= 0 || value > 80) {
      setError("Weight should be a number of grams (for example 22.4).");
      return;
    }

    if (row.today_weight === value) {
      if (moveNext) focusNext(row.id);
      return;
    }

    setBusyId(row.id);
    try {
      await upsertWeight(row.id, date, Math.round(value * 10) / 10);
      await refresh();
      if (moveNext) {
        requestAnimationFrame(() => focusNext(row.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function loadSample() {
    setLoading(true);
    try {
      await seedDemoColony();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted">Weigh-in</p>
          <h1 className="font-serif text-4xl font-medium tracking-tight">{formatPrettyDate(date)}</h1>
          <p className="mt-2 text-sm text-muted">
            {rows.length === 0
              ? "No active mice yet."
              : `${weighed} of ${rows.length} weighed`}
            {!canEdit && rows.length > 0 ? " · view only" : ""}
          </p>
        </div>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink"
          />
        </label>
      </header>

      {error && (
        <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      {rows.length === 0 && !loading ? (
        <div className="rounded-2xl border border-dashed border-line bg-panel px-8 py-14 text-center">
          <p className="font-serif text-2xl">The colony is empty</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            {canEdit
              ? "Add an active mouse to start today’s weigh-in, or load a small sample colony to try the curves."
              : "This shared colony has no active mice to show."}
          </p>
          {canEdit && (
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={onOpenColony}
                className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg"
              >
                Add a mouse
              </button>
              <button
                type="button"
                onClick={() => void loadSample()}
                className="rounded-full border border-line px-4 py-2 text-sm text-ink"
              >
                Load sample colony
              </button>
            </div>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const current = Number(drafts[row.id]);
            const shown =
              drafts[row.id]?.trim() && Number.isFinite(current) ? current : row.today_weight;
            const pct = pctOfBaseline(shown, row.baseline_weight_g);
            const tone = percentTone(pct, baselinePct);
            const delta =
              shown != null && row.prev_weight != null
                ? Math.round((shown - row.prev_weight) * 10) / 10
                : null;
            return (
              <li
                key={row.id}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-2xl border border-line bg-panel px-4 py-3 md:px-5"
              >
                <MouseAvatar
                  name={row.name}
                  id={row.id}
                  color={row.color}
                  photoPath={row.photo_path}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 className="truncate font-serif text-2xl">{row.name}</h2>
                    <span className="text-xs uppercase tracking-wider text-muted">
                      <span aria-label={sexLabel(row.sex)}>{sexGlyph(row.sex)}</span>
                      {ageLabel(row.birthdate, date) ? ` · ${ageLabel(row.birthdate, date)}` : ""}
                      {row.cage ? ` · cage ${row.cage}` : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {row.prev_weight != null ? (
                      <>
                        Last {formatShortDate(row.prev_date ?? date)}: {row.prev_weight.toFixed(1)} g
                        {delta != null && (
                          <span className="ml-2 text-ink/80">
                            {delta > 0 ? "+" : ""}
                            {delta.toFixed(1)} g
                          </span>
                        )}
                      </>
                    ) : (
                      "No previous weight"
                    )}
                    {pct != null && (
                      <span
                        className={`ml-3 ${
                          tone === "ok"
                            ? "text-ok"
                            : tone === "warn"
                              ? "text-warn"
                              : tone === "bad"
                                ? "text-bad"
                                : ""
                        }`}
                      >
                        {pct.toFixed(0)}% of baseline
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={(el) => {
                      inputRefs.current[row.id] = el;
                    }}
                    inputMode="decimal"
                    className="weight-input w-28 rounded-xl border border-line bg-bg px-3 py-3 text-right font-serif text-2xl text-ink"
                    placeholder="g"
                    value={drafts[row.id] ?? ""}
                    readOnly={!canEdit}
                    disabled={busyId === row.id}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))
                    }
                    onBlur={(e) => void commit(row, e.target.value, false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commit(row, drafts[row.id] ?? "", true);
                      }
                    }}
                    aria-label={`Weight for ${row.name}`}
                  />
                  <span className="w-4 text-sm text-muted">g</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
