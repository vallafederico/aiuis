import type { Env } from "../index.js"
import type { CollectionSchema } from "./validate.js"

/** Collect all ref values from a frontmatter object given a schema.
 * Returns a map of fieldName -> array of ref strings.
 * Handles both scalar `ref` fields and `array` fields with `items.type === 'ref'`.
 */
function collectRefs(schema: CollectionSchema, frontmatter: Record<string, unknown>): Array<{ field: string; ref: string }> {
  const refs: Array<{ field: string; ref: string }> = []

  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    const fd = fieldDef as { type: string; items?: { type: string } }
    const value = frontmatter[fieldName]

    if (fd.type === "ref") {
      if (typeof value === "string") {
        refs.push({ field: fieldName, ref: value })
      }
    } else if (fd.type === "array" && fd.items?.type === "ref") {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") {
            refs.push({ field: fieldName, ref: item })
          }
        }
      }
    }
  }

  return refs
}

/** Check that all ref values in frontmatter point to existing documents.
 * Returns array of missing refs: { field, ref } for each that doesn't exist.
 */
export async function checkRefExistence(
  env: Env,
  schema: CollectionSchema,
  frontmatter: Record<string, unknown>
): Promise<Array<{ field: string; ref: string }>> {
  const refs = collectRefs(schema, frontmatter)
  const missing: Array<{ field: string; ref: string }> = []

  for (const { field, ref } of refs) {
    const slashIdx = ref.indexOf("/")
    if (slashIdx === -1) {
      missing.push({ field, ref })
      continue
    }
    const collection = ref.slice(0, slashIdx)
    const slug = ref.slice(slashIdx + 1)

    const row = await env.DB.prepare(
      `SELECT id FROM documents WHERE collection=? AND slug=?`
    ).bind(collection, slug).first()

    if (!row) {
      missing.push({ field, ref })
    }
  }

  return missing
}

/** Sync ref_edges for a document: delete all existing edges from this doc,
 * then insert new ones based on current frontmatter.
 */
export async function syncRefEdges(
  env: Env,
  fromDocId: string,
  schema: CollectionSchema,
  frontmatter: Record<string, unknown>
): Promise<void> {
  // Delete all existing ref_edges from this doc
  await env.DB.prepare(`DELETE FROM ref_edges WHERE from_doc=?`).bind(fromDocId).run()

  const refs = collectRefs(schema, frontmatter)

  for (const { field, ref } of refs) {
    const slashIdx = ref.indexOf("/")
    if (slashIdx === -1) continue
    const collection = ref.slice(0, slashIdx)
    const slug = ref.slice(slashIdx + 1)

    const row = await env.DB.prepare(
      `SELECT id FROM documents WHERE collection=? AND slug=?`
    ).bind(collection, slug).first<{ id: string }>()

    if (row) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO ref_edges (from_doc, to_doc, field) VALUES (?, ?, ?)`
      ).bind(fromDocId, row.id, field).run()
    }
  }
}
