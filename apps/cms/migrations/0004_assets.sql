CREATE TABLE IF NOT EXISTS assets (
  path TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  lqip TEXT,
  principal TEXT NOT NULL,
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_created ON assets (created DESC);
