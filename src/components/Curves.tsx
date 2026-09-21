import Plotly from "plotly.js-dist-min";
import { useEffect, useMemo, useRef, useState } from "react";
import { cohortName, groupMiceByCohort, listCohorts } from "../lib/cohorts";
import { mouseColor, suggestColors, usedColors } from "../lib/colors";
import { addDays, plotlyDateToISO, todayISO } from "../lib/dates";
import { getBaselinePercent, listMice, listWeights, setBaselinePercent, setMouseColor } from "../lib/db";
import type { AxisRange, Mouse, Weight } from "../lib/types";
import { ColorPicker } from "./ColorPicker";

function computeDefaults(weights: Weight[]): AxisRange {
  if (weights.length === 0) {
    const today = todayISO();
    return { x0: addDays(today, -14), x1: addDays(today, 1), y0: 15, y1: 35 };
  }
  const dates = weights.map((w) => w.date).sort();
  const grams = weights.map((w) => w.weight_g);
  const minW = Math.min(...grams);
  const maxW = Math.max(...grams);
  const pad = Math.max((maxW - minW) * 0.08, 0.5);
  return {
    x0: addDays(dates[0], -1),
    x1: addDays(dates[dates.length - 1], 1),
    y0: Math.round((minW - pad) * 10) / 10,
    y1: Math.round((maxW + pad) * 10) / 10,
  };
}

const HOME_ICON: Plotly.Icon = {
  width: 928.6,
  height: 1000,
  path: "m786 296v-267q0-15-11-26t-25-10h-214v214h-143v-214h-214q-15 0-25 10t-11 26v267q0 1 0 2t0 2l321 264 321-264q1-1 1-4z m124 39l-34-41q-5-5-12-6h-2q-7 0-12 3l-386 322-386-322q-7-4-13-4-7 2-12 7l-35 41q-4 5-3 13t6 12l401 334q18 15 42 15t43-15l136-114v109q0 8 5 13t13 5h107q8 0 13-5t5-13v-227l122-102q5-5 6-12t-4-13z",
  transform: "matrix(1 0 0 -1 0 850)",
};

// Plotly's official toImage camera (width/height/path/transform only — ascent/descent clips it to a dot)
const CAMERA_ICON: Plotly.Icon = {
  width: 1000,
  height: 1000,
  path: "m500 450c-83 0-150-67-150-150 0-83 67-150 150-150 83 0 150 67 150 150 0 83-67 150-150 150z m400 150h-120c-16 0-34 13-39 29l-31 93c-6 15-23 28-40 28h-340c-16 0-34-13-39-28l-31-94c-6-15-23-28-40-28h-120c-55 0-100-45-100-100v-450c0-55 45-100 100-100h800c55 0 100 45 100 100v450c0 55-45 100-100 100z m-400-550c-138 0-250 112-250 250 0 138 112 250 250 250 138 0 250-112 250-250 0-138-112-250-250-250z m365 380c-19 0-35 16-35 35 0 19 16 35 35 35 19 0 35-16 35-35 0-19-16-35-35-35z",
  transform: "matrix(1 0 0 -1 0 850)",
};

async function downloadPngWithLegend(gd: Plotly.PlotlyHTMLElement) {
  await Plotly.relayout(gd, {
    showlegend: true,
    legend: {
      orientation: "h",
      y: 1.12,
      bgcolor: "rgba(18,16,14,0.92)",
      bordercolor: "#2f2a24",
      font: { color: "#f4eee6", size: 12 },
    },
    margin: { t: 72, l: 56, r: 18, b: 48 },
  });
  const width = Math.max(gd.clientWidth || 1200, 1000);
  const height = Math.max(gd.clientHeight || 700, 600);
  await Plotly.downloadImage(gd, {
    format: "png",
    filename: "mouse-weights",
    width,
    height,
  });
  await Plotly.relayout(gd, {
    showlegend: false,
    margin: { t: 18, l: 56, r: 18, b: 48 },
  });
}

export function Curves() {
  const [mice, setMice] = useState<Mouse[]>([]);
  const [weights, setWeights] = useState<Weight[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<AxisRange | null>(null);
  const [showBaseline, setShowBaseline] = useState(true);
  const [baselinePct, setBaselinePct] = useState(80);
  const [error, setError] = useState<string | null>(null);
  const [cohortMenu, setCohortMenu] = useState(false);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const defaultsRef = useRef<AxisRange | null>(null);
  const selectedWeightsRef = useRef<Weight[]>([]);
  const syncingFromPlot = useRef(false);
  const resetAxesRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    void (async () => {
      try {
        const [allMice, allWeights, pct] = await Promise.all([
          listMice(),
          listWeights(),
          getBaselinePercent(),
        ]);
        setMice(allMice);
        setWeights(allWeights);
        setBaselinePct(pct);
        const activeIds = new Set(allMice.filter((m) => m.status === "active").map((m) => m.id));
        setSelected(activeIds);
        setRange(computeDefaults(allWeights.filter((w) => activeIds.has(w.mouse_id))));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  const selectedMice = useMemo(
    () => mice.filter((m) => selected.has(m.id)),
    [mice, selected],
  );
  const selectedWeights = useMemo(
    () => weights.filter((w) => selected.has(w.mouse_id)),
    [weights, selected],
  );
  const defaults = useMemo(() => computeDefaults(selectedWeights), [selectedWeights]);
  defaultsRef.current = defaults;
  selectedWeightsRef.current = selectedWeights;
  const cohorts = useMemo(() => listCohorts(mice), [mice]);
  const chipGroups = useMemo(() => groupMiceByCohort(mice), [mice]);

  function applyIds(ids: Set<string>) {
    const nextWeights = weights.filter((w) => ids.has(w.mouse_id));
    syncingFromPlot.current = false;
    setSelected(ids);
    setRange(computeDefaults(nextWeights));
  }

  resetAxesRef.current = () => {
    const next = computeDefaults(selectedWeightsRef.current);
    syncingFromPlot.current = true;
    setRange(next);
    const el = plotRef.current;
    if (!el) return;
    void Plotly.relayout(el, {
      "xaxis.autorange": false,
      "yaxis.autorange": false,
      "xaxis.range": [next.x0, next.x1],
      "yaxis.range": [next.y0, next.y1],
    });
  };

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;

    const factor = baselinePct / 100;
    const traces: Plotly.Data[] = selectedMice.map((mouse) => {
      const series = selectedWeights.filter((w) => w.mouse_id === mouse.id);
      const color = mouseColor(mouse.id, mouse.color);
      const labels = series.map((w) => {
        if (!mouse.baseline_weight_g || mouse.baseline_weight_g <= 0) return "";
        return `<br>${((w.weight_g / mouse.baseline_weight_g) * 100).toFixed(0)}% of baseline`;
      });
      return {
        type: "scatter",
        mode: "lines+markers",
        name: mouse.name,
        x: series.map((w) => w.date),
        y: series.map((w) => w.weight_g),
        text: labels,
        hovertemplate:
          "<b>%{fullData.name}</b><br>%{x|%b %-d, %Y}<br>%{y:.1f} g%{text}<extra></extra>",
        line: { color, width: 2.2, shape: "spline", smoothing: 0.6 },
        marker: { color, size: 7 },
      };
    });

    const shapes: Partial<Plotly.Shape>[] = [];
    if (showBaseline) {
      for (const mouse of selectedMice) {
        if (!mouse.baseline_weight_g || mouse.baseline_weight_g <= 0) continue;
        const y = mouse.baseline_weight_g * factor;
        const color = mouseColor(mouse.id, mouse.color);
        shapes.push({
          type: "line",
          xref: "paper",
          x0: 0,
          x1: 1,
          yref: "y",
          y0: y,
          y1: y,
          line: { color, width: 1.2, dash: "dot" },
        });
      }
    }

    const layout: Partial<Plotly.Layout> = {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#cfc6bb", family: "Outfit, sans-serif", size: 13 },
      margin: { l: 56, r: 18, t: 18, b: 48 },
      hovermode: "closest",
      dragmode: "pan",
      showlegend: false,
      legend: {
        bgcolor: "rgba(18,16,14,0.92)",
        bordercolor: "#2f2a24",
        borderwidth: 1,
        font: { color: "#f4eee6", size: 12 },
        orientation: "h",
        x: 0,
        y: 1.12,
      },
      shapes,
      xaxis: {
        type: "date",
        range: [defaults.x0, defaults.x1],
        gridcolor: "#2f2a24",
        zeroline: false,
        linecolor: "#2f2a24",
        tickfont: { color: "#9c9186" },
        title: { text: "Date", font: { size: 12, color: "#9c9186" } },
        fixedrange: false,
      },
      yaxis: {
        range: [defaults.y0, defaults.y1],
        gridcolor: "#2f2a24",
        zeroline: false,
        linecolor: "#2f2a24",
        tickfont: { color: "#9c9186" },
        title: { text: "Weight (g)", font: { size: 12, color: "#9c9186" } },
        fixedrange: false,
      },
    };

    const config: Partial<Plotly.Config> = {
      displaylogo: false,
      displayModeBar: true,
      responsive: true,
      scrollZoom: true,
      doubleClick: false,
      toImageButtonOptions: {
        format: "png",
        filename: "mouse-weights",
      },
      modeBarButtons: [
        [
          {
            name: "Reset axes",
            title: "Reset axes",
            icon: HOME_ICON,
            click: () => resetAxesRef.current(),
          },
        ],
        [
          {
            name: "toImage",
            title: "Save as PNG",
            icon: CAMERA_ICON,
            click: (gd) => {
              void downloadPngWithLegend(gd);
            },
          },
        ],
      ],
    };

    type PlotDiv = HTMLDivElement & {
      on: (event: string, cb: (event?: Plotly.PlotRelayoutEvent) => void) => void;
      removeAllListeners: (event: string) => void;
    };
    const plot = el as PlotDiv;

    const applyRangeFromEvent = (event?: Plotly.PlotRelayoutEvent) => {
      if (!event) return;
      const x0 = event["xaxis.range[0]"];
      const x1 = event["xaxis.range[1]"];
      const y0 = event["yaxis.range[0]"];
      const y1 = event["yaxis.range[1]"];
      const xRange = event["xaxis.range"];
      const yRange = event["yaxis.range"];
      if (
        x0 == null &&
        x1 == null &&
        y0 == null &&
        y1 == null &&
        xRange == null &&
        yRange == null
      ) {
        return;
      }
      syncingFromPlot.current = true;
      setRange((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        if (typeof x0 === "string" || typeof x0 === "number") next.x0 = plotlyDateToISO(x0);
        if (typeof x1 === "string" || typeof x1 === "number") next.x1 = plotlyDateToISO(x1);
        if (Array.isArray(xRange) && xRange.length === 2) {
          next.x0 = plotlyDateToISO(xRange[0] as string | number);
          next.x1 = plotlyDateToISO(xRange[1] as string | number);
        }
        if (typeof y0 === "number") next.y0 = Math.round(y0 * 10) / 10;
        if (typeof y1 === "number") next.y1 = Math.round(y1 * 10) / 10;
        if (Array.isArray(yRange) && yRange.length === 2) {
          next.y0 = Math.round(Number(yRange[0]) * 10) / 10;
          next.y1 = Math.round(Number(yRange[1]) * 10) / 10;
        }
        return next;
      });
    };

    const onDoubleClick = (event: MouseEvent) => {
      if ((event.target as HTMLElement | null)?.closest(".modebar")) return;
      event.preventDefault();
      resetAxesRef.current();
    };

    void Plotly.react(el, traces, layout, config).then(() => {
      plot.removeAllListeners("plotly_relayout");
      plot.on("plotly_relayout", applyRangeFromEvent);
      el.addEventListener("dblclick", onDoubleClick);
    });

    return () => {
      plot.removeAllListeners("plotly_relayout");
      el.removeEventListener("dblclick", onDoubleClick);
    };
  }, [baselinePct, defaults, selectedMice, selectedWeights, showBaseline]);

  useEffect(() => {
    const el = plotRef.current;
    if (!el || !range) return;
    if (syncingFromPlot.current) {
      syncingFromPlot.current = false;
      return;
    }
    void Plotly.relayout(el, {
      "xaxis.range": [range.x0, range.x1],
      "yaxis.range": [range.y0, range.y1],
    });
  }, [range]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    applyIds(next);
  }

  async function changeColor(id: string, color: string) {
    try {
      await setMouseColor(id, color);
      setMice(await listMice());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function commitBaseline(raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return;
    setBaselinePct(n);
    try {
      await setBaselinePercent(n);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted">Curves</p>
          <h1 className="font-serif text-4xl font-medium tracking-tight">Weight over time</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              applyIds(new Set(mice.filter((m) => m.status === "active").map((m) => m.id)));
            }}
            className="rounded-full border border-line px-3 py-1.5 text-sm"
          >
            Active only
          </button>
          <div
            className="relative"
            onMouseEnter={() => setCohortMenu(true)}
            onMouseLeave={() => setCohortMenu(false)}
          >
            <button
              type="button"
              onClick={() => applyIds(new Set(mice.map((m) => m.id)))}
              className="rounded-full border border-line px-3 py-1.5 text-sm"
            >
              All mice
            </button>
            {cohortMenu && cohorts.length > 0 && (
              <div className="absolute right-0 z-20 mt-1 min-w-44 overflow-hidden rounded-xl border border-line bg-panel py-1 shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    applyIds(new Set(mice.map((m) => m.id)));
                    setCohortMenu(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-line/60"
                >
                  All mice
                </button>
                {cohorts.map((cohort) => (
                  <button
                    key={cohort}
                    type="button"
                    onClick={() => {
                      const ids = new Set(
                        mice.filter((m) => cohortName(m) === cohort).map((m) => m.id),
                      );
                      applyIds(ids);
                      setCohortMenu(false);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm text-muted hover:bg-line/60 hover:text-ink"
                  >
                    {cohort}
                  </button>
                ))}
              </div>
            )}
          </div>
          <label
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
              showBaseline ? "border-accent/50 text-accent" : "border-line text-muted"
            }`}
          >
            <input
              type="checkbox"
              checked={showBaseline}
              onChange={() => setShowBaseline((v) => !v)}
              className="accent-accent"
            />
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={baselinePct}
              onChange={(e) => setBaselinePct(Number(e.target.value) || 0)}
              onBlur={(e) => void commitBaseline(e.target.value)}
              className="w-12 bg-transparent text-center text-ink outline-none"
              aria-label="Minimum baseline percent"
            />
            % baseline
          </label>
        </div>
      </header>

      {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <aside className="flex max-h-48 flex-col gap-4 overflow-auto lg:max-h-none lg:w-56">
          {chipGroups.map(({ cohort, mice: cohortMice }) => (
            <div key={cohort}>
              <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted">{cohort}</p>
              <div className="flex flex-wrap gap-2 lg:flex-col">
                {cohortMice.map((mouse) => {
                  const on = selected.has(mouse.id);
                  const color = mouseColor(mouse.id, mouse.color);
                  return (
                    <div key={mouse.id} className="flex items-center gap-2">
                      <ColorPicker
                        compact
                        value={color}
                        suggestions={suggestColors(usedColors(mice, mouse.id), color)}
                        onChange={(next) => void changeColor(mouse.id, next)}
                      />
                      <button
                        type="button"
                        onClick={() => toggle(mouse.id)}
                        className={`flex min-w-0 flex-1 items-center gap-2 rounded-full border px-3 py-1.5 text-left text-sm ${
                          on ? "border-transparent text-bg" : "border-line text-muted"
                        } ${mouse.status === "inactive" && !on ? "opacity-70" : ""}`}
                        style={{ background: on ? color : "transparent" }}
                      >
                        <span className="truncate">{mouse.name}</span>
                        {mouse.status === "inactive" && (
                          <span className={on ? "opacity-80" : "text-muted"}>off</span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-line bg-panel">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 text-xs text-muted">
            <span className="uppercase tracking-wider">X · dates</span>
            <input
              type="date"
              value={range?.x0 ?? ""}
              onChange={(e) =>
                setRange((prev) => (prev ? { ...prev, x0: e.target.value } : prev))
              }
              className="rounded-md border border-line bg-bg px-2 py-1 text-ink"
            />
            <span>to</span>
            <input
              type="date"
              value={range?.x1 ?? ""}
              onChange={(e) =>
                setRange((prev) => (prev ? { ...prev, x1: e.target.value } : prev))
              }
              className="rounded-md border border-line bg-bg px-2 py-1 text-ink"
            />
            <span className="ml-3 uppercase tracking-wider">Y · grams</span>
            <input
              type="number"
              step="0.1"
              value={range?.y0 ?? ""}
              onChange={(e) =>
                setRange((prev) =>
                  prev ? { ...prev, y0: Number(e.target.value) } : prev,
                )
              }
              className="w-20 rounded-md border border-line bg-bg px-2 py-1 text-ink"
            />
            <span>to</span>
            <input
              type="number"
              step="0.1"
              value={range?.y1 ?? ""}
              onChange={(e) =>
                setRange((prev) =>
                  prev ? { ...prev, y1: Number(e.target.value) } : prev,
                )
              }
              className="w-20 rounded-md border border-line bg-bg px-2 py-1 text-ink"
            />
            <span className="ml-auto hidden text-muted sm:inline">
              Drag to pan · scroll to zoom · home or double-click resets
            </span>
          </div>
          <div ref={plotRef} className="min-h-[420px] flex-1 cursor-grab" />
        </div>
      </div>
    </section>
  );
}
