import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { nextUnusedColor, suggestColors, usedColors } from "../lib/colors";
import { deleteMouse, draftFromMouse, setMousePhoto, upsertMouse } from "../lib/db";
import { pickAndImportPhoto } from "../lib/photos";
import type { Mouse, MouseDraft, Sex } from "../lib/types";
import { ColorPicker } from "./ColorPicker";
import { MouseAvatar } from "./MouseAvatar";

type Props = {
  mouse: Mouse | null;
  mice?: Mouse[];
  cohorts?: string[];
  onClose: () => void;
  onSaved: (id: string) => void;
  onDeleted?: (id: string) => void;
};

const SEXES: Sex[] = ["F", "M", "U"];

export function MouseForm({ mouse, mice = [], cohorts = [], onClose, onSaved, onDeleted }: Props) {
  const [reservedId] = useState(() => mouse?.id ?? crypto.randomUUID());
  const taken = usedColors(mice, mouse?.id ?? reservedId);
  const [draft, setDraft] = useState<MouseDraft>(() => {
    const next = draftFromMouse(mouse);
    if (!next.color) next.color = nextUnusedColor(taken);
    return next;
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const previewId = reservedId;
  const colorChoices = suggestColors(taken, draft.color);

  useEffect(() => {
    const next = draftFromMouse(mouse);
    if (!next.color) next.color = nextUnusedColor(usedColors(mice, reservedId));
    setDraft(next);
    setError(null);
  }, [mouse, mice, reservedId]);

  function set<K extends keyof MouseDraft>(key: K, value: MouseDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function choosePhoto() {
    try {
      const path = await pickAndImportPhoto(reservedId);
      if (!path) return;
      set("photo_path", path);
      if (mouse) await setMousePhoto(mouse.id, path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    try {
      const id = await upsertMouse(reservedId, draft);
      onSaved(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!mouse) return;
    const ok = window.confirm(
      `Delete ${mouse.name} and all of their weights? This cannot be undone.`,
    );
    if (!ok) return;
    setSaving(true);
    try {
      await deleteMouse(mouse.id);
      onDeleted?.(mouse.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-[2px]">
      <button className="h-full flex-1 cursor-default" onClick={onClose} aria-label="Close" />
      <form
        onSubmit={(e) => void onSubmit(e)}
        className="flex h-full w-full max-w-md flex-col border-l border-line bg-panel shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">
              {mouse ? "Edit" : "New mouse"}
            </p>
            <h2 className="font-serif text-3xl">{mouse?.name ?? "Add to colony"}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-muted hover:text-ink">
            Close
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="flex items-center gap-4">
            <MouseAvatar
              name={draft.name || "?"}
              id={previewId}
              color={draft.color}
              photoPath={draft.photo_path}
              size="lg"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void choosePhoto()}
                className="rounded-full border border-line px-3 py-1.5 text-sm"
              >
                {draft.photo_path ? "Change photo" : "Add photo"}
              </button>
              {draft.photo_path && (
                <button
                  type="button"
                  onClick={() => set("photo_path", null)}
                  className="text-sm text-muted"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

          <Field label="Name">
            <input
              required
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              className="field"
              placeholder="Pip"
            />
          </Field>

          <Field label="Plot color">
            <ColorPicker
              value={draft.color}
              suggestions={colorChoices}
              onChange={(color) => set("color", color)}
            />
          </Field>

          <div className="grid grid-cols-3 gap-2">
            {SEXES.map((sex) => (
              <button
                key={sex}
                type="button"
                onClick={() => set("sex", sex)}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  draft.sex === sex
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-line text-muted"
                }`}
              >
                {sex === "F" ? "Female" : sex === "M" ? "Male" : "Unknown"}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Birthdate">
              <input
                type="date"
                value={draft.birthdate}
                onChange={(e) => set("birthdate", e.target.value)}
                className="field"
              />
            </Field>
            <Field label="Cage">
              <input
                value={draft.cage}
                onChange={(e) => set("cage", e.target.value)}
                className="field"
                placeholder="A3"
              />
            </Field>
            <Field label="Strain">
              <input
                value={draft.strain}
                onChange={(e) => set("strain", e.target.value)}
                className="field"
                placeholder="C57BL/6J"
              />
            </Field>
            <Field label="Genotype">
              <input
                value={draft.genotype}
                onChange={(e) => set("genotype", e.target.value)}
                className="field"
              />
            </Field>
            <Field label="Ear mark / ID">
              <input
                value={draft.ear_mark}
                onChange={(e) => set("ear_mark", e.target.value)}
                className="field"
              />
            </Field>
            <Field label="Experiment / cohort">
              <input
                value={draft.experiment}
                onChange={(e) => set("experiment", e.target.value)}
                className="field"
                list="existing-cohorts"
                autoComplete="off"
              />
              <datalist id="existing-cohorts">
                {cohorts.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </Field>
            <Field label="Baseline weight (g)">
              <input
                inputMode="decimal"
                value={draft.baseline_weight_g}
                onChange={(e) => set("baseline_weight_g", e.target.value)}
                className="field"
                placeholder="22.4"
              />
            </Field>
            <Field label="Restriction start">
              <input
                type="date"
                value={draft.restriction_start}
                onChange={(e) => set("restriction_start", e.target.value)}
                className="field"
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
              className="field min-h-24 resize-y"
              placeholder="Implant, training notes, anything useful…"
            />
          </Field>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
          {mouse ? (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={saving}
              className="text-sm text-bad hover:underline disabled:opacity-60"
            >
              Delete mouse
            </button>
          ) : (
            <span className="text-xs text-muted">You can edit or delete them later from Mice.</span>
          )}
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-60"
          >
            {saving ? "Saving…" : mouse ? "Save changes" : "Add mouse"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {children}
    </label>
  );
}
