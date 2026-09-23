export type Sex = "M" | "F" | "U";
export type MouseStatus = "active" | "inactive";
export type ColonyRole = "owner" | "watcher";

export type Colony = {
  id: string;
  name: string;
  role: ColonyRole;
  shared: boolean;
  created_at: string;
  updated_at: string;
};

export type ColonyMember = {
  colony_id: string;
  user_id: string;
  role: ColonyRole;
  device_name: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Mouse = {
  id: string;
  colony_id: string;
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
  deleted_at: string | null;
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
  deleted_at: string | null;
};

export type RemoteMouse = {
  id: string;
  colony_id: string;
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
  deleted_at: string | null;
};

export type RemoteWeight = {
  id: string;
  mouse_id: string;
  date: string;
  weight_g: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type RemoteSetting = {
  colony_id: string;
  key: string;
  value: string;
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
