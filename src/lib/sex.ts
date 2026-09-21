import type { Sex } from "./types";

export function sexGlyph(sex: Sex): string {
  if (sex === "F") return "♀";
  if (sex === "M") return "♂";
  return "·";
}

export function sexLabel(sex: Sex): string {
  if (sex === "F") return "Female";
  if (sex === "M") return "Male";
  return "Unknown sex";
}
