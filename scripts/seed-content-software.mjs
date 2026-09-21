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

// Hosted default pieces schema: section enum is notes|foundations|product
// (not preface|foundations|uis), and :::foreword / :::notes are unknown.
const SITE_TO_HOSTED_SECTION = { preface: "notes", foundations: "foundations", uis: "product" };

function hostedSection(section) {
  return SITE_TO_HOSTED_SECTION[section] ?? section;
}

function stripDirectives(body) {
  return body
    .replace(/^:::foreword\n([\s\S]*?)\n:::\n*/m, "$1\n\n")
    .replace(/\n*:::notes\n([\s\S]*?)\n:::\s*$/m, "\n\n$1\n")
    .replace(/:::[\w-]+[^\n]*\n([\s\S]*?)\n:::/g, "$1");
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

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const frontmatter = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!["title", "slug", "section", "order", "description"].includes(key)) continue;
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  }
  return { frontmatter, body: match[2].replace(/^\n/, "") };
}

function loadProject() {
  const config = JSON.parse(readFileSync(join(root, "content.software.json"), "utf8"));
  const credsPath = process.env.CONTENT_CREDENTIALS ?? join(homedir(), ".config", "content-software", "credentials.json");
  const creds = JSON.parse(readFileSync(credsPath, "utf8"));
  const project = creds.projects?.[config.projectId] ?? Object.values(creds.projects ?? {}).find((p) => p.slug === config.slug);
  if (!project?.token) {
    throw new Error("No stored token for this project. Run: pnpm content login --project aiuis");
  }
  const apiUrl = (project.apiUrl ?? config.apiUrl ?? `https://${config.slug}.content.software`).replace(/\/api$/, "").replace(/\/$/, "");
  return { project, apiUrl, token: project.token };
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
const schemaFiles = files.filter((f) => f.path.startsWith("schema/") || f.path.startsWith("skills/"));
const pieceFiles = files.filter((f) => f.path.startsWith("content/pieces/") && f.path.endsWith(".md"));

const seedRes = await fetch(`${apiUrl}/api/v1/admin/seed`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({ files: schemaFiles }),
});
const seedBody = await seedRes.text();
if (seedRes.ok) {
  console.log(`Seeded ${schemaFiles.length} schema/skill files`);
} else {
  console.warn(`admin/seed ${seedRes.status}: ${seedBody}`);
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

for (const file of pieceFiles) {
  const { frontmatter, body } = parseFrontmatter(file.content);
  const slug = frontmatter.slug;
  if (!slug) {
    console.error(`[skip] ${file.path}: missing slug`);
    continue;
  }
  try {
    const created = await callTool(apiUrl, token, "create_doc", {
      collection: "pieces",
      frontmatter: {
        ...frontmatter,
        section: hostedSection(frontmatter.section),
      },
      body: stripDirectives(body),
    });
    await callTool(apiUrl, token, "publish", { id: created.id, base_rev: created.rev });
    console.log(`[ok] ${slug}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("slug_conflict") || message.includes("already exists")) {
      console.log(`[skip] ${slug}: already exists`);
      continue;
    }
    console.error(`[error] ${slug}: ${message}`);
    process.exitCode = 1;
  }
}
