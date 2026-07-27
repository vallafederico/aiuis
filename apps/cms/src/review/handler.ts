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

const app = new Hono<{ Bindings: Env }>()

// Auth middleware
app.use("*", async (c, next) => {
  const env = c.env
  const expected = env.CMS_DEV_SECRET ?? ""

  // 1. Check ?key= query param → set cookie + redirect to URL without ?key
  const keyParam = c.req.query("key")
  if (keyParam !== undefined) {
    if (constantTimeEqual(keyParam, expected)) {
      // Build redirect URL without ?key param
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

  // 2. Check Authorization: Bearer header
  const authHeader = c.req.header("Authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    if (constantTimeEqual(token, expected)) {
      return next()
    }
    return new Response(unauthorizedHtml(), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } })
  }

  // 3. Check Cookie: cms_review_key=
  const cookieHeader = c.req.header("Cookie") ?? ""
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)cms_review_key=([^;]*)/)
  if (cookieMatch) {
    const cookieVal = cookieMatch[1] ?? ""
    if (constantTimeEqual(cookieVal, expected)) {
      return next()
    }
  }

  // 4. 401
  return new Response(unauthorizedHtml(), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } })
})

function unauthorizedHtml(): string {
  return `<!DOCTYPE html><html><head><title>Unauthorized</title></head><body style="background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:1rem 2rem"><h1>401 Unauthorized</h1><p>Pass <code>?key=YOUR_SECRET</code> or an <code>Authorization: Bearer</code> header.</p></body></html>`
}

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
        <input type="hidden" name="action" value="publish">
        <input type="hidden" name="docId" value="${esc(r.doc_id)}">
        <input type="hidden" name="rev" value="${esc(r.rev)}">
        <button type="submit" style="background:#1a3a1a;color:#4caf50;border:1px solid #4caf50;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:0.8rem">Publish</button>
      </form>` : ""

    const revertForm = `
      <form method="POST" action="/review/action" style="display:inline;margin-left:8px">
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
  const body = await c.req.parseBody()
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
