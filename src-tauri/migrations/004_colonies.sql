-- Colony rows, this install's device record, and the last successful sync time.
-- Mice, weights, and settings are rewritten in the app on startup: the color
-- column was added outside the migration history, so that rebuild has to look
-- at the live table before it can scope rows to a colony.

CREATE TABLE IF NOT EXISTS colonies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'watcher')),
  shared INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  colony_id TEXT PRIMARY KEY,
  last_pulled_at TEXT
);
