import { parseFrontmatter } from "../parse/frontmatter.js"
import type { Env } from "../index.js"

export class ValidationError extends Error {
  errors: string[]
  constructor(errors: string[]) {
    super(errors.join("; "))
    this.name = "ValidationError"
    this.errors = errors
  }
}

interface FieldDef {
  type: string
  required?: boolean
  max?: number
  from?: string
  taxonomy?: string
  max_items?: number
  items?: unknown
  accept?: unknown
  values?: string[]
}

export interface CollectionSchema {
  collection: string
  fields: Record<string, FieldDef>
  body: string
  indexes: string[]
  guidelines: string
  slices?: unknown
}

export async function loadCollectionSchema(env: Env, collection: string): Promise<CollectionSchema> {
  const key = `schema/${collection}.md`
  const obj = await env.BUCKET.get(key)
  if (!obj) {
    throw new Error(`Schema not found for collection: ${collection}`)
  }
  const raw = await obj.text()
  const { frontmatter, body } = parseFrontmatter(raw)

  const fields: Record<string, FieldDef> = {}
  if (frontmatter.fields && typeof frontmatter.fields === "object" && !Array.isArray(frontmatter.fields)) {
    const rawFields = frontmatter.fields as Record<string, unknown>
    for (const [name, def] of Object.entries(rawFields)) {
      if (def && typeof def === "object" && !Array.isArray(def)) {
        fields[name] = def as FieldDef
      }
    }
  }

  return {
    collection: typeof frontmatter.collection === "string" ? frontmatter.collection : collection,
    fields,
    body: typeof frontmatter.body === "string" ? frontmatter.body : "markdown",
    indexes: Array.isArray(frontmatter.indexes) ? frontmatter.indexes as string[] : [],
    guidelines: body,
    slices: frontmatter.slices ?? null,
  }
}

export function validateFrontmatter(schema: CollectionSchema, fm: Record<string, unknown>): void {
  const errors: string[] = []
  const schemaFields = schema.fields

  // Check for unknown fields
  for (const key of Object.keys(fm)) {
    if (!(key in schemaFields)) {
      errors.push(`fields.${key}: unknown field`)
    }
  }

  // Validate each schema field
  for (const [name, fieldDef] of Object.entries(schemaFields)) {
    const value = fm[name]

    // Required check
    if (fieldDef.required && (value === undefined || value === null)) {
      errors.push(`fields.${name}: required`)
      continue
    }

    // Skip optional absent fields
    if (value === undefined || value === null) {
      continue
    }

    const type = fieldDef.type

    if (type === "string" || type === "text") {
      if (typeof value === "string" && fieldDef.max !== undefined) {
        if (value.length > fieldDef.max) {
          errors.push(`fields.${name}: exceeds max ${fieldDef.max} (got ${value.length})`)
        }
      }
    } else if (type === "datetime") {
      const d = new Date(value as string)
      if (isNaN(d.getTime())) {
        errors.push(`fields.${name}: invalid datetime`)
      }
    } else if (type === "slug") {
      const slugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/
      if (typeof value !== "string" || !slugRegex.test(value)) {
        errors.push(`fields.${name}: invalid slug format`)
      }
    } else if (type === "array") {
      if (Array.isArray(value) && fieldDef.max_items !== undefined) {
        if (value.length > fieldDef.max_items) {
          errors.push(`fields.${name}: exceeds max_items ${fieldDef.max_items} (got ${value.length})`)
        }
      }
    } else if (type === "enum") {
      if (fieldDef.values && !fieldDef.values.includes(value as string)) {
        errors.push(`fields.${name}: invalid enum value`)
      }
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors)
  }
}
