#!/usr/bin/env node
/**
 * Push seeds/ into the bound content.software project:
 * schema + skills via admin/seed (or MCP put_skill), then pieces via MCP
 * create_doc + publish.
 *
 * Requires `pnpm content login` and a content.software.json in this repo.
 */
import { homedir } from "node:os";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const seedsDir = join(root, "seeds");

// The hosted pieces schema uses the site's sections (preface|foundations|uis),
// seeded from schema/pieces.md. :::foreword / :::notes stay in the body;
// schema/directives/{name}.md registers them so derive emits the asides.
function hostedSection(section) {
  return section;
}

function walk(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full, base));
    else files.push({ path: full.slice(base.length + 1).replaceAll("\\", "/"), content: readFileSync(full, "utf8") });
  }
  return files;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const frontmatter = {};
  const lines = match[1].split("\n");
  const scalars = new Set(["title", "slug", "section", "order", "description", "component"]);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (key === "tags") {
      const tags = [];
      if (value.startsWith("[")) {
        const inner = value.endsWith("]") ? value.slice(1, -1) : value.slice(1);
        tags.push(...inner.split(",").map((item) => unquote(item.trim())).filter(Boolean));
      } else if (value) {
        tags.push(unquote(value));
      }
      while (i + 1 < lines.length && /^\s+-\s+\S/.test(lines[i + 1])) {
        i += 1;
        tags.push(unquote(lines[i].replace(/^\s+-\s+/, "").trim()));
      }
      frontmatter.tags = tags;
      continue;
    }
    if (!scalars.has(key)) continue;
    value = unquote(value);
    frontmatter[key] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  }
  return { frontmatter, body: match[2].replace(/^\n/, "") };
}

function loadProject() {
  const config = JSON.parse(readFileSync(join(root, "content.software.json"), "utf8"));
  const credsPath = process.env.CONTENT_CREDENTIALS ?? join(homedir(), ".config", "content-software", "credentials.json");
  const creds = JSON.parse(readFileSync(credsPath, "utf8"));
  const project = creds.projects?.[config.projectId] ?? Object.values(creds.projects ?? {}).find((p) => p.slug === config.slug);
  if (!project?.token && !project?.adminToken && !process.env.CONTENT_ADMIN_TOKEN && !process.env.CONTENT_TOKEN) {
    throw new Error("No stored token for this project. Run: pnpm content login --project aiuis");
  }
  const apiUrl = (project.apiUrl ?? config.apiUrl ?? `https://${config.slug}.content.software`).replace(/\/api$/, "").replace(/\/$/, "");
  // Prefer an admin-capable bearer for schema/taxonomy seed. Ordinary CLI project
  // tokens can write content + skills but not POST /api/v1/admin/seed.
  const token =
    process.env.CONTENT_ADMIN_TOKEN ??
    project?.adminToken ??
    process.env.CONTENT_TOKEN ??
    project?.token;
  return { project, apiUrl, token, credsPath };
}

function adminTokenMissingMessage(apiUrl) {
  return [
    "Missing CMS admin token — schema/taxonomy seed needs capabilities.admin.",
    "",
    "Ordinary `pnpm content login` project tokens are write-only (content + skills).",
    "Mint an admin bearer for this project (bootstrap-admin / panel), then either:",
    "",
    "  1. Paste it here and ask me to store it, or",
    "  2. export CONTENT_ADMIN_TOKEN=<token>",
    "  3. save it as projects.project_aiuis.adminToken in",
    "     ~/.config/content-software/credentials.json",
    "",
    `Then re-run: pnpm seed:content`,
    `Probe: POST ${apiUrl}/api/v1/admin/seed  (must not return capability_denied)`,
  ].join("\n");
}

/** True when the bearer can hit admin/seed. */
async function hasAdminCapability(apiUrl, token) {
  const res = await fetch(`${apiUrl}/api/v1/admin/seed`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ files: [], reindex: false }),
  });
  if (res.ok) return true;
  if (res.status === 403) {
    const body = await res.text();
    if (body.includes("capability_denied") || body.includes("admin capability")) return false;
  }
  // 401 / other → treat as missing usable admin token
  if (res.status === 401 || res.status === 403) return false;
  // Empty seed may 400 on some builds; anything other than capability denial counts as admin.
  return res.status !== 401 && res.status !== 403;
}

let mcpSessionId = null;
let rpcId = 0;

async function mcpRequest(apiUrl, token, method, params, opts = {}) {
  const id = opts.notification ? undefined : ++rpcId;
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`,
  });
  if (mcpSessionId) headers.set("mcp-session-id", mcpSessionId);
  const payload = { jsonrpc: "2.0", method, params };
  if (id !== undefined) payload.id = id;
  const res = await fetch(`${apiUrl}/mcp`, { method: "POST", headers, body: JSON.stringify(payload) });
  const sessionHeader = res.headers.get("mcp-session-id");
  if (sessionHeader) mcpSessionId = sessionHeader;
  if (opts.notification) {
    if (!res.ok && res.status !== 202) throw new Error(`MCP ${method} → HTTP ${res.status}: ${await res.text()}`);
    return null;
  }
  if (!res.ok) throw new Error(`MCP ${method} → HTTP ${res.status}: ${await res.text()}`);
  const text = await res.text();
  const payloads = (res.headers.get("content-type") ?? "").includes("text/event-stream")
    ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
    : [text];
  for (const chunk of payloads) {
    if (!chunk) continue;
    try {
      const parsed = JSON.parse(chunk);
      if (parsed.id === id) return parsed;
    } catch {
      continue;
    }
  }
  throw new Error(`MCP ${method}: no matching response`);
}

async function callTool(apiUrl, token, name, args) {
  const rpc = await mcpRequest(apiUrl, token, "tools/call", { name, arguments: args });
  const result = rpc.result ?? {};
  const text = result.content?.[0]?.text ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  if (result.isError === true || parsed.error) {
    const extra = parsed.details ? ` ${JSON.stringify(parsed.details)}` : "";
    throw new Error(`${name}: ${parsed.error ?? text}${parsed.code ? ` (${parsed.code})` : ""}${extra}`);
  }
  return parsed;
}

const { apiUrl, token } = loadProject();
const files = walk(seedsDir);
const revertAsides = process.argv.includes("--revert-asides");
const schemaFiles = files.filter((f) => {
  if (revertAsides) return false;
  return f.path.startsWith("schema/") || f.path.startsWith("skills/");
});
const pieceFiles = files.filter((f) => f.path.startsWith("content/pieces/") && f.path.endsWith(".md"));
const needsSchemaSeed = !revertAsides && schemaFiles.some((f) => f.path.startsWith("schema/"));

if (needsSchemaSeed && !(await hasAdminCapability(apiUrl, token))) {
  console.error(adminTokenMissingMessage(apiUrl));
  process.exit(1);
}

async function adminSeed(filesPayload, opts = {}) {
  const res = await fetch(`${apiUrl}/api/v1/admin/seed`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ files: filesPayload, ...opts }),
  });
  const body = await res.text();
  return { res, body };
}

const seedRes = schemaFiles.length === 0 ? null : await adminSeed(schemaFiles);
const seedBody = seedRes?.body ?? "";
if (seedRes?.res.ok) {
  console.log(`Seeded ${schemaFiles.length} schema/skill files`);
} else if (seedRes) {
  if (seedRes.res.status === 403 || seedRes.res.status === 401) {
    console.error(adminTokenMissingMessage(apiUrl));
    console.error(`admin/seed ${seedRes.res.status}: ${seedBody}`);
    process.exit(1);
  }
  console.warn(`admin/seed ${seedRes.res.status}: ${seedBody}`);
  for (const file of schemaFiles.filter((f) => f.path.startsWith("skills/"))) {
    const name = file.path.replace(/\.md$/, "");
    await fetch(`${apiUrl}/api/v1/skills/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path: file.path, content: file.content }),
    }).then(async (res) => {
      if (!res.ok) console.warn(`put skill ${file.path}: HTTP ${res.status} ${await res.text()}`);
      else console.log(`Wrote ${file.path}`);
    });
  }
}

await mcpRequest(apiUrl, token, "initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "aiuis-seed", version: "0.0.0" },
});
await mcpRequest(apiUrl, token, "notifications/initialized", {}, { notification: true });

let piecesFields = {};
async function refreshPiecesSchema() {
  const schema = await callTool(apiUrl, token, "get_schema", { collection: "pieces" });
  piecesFields = schema.fields ?? {};
  console.log(`pieces fields: ${Object.keys(piecesFields).join(", ") || "(none)"}`);
  return schema;
}

try {
  await refreshPiecesSchema();
} catch (error) {
  console.warn(`get_schema: ${error instanceof Error ? error.message : error}`);
}

if (!piecesFields.tags) {
  const piecesSchemaFile = files.find((f) => f.path === "schema/pieces.md");
  if (piecesSchemaFile) {
    const { res: patchRes, body: patchBody } = await adminSeed(
      [{ path: "schema/pieces.md", content: piecesSchemaFile.content }],
      { reindex: false },
    );
    if (patchRes.status === 403 || patchRes.status === 401) {
      console.error(adminTokenMissingMessage(apiUrl));
      console.error(`schema patch admin/seed ${patchRes.status}: ${patchBody.slice(0, 300)}`);
      process.exit(1);
    }
    console.warn(`schema patch admin/seed ${patchRes.status}: ${patchBody.slice(0, 300)}`);
    try {
      await refreshPiecesSchema();
    } catch (error) {
      console.warn(`get_schema after patch: ${error instanceof Error ? error.message : error}`);
    }
  }
}

function hostedFrontmatter(fm) {
  const out = {
    title: fm.title,
    slug: fm.slug,
    section: hostedSection(fm.section),
    order: fm.order,
  };
  if (piecesFields.component && fm.component) out.component = fm.component;
  if (piecesFields.tags && Array.isArray(fm.tags) && fm.tags.length > 0) {
    out.tags = fm.tags;
  }
  if (fm.description) out.description = fm.description;
  return out;
}

const TAG_LABEL = /^[A-Z0-9][A-Z0-9.-]*$/;
const TAG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function looksLikeTags(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const parts = value.split(/,\s*/).map((tag) => tag.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((tag) => TAG_LABEL.test(tag) || TAG_SLUG.test(tag));
}

async function revertHtmlAsides(slug) {
  const doc = await callTool(apiUrl, token, "read_doc", { id: `pieces/${slug}` });
  const id = doc.frontmatter?._id;
  const rev = doc.frontmatter?._rev;
  const body = typeof doc.body === "string" ? doc.body : "";
  if (!id || !rev) throw new Error(`read_doc pieces/${slug}: missing _id/_rev`);
  const edits = [...body.matchAll(/<aside class="cms-(?:notes|foreword)">\n<p>([\s\S]*?)<\/p>\n<\/aside>/g)].map(
    (match) => ({ op: "str_replace", old: match[0], new: match[1] }),
  );
  if (edits.length === 0) return false;
  const edited = await callTool(apiUrl, token, "edit_doc", {
    id,
    base_rev: rev,
    note: "Restore note text stripped by the HTML aside",
    edits,
  });
  await callTool(apiUrl, token, "publish", { id, base_rev: edited.rev });
  return true;
}

async function syncExistingFields(slug, fm) {
  if (!Array.isArray(fm.tags) || fm.tags.length === 0) return false;
  const doc = await callTool(apiUrl, token, "read_doc", { id: `pieces/${slug}` });
  const id = doc.frontmatter?._id;
  const rev = doc.frontmatter?._rev;
  if (!id || !rev) throw new Error(`read_doc pieces/${slug}: missing _id/_rev`);
  const edits = [];
  if (piecesFields.tags) {
    edits.push({ op: "set_field", field: "tags", value: fm.tags });
    const current = doc.frontmatter?.description;
    if (typeof current === "string" && looksLikeTags(current)) {
      edits.push({ op: "set_field", field: "description", value: "" });
    }
  } else {
    const current = doc.frontmatter?.description;
    if (current && !looksLikeTags(current)) {
      return false;
    }
    edits.push({ op: "set_field", field: "description", value: fm.tags.join(", ") });
  }
  if (edits.length === 0) return false;
  const edited = await callTool(apiUrl, token, "edit_doc", {
    id,
    base_rev: rev,
    note: "Set DATA tags",
    edits,
  });
  await callTool(apiUrl, token, "publish", { id, base_rev: edited.rev });
  return true;
}

for (const file of pieceFiles) {
  const { frontmatter, body } = parseFrontmatter(file.content);
  const slug = frontmatter.slug;
  if (!slug) {
    console.error(`[skip] ${file.path}: missing slug`);
    continue;
  }
  if (revertAsides) {
    try {
      const reverted = await revertHtmlAsides(slug);
      console.log(reverted ? `[reverted] ${slug}` : `[aside-ok] ${slug}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not_found") || message.includes("not found")) {
        console.log(`[skip] ${slug}: not on host`);
        continue;
      }
      console.error(`[error] ${slug}: ${message}`);
      process.exitCode = 1;
    }
    continue;
  }
  try {
    const created = await callTool(apiUrl, token, "create_doc", {
      collection: "pieces",
      frontmatter: hostedFrontmatter(frontmatter),
      body,
    });
    await callTool(apiUrl, token, "publish", { id: created.id, base_rev: created.rev });
    console.log(`[ok] ${slug}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("slug_conflict") || message.includes("already exists")) {
      try {
        const updated = await syncExistingFields(slug, frontmatter);
        console.log(updated ? `[updated] ${slug}` : `[skip] ${slug}: already exists`);
      } catch (syncError) {
        console.error(`[error] ${slug} update: ${syncError instanceof Error ? syncError.message : syncError}`);
        process.exitCode = 1;
      }
      continue;
    }
    console.error(`[error] ${slug}: ${message}`);
    process.exitCode = 1;
  }
}

// Site-wide documents (the `site` collection): JSON frontmatter plus a `body`,
// created once, then kept in sync field by field.
const siteFiles = revertAsides
  ? []
  : files.filter((f) => f.path.startsWith("content/site/") && f.path.endsWith(".json"));
for (const file of siteFiles) {
  const { body = "", ...frontmatter } = JSON.parse(file.content);
  const slug = frontmatter.slug;
  try {
    const created = await callTool(apiUrl, token, "create_doc", { collection: "site", frontmatter, body });
    await callTool(apiUrl, token, "publish", { id: created.id, base_rev: created.rev });
    console.log(`[ok] site/${slug}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("slug_conflict") && !message.includes("already exists")) {
      console.error(`[error] site/${slug}: ${message}`);
      process.exitCode = 1;
      continue;
    }
    try {
      const doc = await callTool(apiUrl, token, "read_doc", { id: `site/${slug}` });
      const edits = Object.entries(frontmatter)
        .filter(([key, value]) => key !== "slug" && JSON.stringify(doc.frontmatter?.[key]) !== JSON.stringify(value))
        .map(([field, value]) => ({ op: "set_field", field, value }));
      const current = typeof doc.body === "string" ? doc.body : "";
      if (body && current.trim() !== body.trim()) {
        edits.push(current.trim() ? { op: "str_replace", old: current, new: body } : { op: "append", text: body });
      }
      if (edits.length === 0) {
        console.log(`[skip] site/${slug}: up to date`);
        continue;
      }
      const edited = await callTool(apiUrl, token, "edit_doc", {
        id: doc.frontmatter._id,
        base_rev: doc.frontmatter._rev,
        note: "Sync site settings from seeds",
        edits,
      });
      await callTool(apiUrl, token, "publish", { id: doc.frontmatter._id, base_rev: edited.rev });
      console.log(`[updated] site/${slug}`);
    } catch (syncError) {
      console.error(`[error] site/${slug} update: ${syncError instanceof Error ? syncError.message : syncError}`);
      process.exitCode = 1;
    }
  }
}

if (revertAsides) {
  try {
    const reverted = await revertHtmlAsides("look-at");
    console.log(reverted ? `[reverted] look-at` : `[aside-ok] look-at`);
  } catch (error) {
    console.error(`[error] look-at: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

