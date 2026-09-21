export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function parseISODate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function plotlyDateToISO(value: string | number): string {
  if (typeof value === "number") {
    return todayISO(new Date(value));
  }
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return todayISO(parsed);
  return String(value).slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return todayISO(date);
}

export function formatPrettyDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatShortDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ageLabel(birthdate: string | null, on = todayISO()): string | null {
  if (!birthdate) return null;
  const start = parseISODate(birthdate).getTime();
  const end = parseISODate(on).getTime();
  const days = Math.floor((end - start) / 86_400_000);
  if (days < 0) return null;
  if (days < 14) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 16) return `${weeks}w`;
  const months = Math.floor(days / 30.437);
  if (months < 24) return `${months} mo`;
  const years = (days / 365.25).toFixed(1);
  return `${years}y`;
}

export function csvEscape(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
