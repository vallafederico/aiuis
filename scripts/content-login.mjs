#!/usr/bin/env node
/**
 * Device-login to content.software, then create/use the aiuis project.
 * The official CLI's Node strip-types loader cannot resolve sibling .ts imports
 * on this Node version, so this script speaks the same HTTP API.
 */
import { homedir } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = process.env.CONTENT_APP_URL ?? "https://app.content.software";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CREDS = process.env.CONTENT_CREDENTIALS ?? join(homedir(), ".config", "content-software", "credentials.json");
const NAME = "aiuis";
const SLUG = "aiuis";

async function readJson(res, label) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: not JSON (${res.status}): ${text.slice(0, 300)}`);
  }
}

async function loadCreds() {
  try {
    return JSON.parse(await readFile(CREDS, "utf8"));
  } catch {
    return { version: 1, projects: {} };
  }
}

async function saveCreds(file) {
  await mkdir(dirname(CREDS), { recursive: true });
  await writeFile(CREDS, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
}

async function login() {
  const start = await fetch(`${APP}/api/cli/device`, { method: "POST" });
  const device = await readJson(start, "device start");
  if (!start.ok || !device.device_code || !device.user_code) {
    throw new Error(`Could not start login (${start.status}): ${JSON.stringify(device)}`);
  }
  const verifyUrl = `${APP}/cli/authorize?user_code=${encodeURIComponent(device.user_code)}`;
  console.log(`Open ${verifyUrl}`);
  console.log(`User code: ${device.user_code}`);
  const interval = (device.interval || 3) * 1000;
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, interval));
    const poll = await fetch(`${APP}/api/cli/device/${device.device_code}`);
    if (poll.status === 404) throw new Error("Login expired. Run again.");
    const payload = await readJson(poll, "device poll");
    if (payload.status === "pending") continue;
    if (payload.status === "denied") throw new Error("Login was denied.");
    if (payload.status !== "approved") throw new Error(`Unexpected login status: ${payload.status ?? poll.status}`);
    const file = await loadCreds();
    if (payload.organization?.token && payload.organization.id) {
      file.organization = {
        id: payload.organization.id,
        name: payload.organization.name ?? "Organization",
        role: payload.organization.role ?? "member",
        token: payload.organization.token,
        expires: payload.organization.expires,
        appUrl: APP,
      };
      console.log(`Signed in to ${file.organization.name} (${file.organization.role})`);
    }
    if (payload.token && payload.project?.id) {
      file.projects[payload.project.id] = { ...payload.project, token: payload.token, expires: payload.expires };
      file.active = payload.project.id;
    }
    if (!file.organization?.token) throw new Error("Login succeeded but no organization token was returned.");
    await saveCreds(file);
    return file;
  }
  throw new Error("Timed out waiting for Clerk authorization.");
}

async function ensureProject(file) {
  const org = file.organization;
  const listed = await fetch(`${APP}/api/projects`, {
    headers: { Authorization: `Bearer ${org.token}` },
  });
  const listBody = await readJson(listed, "project list");
  if (!listed.ok) throw new Error(listBody.error ?? `Could not list projects (${listed.status})`);
  const projects = Array.isArray(listBody.projects) ? listBody.projects : [];
  let project = projects.find((p) => p.slug === SLUG || p.id === `project_${SLUG}`);
  let token;
  if (!project) {
    const created = await fetch(`${APP}/api/projects`, {
      method: "POST",
      headers: { Authorization: `Bearer ${org.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: NAME, slug: SLUG, organizationName: org.name }),
    });
    const body = await readJson(created, "project create");
    if (!created.ok || !body.project) {
      throw new Error(body.error ?? `Could not create the project (${created.status})`);
    }
    project = body.project;
    token = body.token?.token;
    console.log(`Created ${project.name} (${project.id})`);
  } else {
    console.log(`Using existing ${project.name} (${project.id})`);
  }
  if (!token) {
    const minted = await fetch(`${APP}/api/projects/${encodeURIComponent(project.id)}/tokens`, {
      method: "POST",
      headers: { Authorization: `Bearer ${org.token}` },
    });
    const body = await readJson(minted, "project token");
    if (!minted.ok || !body.token?.token) throw new Error(body.error ?? `Could not mint a project token (${minted.status})`);
    token = body.token.token;
    project = body.project ?? project;
  }
  const stored = {
    id: project.id,
    slug: project.slug,
    name: project.name,
    apiUrl: project.apiUrl,
    cdnUrl: project.cdnUrl,
    mcpUrl: project.mcpUrl,
    studioUrl: project.studioUrl,
    presentationUrl: project.presentationUrl,
    token,
  };
  file.projects[stored.id] = stored;
  file.active = stored.id;
  await saveCreds(file);
  const apiUrl = (stored.apiUrl ?? "").replace(/\/api$/, "");
  const config = {
    projectId: stored.id,
    slug: stored.slug,
    apiUrl,
    cdnUrl: stored.cdnUrl,
    mcpUrl: stored.mcpUrl,
    studioUrl: stored.studioUrl,
  };
  for (const key of Object.keys(config)) {
    if (config[key] == null || config[key] === "") delete config[key];
  }
  await writeFile(join(ROOT, "content.software.json"), `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Wrote ${join(ROOT, "content.software.json")}`);
  console.log(`CONTENT_PROJECT_ID=${stored.id}`);
  console.log(`CONTENT_API_URL=${apiUrl}`);
  return stored;
}

const existing = await loadCreds();
const file = existing.organization?.token ? existing : await login();
await ensureProject(file);
