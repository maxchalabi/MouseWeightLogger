import { useEffect, useRef, useState } from "react";
import { normalizeHex } from "../lib/colors";

type Props = {
  value: string;
  suggestions: string[];
  onChange: (color: string) => void;
  compact?: boolean;
};

export function ColorPicker({ value, suggestions, onChange, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const current = normalizeHex(value) ?? value;

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const swatches = (
    <div className="flex flex-wrap items-center gap-2">
      {suggestions.map((swatch) => (
        <button
          key={swatch}
          type="button"
          onClick={() => {
            onChange(swatch);
            if (compact) setOpen(false);
          }}
          className={`h-7 w-7 rounded-full border ${
            current === swatch.toLowerCase()
              ? "border-ink ring-2 ring-ink/40"
              : "border-white/10"
          }`}
          style={{ background: swatch }}
          aria-label={`Color ${swatch}`}
        />
      ))}
      <input
        type="color"
        value={/^#([0-9a-f]{6})$/i.test(current) ? current : "#e8b86d"}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-8 cursor-pointer rounded border border-line bg-transparent p-0"
        aria-label="Custom color"
      />
    </div>
  );

  if (!compact) return swatches;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ top: rect.bottom + 8, left: rect.left });
          setOpen((prev) => !prev);
        }}
        className="h-5 w-5 rounded-full border border-white/25 shadow-sm"
        style={{ background: current }}
        aria-label="Change color"
        title="Change color"
      />
      {open && (
        <div
          className="fixed z-50 w-52 rounded-xl border border-line bg-panel p-3 shadow-xl"
          style={{ top: menu.top, left: menu.left }}
        >
          {swatches}
        </div>
      )}
    </div>
  );
}
