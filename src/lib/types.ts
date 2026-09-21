export type Sex = "M" | "F" | "U";
export type MouseStatus = "active" | "inactive";

export type Mouse = {
  id: string;
  name: string;
  sex: Sex;
  birthdate: string | null;
  strain: string | null;
  genotype: string | null;
  cage: string | null;
  ear_mark: string | null;
  experiment: string | null;
  notes: string | null;
  photo_path: string | null;
  color: string | null;
  baseline_weight_g: number | null;
  restriction_start: string | null;
  status: MouseStatus;
  created_at: string;
  updated_at: string;
};

export type MouseDraft = {
  name: string;
  sex: Sex;
  birthdate: string;
  strain: string;
  genotype: string;
  cage: string;
  ear_mark: string;
  experiment: string;
  notes: string;
  photo_path: string | null;
  color: string;
  baseline_weight_g: string;
  restriction_start: string;
  status: MouseStatus;
};

export type Weight = {
  id: string;
  mouse_id: string;
  date: string;
  weight_g: number;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type WeighRow = Mouse & {
  today_weight: number | null;
  prev_weight: number | null;
  prev_date: string | null;
};

export type AxisRange = {
  x0: string;
  x1: string;
  y0: number;
  y1: number;
};
