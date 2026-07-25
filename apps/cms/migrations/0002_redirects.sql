-- redirects: tracks slug renames so old URLs can redirect
CREATE TABLE IF NOT EXISTS redirects (
  from_collection TEXT NOT NULL,
  from_slug       TEXT NOT NULL,
  to_collection   TEXT NOT NULL,
  to_slug         TEXT NOT NULL,
  created         TEXT NOT NULL,
  PRIMARY KEY (from_collection, from_slug)
);
