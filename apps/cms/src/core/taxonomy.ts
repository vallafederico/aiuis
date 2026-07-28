import { parseFrontmatter } from "../parse/frontmatter.js"
import type { Env } from "../index.js"
import type { CollectionSchema } from "./validate.js"

export interface TaxonomyDef {
  name: string
  policy: string
  aliases: Record<string, string>
  terms: Array<{ slug: string; title?: string; description?: string }>
}

export async function loadTaxonomy(env: Env, name: string): Promise<TaxonomyDef | null> {
  const key = `schema/taxonomies/${name}.md`
  const obj = await env.BUCKET.get(key)
  if (!obj) return null
  const raw = await obj.text()
  const { frontmatter } = parseFrontmatter(raw)

  const aliases: Record<string, string> = {}
  if (frontmatter.aliases && typeof frontmatter.aliases === "object" && !Array.isArray(frontmatter.aliases)) {
    for (const [k, v] of Object.entries(frontmatter.aliases as Record<string, unknown>)) {
      if (typeof v === "string") aliases[k] = v
    }
  }

  const terms: Array<{ slug: string; title?: string; description?: string }> = []
  if (Array.isArray(frontmatter.terms)) {
    for (const t of frontmatter.terms as unknown[]) {
      if (t && typeof t === "object" && !Array.isArray(t)) {
        const term = t as Record<string, unknown>
        if (typeof term.slug === "string") {
          terms.push({
            slug: term.slug,
            title: typeof term.title === "string" ? term.title : undefined,
            description: typeof term.description === "string" ? term.description : undefined,
          })
        }
      }
    }
  }

  return {
    name: typeof frontmatter.name === "string" ? frontmatter.name : name,
    policy: typeof frontmatter.policy === "string" ? frontmatter.policy : "propose",
    aliases,
    terms,
  }
}

export function normalizeTerm(raw: string, taxDef: TaxonomyDef): string {
  // lowercase, replace non-alphanumeric (except existing hyphens) with hyphen, collapse multiple hyphens, trim ends
  let slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")

  // Apply aliases
  if (taxDef.aliases[slug] !== undefined) {
    slug = taxDef.aliases[slug]
  }

  return slug
}

export async function syncDocTerms(
  env: Env,
  docId: string,
  taxonomy: string,
  terms: string[],
  isPublished: boolean
): Promise<void> {
  // Load taxonomy def for known terms
  const taxDef = await loadTaxonomy(env, taxonomy)
  const knownSlugs = new Set(taxDef?.terms.map(t => t.slug) ?? [])

  // Normalize all terms
  const normalizedTerms = taxDef
    ? terms.map(t => normalizeTerm(t, taxDef))
    : terms.map(t => t.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, ""))

  // Delete old doc_terms for this doc+taxonomy
  await env.DB.prepare(
    `DELETE FROM doc_terms WHERE doc_id=? AND taxonomy=?`
  ).bind(docId, taxonomy).run()

  // Insert new doc_terms and upsert terms table
  for (const slug of normalizedTerms) {
    if (!slug) continue

    // Insert doc_term
    await env.DB.prepare(
      `INSERT OR IGNORE INTO doc_terms (doc_id, taxonomy, term_slug) VALUES (?, ?, ?)`
    ).bind(docId, taxonomy, slug).run()

    // Upsert term: if unknown → proposed, if known → active
    const status = knownSlugs.has(slug) ? "active" : "proposed"
    const existingTerm = await env.DB.prepare(
      `SELECT slug FROM terms WHERE taxonomy=? AND slug=?`
    ).bind(taxonomy, slug).first()

    if (!existingTerm) {
      const title = taxDef?.terms.find(t => t.slug === slug)?.title ?? ""
      const description = taxDef?.terms.find(t => t.slug === slug)?.description ?? ""
      await env.DB.prepare(
        `INSERT INTO terms (taxonomy, slug, title, description, status, count) VALUES (?, ?, ?, ?, ?, 0)`
      ).bind(taxonomy, slug, title, description, status).run()
    }
  }

  // Update count for all terms in this taxonomy: count = number of docs in doc_terms
  // where that (taxonomy, term_slug) AND the doc's published_rev IS NOT NULL
  // We need to recount all affected terms
  const affectedTerms = new Set(normalizedTerms)
  for (const slug of affectedTerms) {
    if (!slug) continue
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM doc_terms dt JOIN documents d ON dt.doc_id = d.id WHERE dt.taxonomy=? AND dt.term_slug=? AND d.published_rev IS NOT NULL`
    ).bind(taxonomy, slug).first<{ n: number }>()
    const count = countRow?.n ?? 0
    await env.DB.prepare(
      `UPDATE terms SET count=? WHERE taxonomy=? AND slug=?`
    ).bind(count, taxonomy, slug).run()
  }
}

export async function syncTaxonomyForDoc(
  env: Env,
  schema: CollectionSchema,
  docId: string,
  frontmatter: Record<string, unknown>,
  isPublished: boolean
): Promise<void> {
  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    if ((fieldDef as { type: string }).type === "tax") {
      const taxonomy = (fieldDef as { taxonomy?: string }).taxonomy
      if (!taxonomy) continue
      const value = frontmatter[fieldName]
      if (!Array.isArray(value)) continue
      const terms = (value as unknown[]).filter(t => typeof t === "string") as string[]
      await syncDocTerms(env, docId, taxonomy, terms, isPublished)
    }
  }
}

export async function rebuildTaxonomyCounts(env: Env): Promise<void> {
  // Get all terms
  const allTerms = await env.DB.prepare(`SELECT taxonomy, slug FROM terms`).all<{ taxonomy: string; slug: string }>()

  for (const term of allTerms.results) {
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM doc_terms dt JOIN documents d ON dt.doc_id = d.id WHERE dt.taxonomy=? AND dt.term_slug=? AND d.published_rev IS NOT NULL`
    ).bind(term.taxonomy, term.slug).first<{ n: number }>()
    const count = countRow?.n ?? 0
    await env.DB.prepare(
      `UPDATE terms SET count=? WHERE taxonomy=? AND slug=?`
    ).bind(count, term.taxonomy, term.slug).run()
  }
}
