export const PALETTE = [
  "#e8b86d",
  "#7eb8a8",
  "#d07a6b",
  "#8aa2d4",
  "#c4a0d8",
  "#9cbf6b",
  "#e09a6a",
  "#6db3c8",
  "#d4c46a",
  "#b88a7a",
  "#a3c4bc",
  "#e6c2b3",
  "#f07167",
  "#5c9ead",
  "#c08497",
  "#7d8f69",
  "#6b8cae",
  "#4aa3a2",
  "#d4a5c9",
  "#c97b63",
];

const CONFLICT_DELTA_E = 20;

export function normalizeHex(color?: string | null): string | null {
  if (!color) return null;
  const value = color.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(value);
  if (short) {
    const [r, g, b] = short[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const full = /^#([0-9a-f]{6})$/i.exec(value);
  return full ? value.toLowerCase() : null;
}

export function fallbackMouseColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export function mouseColor(id: string, color?: string | null): string {
  return normalizeHex(color) ?? fallbackMouseColor(id);
}

export function usedColors(
  mice: Array<{ id: string; color?: string | null }>,
  exceptId?: string | null,
): string[] {
  return mice
    .filter((mouse) => mouse.id !== exceptId)
    .map((mouse) => mouseColor(mouse.id, mouse.color));
}

export function colorsConflict(a: string, b: string): boolean {
  const left = normalizeHex(a);
  const right = normalizeHex(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return deltaE(left, right) < CONFLICT_DELTA_E;
}

export function nextUnusedColor(taken: string[]): string {
  const claimed = taken.map((c) => normalizeHex(c)).filter((c): c is string => Boolean(c));
  for (const swatch of PALETTE) {
    if (!claimed.some((color) => colorsConflict(color, swatch))) return swatch;
  }
  for (let i = 0; i < 360; i += 1) {
    const hex = hslToHex((i * 137.508) % 360, 52, 62);
    if (!claimed.some((color) => colorsConflict(color, hex))) return hex;
  }
  return `#${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0")}`;
}

export function suggestColors(taken: string[], keep?: string | null): string[] {
  const keepNorm = normalizeHex(keep);
  const claimed = taken.map((c) => normalizeHex(c)).filter((c): c is string => Boolean(c));
  const out: string[] = [];
  if (keepNorm) out.push(keepNorm);
  for (const swatch of PALETTE) {
    if (out.includes(swatch)) continue;
    if (claimed.some((color) => colorsConflict(color, swatch))) continue;
    out.push(swatch);
  }
  while (out.length < 12) {
    const extra = nextUnusedColor([...claimed, ...out]);
    if (out.includes(extra)) break;
    out.push(extra);
  }
  return out;
}

export function applyUniqueColorAssignment(
  mice: Array<{ id: string; color?: string | null }>,
  ownerId: string,
  requested: string,
): { id: string; color: string }[] {
  const wanted = normalizeHex(requested) ?? nextUnusedColor(usedColors(mice, ownerId));
  const taken = new Set<string>([wanted]);
  const updates: { id: string; color: string }[] = [{ id: ownerId, color: wanted }];

  for (const mouse of mice) {
    if (mouse.id === ownerId) continue;
    const current = normalizeHex(mouseColor(mouse.id, mouse.color));
    if (current && current !== wanted) taken.add(current);
  }

  for (const mouse of mice) {
    if (mouse.id === ownerId) continue;
    const current = normalizeHex(mouseColor(mouse.id, mouse.color));
    if (current !== wanted) continue;
    const replacement = nextUnusedColor([...taken]);
    updates.push({ id: mouse.id, color: replacement });
    taken.add(replacement);
  }

  return updates;
}

export function planUniqueColors(
  mice: Array<{ id: string; color?: string | null }>,
): { id: string; color: string }[] {
  const taken = new Set<string>();
  const updates: { id: string; color: string }[] = [];

  for (const mouse of mice) {
    const stored = normalizeHex(mouse.color);
    if (stored && !taken.has(stored)) {
      taken.add(stored);
      continue;
    }
    const next = nextUnusedColor([...taken]);
    updates.push({ id: mouse.id, color: next });
    taken.add(next);
  }

  return updates;
}

export function percentTone(
  percent: number | null,
  minimum = 80,
): "ok" | "warn" | "bad" | "muted" {
  if (percent == null) return "muted";
  if (percent < minimum) return "bad";
  if (percent < minimum + 5) return "warn";
  return "ok";
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = light - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToLab(hex: string): [number, number, number] {
  const toLinear = (value: number) => {
    const channel = value / 255;
    return channel > 0.04045 ? ((channel + 0.055) / 1.055) ** 2.4 : channel / 12.92;
  };
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = hexToLab(a);
  const [l2, a2, b2] = hexToLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
