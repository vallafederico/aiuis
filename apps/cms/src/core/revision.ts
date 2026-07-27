import { unified } from "unified"
import remarkParse from "remark-parse"
import { toString as mdastToString } from "mdast-util-to-string"
import { parseFrontmatter, dumpFrontmatter } from "../parse/frontmatter.js"
import type { Env } from "../index.js"

export interface RevisionMeta {
  docId: string
  collection: string
  slug: string
  rev: string
  at: string
  author: { kind: string; principal: string; session: string }
  note?: string
  diffStat?: string
  status?: string
}

/** Build the canonical stored content: user content + injected system frontmatter fields */
function buildStoredContent(content: string, meta: RevisionMeta): string {
  const { frontmatter, body } = parseFrontmatter(content)
  const status = meta.status ?? "draft"
  const systemFields: Record<string, unknown> = {
    ...frontmatter,
    _id: meta.docId,
    _collection: meta.collection,
    _status: status,
    _rev: meta.rev,
    _updated: meta.at,
  }
  // Only set _created if not already present (preserve original creation time)
  if (!("_created" in frontmatter)) {
    systemFields._created = meta.at
  }
  return dumpFrontmatter(systemFields, body)
}

export async function writeRevision(env: Env, meta: RevisionMeta, content: string): Promise<void> {
  const { frontmatter, body } = parseFrontmatter(content)
  const title = typeof frontmatter.title === "string" ? frontmatter.title : meta.slug
  const status = meta.status ?? "draft"
  const now = meta.at

  // Get plain text from body for FTS
  const parser = unified().use(remarkParse)
  const ast = parser.parse(body)
  const plainText = mdastToString(ast)

  // Build the stored content (with system fields injected)
  const storedContent = buildStoredContent(content, meta)

  // Step 1: R2 PUT revision (store with system fields)
  const revKey = `revisions/${meta.collection}/${meta.slug}/${meta.rev}.md`
  await env.BUCKET.put(revKey, storedContent)

  // Step 2: D1 batch
  const insertRevision = env.DB.prepare(
    `INSERT INTO revisions (rev, doc_id, at, author_kind, principal, session, note, diff_stat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    meta.rev,
    meta.docId,
    meta.at,
    meta.author.kind,
    meta.author.principal,
    meta.author.session,
    meta.note ?? "",
    meta.diffStat ?? ""
  )

  const insertDocIgnore = env.DB.prepare(
    `INSERT OR IGNORE INTO documents (id, collection, slug, status, head_rev, title, card, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(meta.docId, meta.collection, meta.slug, status, meta.rev, title, "{}", now, now)

  const updateDoc = env.DB.prepare(
    `UPDATE documents SET head_rev=?, title=?, updated=?, status=? WHERE id=?`
  ).bind(meta.rev, title, now, status, meta.docId)

  const deleteFts = env.DB.prepare(
    `DELETE FROM documents_fts WHERE id=?`
  ).bind(meta.docId)

  const insertFts = env.DB.prepare(
    `INSERT INTO documents_fts (id, title, body_text) VALUES (?, ?, ?)`
  ).bind(meta.docId, title, plainText)

  await env.DB.batch([insertRevision, insertDocIgnore, updateDoc, deleteFts, insertFts])

  // Step 3: R2 PUT HEAD content (store with system fields)
  const headKey = `content/${meta.collection}/${meta.slug}.md`
  await env.BUCKET.put(headKey, storedContent)
}

export async function reindexFromR2(env: Env): Promise<{ rebuilt: number; revisions: number; errors: string[] }> {
  const errors: string[] = []
  let rebuilt = 0
  let revisionsChecked = 0

  // Wipe FTS (not documents table)
  await env.DB.prepare("DELETE FROM documents_fts").run()

  // List content/ prefix and rebuild documents + FTS
  let cursor: string | undefined
  const parser = unified().use(remarkParse)

  do {
    const list = await env.BUCKET.list({ prefix: "content/", cursor })
    cursor = list.truncated ? list.cursor : undefined

    for (const obj of list.objects) {
      try {
        const item = await env.BUCKET.get(obj.key)
        if (!item) continue
        const content = await item.text()
        const { frontmatter, body } = parseFrontmatter(content)
        // Key format: content/{collection}/{slug}.md
        const parts = obj.key.replace("content/", "").replace(/\.md$/, "").split("/")
        const collection = parts[0]
        const slug = parts.slice(1).join("/")
        const title = typeof frontmatter.title === "string" ? frontmatter.title : slug
        const status = typeof frontmatter._status === "string" ? frontmatter._status : "draft"
        // _id is embedded by writeRevision; fall back to collection/slug if missing (legacy)
        const docId = typeof frontmatter._id === "string" ? frontmatter._id : `${collection}/${slug}`
        const headRev = typeof frontmatter._rev === "string" ? frontmatter._rev : ""
        const created = typeof frontmatter._created === "string" ? frontmatter._created : new Date().toISOString()
        const updated = typeof frontmatter._updated === "string" ? frontmatter._updated : new Date().toISOString()
        const ast = parser.parse(body)
        const plainText = mdastToString(ast)

        await env.DB.batch([
          env.DB.prepare(
            `INSERT OR IGNORE INTO documents (id, collection, slug, status, head_rev, title, card, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(docId, collection, slug, status, headRev, title, "{}", created, updated),
          env.DB.prepare(
            `UPDATE documents SET head_rev=?, title=?, updated=?, status=? WHERE id=?`
          ).bind(headRev, title, updated, status, docId),
          env.DB.prepare(
            `INSERT INTO documents_fts (id, title, body_text) VALUES (?, ?, ?)`
          ).bind(docId, title, plainText),
        ])

        rebuilt++
      } catch (e) {
        errors.push(`content ${obj.key}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  } while (cursor)

  // List revisions/ prefix and recover missing revision rows
  let revCursor: string | undefined
  do {
    const list = await env.BUCKET.list({ prefix: "revisions/", cursor: revCursor })
    revCursor = list.truncated ? list.cursor : undefined

    for (const obj of list.objects) {
      try {
        revisionsChecked++
        // Key format: revisions/{collection}/{slug}/{rev}.md
        const withoutPrefix = obj.key.replace("revisions/", "")
        const lastSlash = withoutPrefix.lastIndexOf("/")
        const revWithExt = withoutPrefix.slice(lastSlash + 1)
        const rev = revWithExt.replace(/\.md$/, "")
        const collectionSlug = withoutPrefix.slice(0, lastSlash)
        const firstSlash = collectionSlug.indexOf("/")
        const collection = collectionSlug.slice(0, firstSlash)
        const slug = collectionSlug.slice(firstSlash + 1)

        // Check if revision row exists
        const existing = await env.DB.prepare(`SELECT rev FROM revisions WHERE rev=?`).bind(rev).first()
        if (!existing) {
          // Find doc_id by collection+slug
          const doc = await env.DB.prepare(`SELECT id FROM documents WHERE collection=? AND slug=?`).bind(collection, slug).first<{ id: string }>()
          if (!doc) {
            errors.push(`revision ${obj.key}: no document found for ${collection}/${slug}`)
            continue
          }
          await env.DB.prepare(
            `INSERT OR IGNORE INTO revisions (rev, doc_id, at, author_kind, principal, session, note, diff_stat) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(rev, doc.id, new Date().toISOString(), "human", "reindex", "reindex", "recovered-by-reindex", "").run()
        }
      } catch (e) {
        errors.push(`revision ${obj.key}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  } while (revCursor)

  return { rebuilt, revisions: revisionsChecked, errors }
}

export async function updateCardFields(
  env: Env,
  docId: string,
  card: Record<string, unknown>
): Promise<void> {
  await env.DB.prepare('UPDATE documents SET card=? WHERE id=?')
    .bind(JSON.stringify(card), docId)
    .run()
}
