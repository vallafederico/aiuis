-- documents: primary content index
CREATE TABLE IF NOT EXISTS documents (
  id         TEXT NOT NULL PRIMARY KEY,
  collection TEXT NOT NULL,
  slug       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft',
  head_rev   TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  card       TEXT NOT NULL DEFAULT '{}',
  created    TEXT NOT NULL,
  updated    TEXT NOT NULL,
  UNIQUE(collection, slug)
);
CREATE INDEX IF NOT EXISTS idx_documents_coll_status ON documents(collection, status);
CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated DESC);

-- revisions: immutable revision log
CREATE TABLE IF NOT EXISTS revisions (
  rev         TEXT NOT NULL PRIMARY KEY,
  doc_id      TEXT NOT NULL,
  at          TEXT NOT NULL,
  author_kind TEXT NOT NULL,
  principal   TEXT NOT NULL,
  session     TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  diff_stat   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_revisions_doc_at ON revisions(doc_id, at DESC);

-- ref_edges: reference invalidation graph
CREATE TABLE IF NOT EXISTS ref_edges (
  from_doc TEXT NOT NULL,
  to_doc   TEXT NOT NULL,
  field    TEXT NOT NULL,
  PRIMARY KEY (from_doc, to_doc, field)
);
CREATE INDEX IF NOT EXISTS idx_ref_edges_to_doc ON ref_edges(to_doc);

-- slice_index: page slice positions
CREATE TABLE IF NOT EXISTS slice_index (
  doc_id   TEXT NOT NULL,
  slice_id TEXT NOT NULL,
  type     TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_id, slice_id)
);
CREATE INDEX IF NOT EXISTS idx_slice_index_type ON slice_index(type);

-- terms: taxonomy controlled vocabulary
CREATE TABLE IF NOT EXISTS terms (
  taxonomy    TEXT NOT NULL,
  slug        TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active',
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (taxonomy, slug)
);

-- doc_terms: document–term join
CREATE TABLE IF NOT EXISTS doc_terms (
  doc_id    TEXT NOT NULL,
  taxonomy  TEXT NOT NULL,
  term_slug TEXT NOT NULL,
  PRIMARY KEY (doc_id, taxonomy, term_slug)
);
CREATE INDEX IF NOT EXISTS idx_doc_terms_taxonomy_slug ON doc_terms(taxonomy, term_slug);

-- tokens: bearer token registry (stores SHA-256 hex of the raw bearer)
CREATE TABLE IF NOT EXISTS tokens (
  token_hash   TEXT NOT NULL PRIMARY KEY,
  principal    TEXT NOT NULL,
  kind         TEXT NOT NULL,
  audience     TEXT NOT NULL DEFAULT '[]',
  capabilities TEXT NOT NULL DEFAULT '{}',
  created      TEXT NOT NULL,
  expires      TEXT
);

-- op_log: thesis instrumentation — every mutating MCP call
CREATE TABLE IF NOT EXISTS op_log (
  at          TEXT NOT NULL,
  session     TEXT NOT NULL DEFAULT '',
  tool        TEXT NOT NULL,
  doc_id      TEXT NOT NULL DEFAULT '',
  outcome     TEXT NOT NULL,
  error_class TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_op_log_session_at ON op_log(session, at);
CREATE INDEX IF NOT EXISTS idx_op_log_tool_outcome ON op_log(tool, outcome);

-- documents_fts: standalone FTS5 (no content=, no triggers; write path maintains it explicitly)
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  id UNINDEXED,
  title,
  body_text,
  tokenize='porter unicode61'
);
