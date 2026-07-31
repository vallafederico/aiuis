// TODO: production auth = Cloudflare Access in front of /review* (deploy phase)
import { Hono } from "hono"
import { createPatch } from "diff"
import { publishHandler, revertHandler } from "../mcp/tools/lifecycle.js"
import type { AuthedIdentity } from "../core/auth.js"
import type { Env } from "../index.js"

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function constantTimeEqual(a: string, b: string): boolean {
  let match = a.length === b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? "") !== (b[i] ?? "")) match = false
  }
  return match
}

// --- HMAC helpers (Web Crypto API, available in Cloudflare Workers) ---

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("")
}

async function sha256hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("")
}

// --- Session cookie ---

const SESSION_COOKIE = "cms_session"
const SESSION_TTL = 28800 // 8 hours

interface SessionPayload {
  sub: string // session prefix (8 hex chars of token hash)
  exp: number // unix timestamp
}

async function buildSessionCookie(env: Env, sessionPrefix: string): Promise<string> {
  const payload = btoa(JSON.stringify({ sub: sessionPrefix, exp: Math.floor(Date.now() / 1000) + SESSION_TTL } satisfies SessionPayload))
  const mac = await hmacSign(env.SESSION_SECRET, payload)
  const cookieValue = `${payload}.${mac}`
  const isDevEnv = (env as unknown as { ENVIRONMENT?: string }).ENVIRONMENT === "dev"
  const secureFlag = isDevEnv ? "" : "; Secure"
  return `${SESSION_COOKIE}=${cookieValue}; HttpOnly; SameSite=Lax; Path=/review; Max-Age=${SESSION_TTL}${secureFlag}`
}

async function verifySessionCookie(env: Env, cookieValue: string): Promise<{ csrfToken: string } | null> {
  const dotIdx = cookieValue.lastIndexOf(".")
  if (dotIdx === -1) return null
  const payload = cookieValue.slice(0, dotIdx)
  const mac = cookieValue.slice(dotIdx + 1)

  const expected = await hmacSign(env.SESSION_SECRET, payload)
  if (!constantTimeEqual(mac, expected)) return null

  let parsed: SessionPayload
  try {
    parsed = JSON.parse(atob(payload)) as SessionPayload
  } catch {
    return null
  }

  if (parsed.exp < Math.floor(Date.now() / 1000)) return null

  const csrfToken = await hmacSign(env.SESSION_SECRET, cookieValue + "|csrf")
  return { csrfToken }
}

// --- Token-based login helpers (duplicate hash logic from auth.ts, without Bearer header requirement) ---

async function verifyTokenForReview(env: Env, rawToken: string): Promise<{ sessionPrefix: string } | null> {
  const tokenHash = await sha256hex(rawToken)
  const now = new Date().toISOString()

  const row = await env.DB.prepare(
    `SELECT capabilities FROM tokens WHERE token_hash=? AND (expires IS NULL OR expires > ?) AND revoked=0`
  ).bind(tokenHash, now).first<{ capabilities: string }>()

  if (!row) return null

  const caps = (() => { try { return JSON.parse(row.capabilities) } catch { return {} } })() as { publish?: boolean }
  if (!caps.publish) return null

  return { sessionPrefix: tokenHash.slice(0, 8) }
}

// --- Auth check — used by all protected routes ---

type AuthResult = { csrfToken: string } | null

async function checkReviewSession(req: Request, env: Env): Promise<AuthResult> {
  const isDevEnv = (env as unknown as { ENVIRONMENT?: string }).ENVIRONMENT === "dev"

  // 1. Dev-only escape hatch: Authorization: Bearer or cookie cms_review_key
  if (isDevEnv && env.CMS_DEV_SECRET) {
    const expected = env.CMS_DEV_SECRET

    const authHeader = req.headers.get("Authorization")
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7)
      if (constantTimeEqual(token, expected)) {
        return { csrfToken: "dev-bypass" }
      }
    }

    const cookieHeader = req.headers.get("Cookie") ?? ""
    const cookieMatch = cookieHeader.match(/(?:^|;\s*)cms_review_key=([^;]*)/)
    if (cookieMatch) {
      const cookieVal = cookieMatch[1] ?? ""
      if (constantTimeEqual(cookieVal, expected)) {
        return { csrfToken: "dev-bypass" }
      }
    }
  }

  // 2. Token-based session cookie
  const cookieHeader = req.headers.get("Cookie") ?? ""
  const sessionMatch = cookieHeader.match(/(?:^|;\s*)cms_session=([^;]*)/)
  if (sessionMatch) {
    const sessionVal = decodeURIComponent(sessionMatch[1] ?? "")
    const result = await verifySessionCookie(env, sessionVal)
    if (result) return result
  }

  return null
}

function unauthorizedHtml(): string {
  return `<!DOCTYPE html><html><head><title>Unauthorized</title></head><body style="background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:1rem 2rem"><h1>401 Unauthorized</h1><p>Pass <code>?key=YOUR_SECRET</code> or an <code>Authorization: Bearer</code> header.</p></body></html>`
}

const app = new Hono<{ Bindings: Env }>()

// GET /login — show login form
app.get("/login", (c) => {
  const error = c.req.query("error")
  const errorHtml = error
    ? `<p style="color:#f44336">${esc(error === "invalid" ? "Invalid or unauthorized token." : error)}</p>`
    : ""
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>CMS Login</title></head>
<body style="background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif;max-width:500px;margin:4rem auto;padding:1rem 2rem">
<h1>CMS Review Login</h1>
${errorHtml}
<form method="POST" action="/review/login">
  <div style="margin-bottom:1rem">
    <label style="display:block;margin-bottom:.5rem">Bearer token:</label>
    <input type="text" name="token" autocomplete="off" style="width:100%;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:4px;padding:.5rem;font-family:monospace;font-size:0.9rem">
  </div>
  <button type="submit" style="background:#1a3a1a;color:#4caf50;border:1px solid #4caf50;padding:.5rem 1.5rem;border-radius:4px;cursor:pointer">Login</button>
</form>
</body>
</html>`
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
})

// POST /login — verify token and set session cookie
app.post("/login", async (c) => {
  const body = await c.req.parseBody()
  const rawToken = (body["token"] as string ?? "").trim()

  if (!rawToken) {
    return c.redirect("/review/login?error=invalid", 302)
  }

  const result = await verifyTokenForReview(c.env, rawToken)
  if (!result) {
    return c.redirect("/review/login?error=invalid", 302)
  }

  const sessionCookie = await buildSessionCookie(c.env, result.sessionPrefix)
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/review",
      "Set-Cookie": sessionCookie,
    },
  })
})

// Auth middleware for all other /review routes
app.use("*", async (c, next) => {
  // Skip login routes (already handled above but middleware runs for all)
  const path = new URL(c.req.url).pathname
  if (path === "/review/login") return next()

  const isDevEnv = (c.env as unknown as { ENVIRONMENT?: string }).ENVIRONMENT === "dev"

  // ?key= redirect path (dev only): set cookie then redirect to URL without ?key
  const keyParam = c.req.query("key")
  if (keyParam !== undefined && isDevEnv && c.env.CMS_DEV_SECRET) {
    if (constantTimeEqual(keyParam, c.env.CMS_DEV_SECRET)) {
      const url = new URL(c.req.url)
      url.searchParams.delete("key")
      const cookieValue = `cms_review_key=${keyParam}; HttpOnly; SameSite=Strict; Path=/review`
      return new Response(null, {
        status: 302,
        headers: {
          Location: url.pathname + (url.search || ""),
          "Set-Cookie": cookieValue,
        },
      })
    }
    return new Response(unauthorizedHtml(), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } })
  }

  const auth = await checkReviewSession(c.req.raw, c.env)

  if (!auth) {
    return c.redirect("/review/login", 302)
  }

  // CSRF check on POSTs (not enforced on dev-bypass path)
  if (c.req.method === "POST" && auth.csrfToken !== "dev-bypass") {
    const formBody = await c.req.parseBody()
    const csrfProvided = formBody["_csrf"] as string | undefined
    if (!csrfProvided || !constantTimeEqual(csrfProvided, auth.csrfToken)) {
      return new Response("403 Forbidden: CSRF check failed", { status: 403 })
    }
    // Store parsed body back so action handler can re-use it
    c.set("parsedBody" as never, formBody)
  }

  // Store auth in context for page handlers
  c.set("auth" as never, auth)
  return next()
})

type RevisionRow = {
  rev: string
  at: string
  author_kind: string | null
  principal: string | null
  session: string | null
  note: string | null
  diff_stat: string | null
  doc_id: string
  collection: string
  slug: string
  title: string | null
  status: string
  head_rev: string
  published_rev: string | null
}

// GET / — inbox page
app.get("/", async (c) => {
  const env = c.env
  const statusParam = c.req.query("status")
  const msgParam = c.req.query("msg")
  const auth = c.get("auth" as never) as { csrfToken: string } | undefined
  const csrfToken = auth?.csrfToken ?? ""

  let flash = ""
  if (statusParam === "published") {
    flash = `<div style="background:#1a3a1a;border:1px solid #4caf50;padding:.75rem 1rem;border-radius:6px;margin-bottom:1rem;color:#4caf50">Published successfully.</div>`
  } else if (statusParam === "reverted") {
    flash = `<div style="background:#1a2a3a;border:1px solid #58a6ff;padding:.75rem 1rem;border-radius:6px;margin-bottom:1rem;color:#58a6ff">Reverted successfully.</div>`
  } else if (statusParam === "error") {
    const errMsg = msgParam ? esc(msgParam) : "Unknown error"
    flash = `<div style="background:#3a1a1a;border:1px solid #f44336;padding:.75rem 1rem;border-radius:6px;margin-bottom:1rem;color:#f44336">Error: ${errMsg}</div>`
  }

  const rows = await env.DB.prepare(`
    SELECT r.rev, r.at, r.author_kind, r.principal, r.session, r.note, r.diff_stat,
           d.id as doc_id, d.collection, d.slug, d.title, d.status, d.head_rev, d.published_rev
    FROM revisions r JOIN documents d ON d.id = r.doc_id
    ORDER BY r.at DESC LIMIT 50
  `).all<RevisionRow>()

  const revisions = rows.results ?? []

  // CSRF field included in forms (omitted on dev-bypass since CSRF isn't enforced there)
  const csrfField = csrfToken !== "dev-bypass"
    ? `<input type="hidden" name="_csrf" value="${esc(csrfToken)}">`
    : ""

  let items = ""
  for (const r of revisions) {
    const isHead = r.rev === r.head_rev
    const isPublished = r.published_rev !== null && r.rev === r.published_rev
    const hasDrift = r.head_rev !== r.published_rev && r.published_rev !== null

    const statusColor = r.status === "published" ? "#4caf50" : r.status === "archived" ? "#888" : "#f0a500"
    const statusPill = `<span style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor};padding:2px 8px;border-radius:12px;font-size:0.75rem">${esc(r.status)}</span>`
    const headBadge = isHead ? `<span style="background:#58a6ff22;color:#58a6ff;border:1px solid #58a6ff;padding:2px 8px;border-radius:12px;font-size:0.75rem;margin-left:4px">HEAD</span>` : ""
    const publishedBadge = isPublished ? `<span style="background:#4caf5022;color:#4caf50;border:1px solid #4caf50;padding:2px 8px;border-radius:12px;font-size:0.75rem;margin-left:4px">live</span>` : ""
    const driftBadge = hasDrift ? `<span style="background:#f0a50022;color:#f0a500;border:1px solid #f0a500;padding:2px 8px;border-radius:12px;font-size:0.75rem;margin-left:4px">drift</span>` : ""

    const publishForm = isHead ? `
      <form method="POST" action="/review/action" style="display:inline">
        ${csrfField}
        <input type="hidden" name="action" value="publish">
        <input type="hidden" name="docId" value="${esc(r.doc_id)}">
        <input type="hidden" name="rev" value="${esc(r.rev)}">
        <button type="submit" style="background:#1a3a1a;color:#4caf50;border:1px solid #4caf50;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:0.8rem">Publish</button>
      </form>` : ""

    const revertForm = `
      <form method="POST" action="/review/action" style="display:inline;margin-left:8px">
        ${csrfField}
        <input type="hidden" name="action" value="revert">
        <input type="hidden" name="docId" value="${esc(r.doc_id)}">
        <input type="hidden" name="rev" value="${esc(r.rev)}">
        <button type="submit" style="background:#1a2a3a;color:#58a6ff;border:1px solid #58a6ff;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:0.8rem">Revert to this</button>
      </form>`

    items += `
    <div style="border:1px solid #30363d;border-radius:8px;padding:1rem;margin-bottom:.75rem">
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem">
        <strong>${esc(r.title ?? r.slug)}</strong>
        ${statusPill}${headBadge}${publishedBadge}${driftBadge}
        <span style="color:#888;font-size:0.8rem">${esc(r.collection)}/${esc(r.slug)}</span>
      </div>
      <div style="color:#888;font-size:0.8rem;margin-bottom:.5rem">
        rev <code>${esc(r.rev)}</code> · ${esc(r.at)} · ${esc(r.author_kind ?? "")} <em>${esc(r.principal ?? "")}</em>
        ${r.note ? `· <em>${esc(r.note)}</em>` : ""}
        ${r.diff_stat ? `· <code>${esc(r.diff_stat)}</code>` : ""}
      </div>
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
        <a href="/review/diff/${esc(r.doc_id)}/${esc(r.rev)}" style="color:#58a6ff;font-size:0.85rem">View diff</a>
        ${publishForm}
        ${revertForm}
      </div>
    </div>`
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>CMS Review</title></head>
<body style="background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:1rem 2rem">
<h1 style="margin-bottom:1.5rem">CMS Review Inbox</h1>
${flash}
${items || '<p style="color:#888">No revisions found.</p>'}
</body>
</html>`

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
})

// GET /diff/:docId/:rev — diff page
app.get("/diff/:docId/:rev", async (c) => {
  const env = c.env
  const docId = c.req.param("docId")
  const rev = c.req.param("rev")

  const doc = await env.DB.prepare(
    `SELECT id, collection, slug, title, status FROM documents WHERE id=?`
  ).bind(docId).first<{ id: string; collection: string; slug: string; title: string | null; status: string }>()

  if (!doc) {
    return new Response("Not found", { status: 404 })
  }

  // Fetch revision content from R2
  const revKey = `revisions/${doc.collection}/${doc.slug}/${rev}.md`
  const revObj = await env.BUCKET.get(revKey)
  if (!revObj) {
    return new Response("Revision not found", { status: 404 })
  }
  const revContent = await revObj.text()

  // Fetch revision metadata from D1
  const revMeta = await env.DB.prepare(
    `SELECT at, author_kind, principal, session, note, diff_stat FROM revisions WHERE rev=? AND doc_id=?`
  ).bind(rev, docId).first<{ at: string; author_kind: string | null; principal: string | null; session: string | null; note: string | null; diff_stat: string | null }>()

  // Fetch predecessor revision
  const pred = await env.DB.prepare(
    `SELECT rev, at FROM revisions WHERE doc_id=? AND at < (SELECT at FROM revisions WHERE rev=? AND doc_id=?) ORDER BY at DESC LIMIT 1`
  ).bind(docId, rev, docId).first<{ rev: string; at: string }>()

  let diffStr: string
  if (!pred) {
    // No predecessor: fake add-all diff
    diffStr = createPatch(`${doc.collection}/${doc.slug}`, "", revContent, "initial", rev)
  } else {
    const predKey = `revisions/${doc.collection}/${doc.slug}/${pred.rev}.md`
    const predObj = await env.BUCKET.get(predKey)
    const predContent = predObj ? await predObj.text() : ""
    diffStr = createPatch(`${doc.collection}/${doc.slug}`, predContent, revContent, pred.rev, rev)
  }

  // Render diff lines with colors
  const lines = diffStr.split("\n")
  const renderedLines = lines.map(line => {
    const escaped = esc(line)
    if (line.startsWith("+++") || line.startsWith("---")) {
      return `<span>${escaped}</span>`
    } else if (line.startsWith("+")) {
      return `<span style="color:#4caf50">${escaped}</span>`
    } else if (line.startsWith("-")) {
      return `<span style="color:#f44336">${escaped}</span>`
    } else if (line.startsWith("@@")) {
      return `<span style="color:#58a6ff">${escaped}</span>`
    }
    return `<span>${escaped}</span>`
  })
  const renderedDiff = renderedLines.join("\n")

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Diff: ${esc(doc.title ?? doc.slug)}</title></head>
<body style="background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:1rem 2rem">
<p><a href="/review" style="color:#58a6ff">&larr; Back to inbox</a></p>
<h1 style="margin-bottom:.5rem">${esc(doc.title ?? doc.slug)}</h1>
<p style="color:#888;font-size:0.85rem">${esc(doc.collection)}/${esc(doc.slug)} &middot; status: ${esc(doc.status)}</p>
<div style="color:#888;font-size:0.85rem;margin-bottom:1rem">
  rev <code>${esc(rev)}</code>
  ${revMeta ? `&middot; ${esc(revMeta.at)} &middot; ${esc(revMeta.author_kind ?? "")} <em>${esc(revMeta.principal ?? "")}</em>${revMeta.note ? ` &middot; <em>${esc(revMeta.note)}</em>` : ""}${revMeta.diff_stat ? ` &middot; <code>${esc(revMeta.diff_stat)}</code>` : ""}` : ""}
</div>
<pre style="overflow-x:auto;background:#161b22;padding:1rem;border-radius:6px;font-size:0.85rem">${renderedDiff}</pre>
</body>
</html>`

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
})

// POST /action — form post handler
app.post("/action", async (c) => {
  const env = c.env
  // Body may have been pre-parsed by CSRF middleware; fall back to parsing again
  const body = (c.get("parsedBody" as never) as Record<string, string> | undefined) ?? await c.req.parseBody()
  const action = body["action"] as string
  const docId = body["docId"] as string
  const rev = body["rev"] as string

  const reviewerIdentity: AuthedIdentity = {
    principal: "reviewer",
    kind: "human",
    audience: "any",
    capabilities: { publish: true, collections: "*", namespaces: [] },
    session: "review-" + Date.now().toString(36),
  }

  try {
    if (action === "publish") {
      const result = await publishHandler(env, reviewerIdentity, { id: docId, base_rev: rev })
      if (result.isError) {
        const errData = JSON.parse(result.content[0].text)
        throw new Error(errData.error ?? "publish failed")
      }
      return c.redirect("/review?status=published", 302)
    } else if (action === "revert") {
      const result = await revertHandler(env, reviewerIdentity, { id: docId, to_rev: rev, note: "reverted via review page" })
      if (result.isError) {
        const errData = JSON.parse(result.content[0].text)
        throw new Error(errData.error ?? "revert failed")
      }
      return c.redirect("/review?status=reverted", 302)
    } else {
      throw new Error("unknown action")
    }
  } catch (e) {
    const msg = encodeURIComponent(e instanceof Error ? e.message : String(e))
    return c.redirect(`/review?status=error&msg=${msg}`, 302)
  }
})

export const reviewApp = app
