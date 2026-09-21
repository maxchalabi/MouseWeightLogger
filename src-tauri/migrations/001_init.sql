CREATE TABLE IF NOT EXISTS mice (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sex TEXT NOT NULL CHECK (sex IN ('M', 'F', 'U')),
  birthdate TEXT,
  strain TEXT,
  genotype TEXT,
  cage TEXT,
  ear_mark TEXT,
  experiment TEXT,
  notes TEXT,
  photo_path TEXT,
  baseline_weight_g REAL,
  restriction_start TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weights (
  id TEXT PRIMARY KEY,
  mouse_id TEXT NOT NULL REFERENCES mice(id),
  date TEXT NOT NULL,
  weight_g REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (mouse_id, date)
);

CREATE INDEX IF NOT EXISTS idx_weights_mouse_date ON weights (mouse_id, date);
CREATE INDEX IF NOT EXISTS idx_mice_status_name ON mice (status, name);
