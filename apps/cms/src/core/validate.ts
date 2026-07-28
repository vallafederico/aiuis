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
  integer?: boolean
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
    const slugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/

    if (type === "string" || type === "text") {
      if (typeof value !== "string") {
        errors.push(`fields.${name}: expected string, got ${typeof value}`)
      } else if (fieldDef.max !== undefined) {
        if (value.length > fieldDef.max) {
          errors.push(`fields.${name}: exceeds max ${fieldDef.max} (got ${value.length})`)
        }
      }
    } else if (type === "number") {
      if (typeof value !== "number") {
        errors.push(`fields.${name}: expected number, got ${typeof value}`)
      } else if (fieldDef.integer === true && !Number.isInteger(value)) {
        errors.push(`fields.${name}: expected integer`)
      }
    } else if (type === "datetime") {
      if (typeof value !== "string") {
        errors.push(`fields.${name}: expected string for datetime, got ${typeof value}`)
      } else {
        const d = new Date(value)
        if (isNaN(d.getTime())) {
          errors.push(`fields.${name}: invalid datetime`)
        }
      }
    } else if (type === "slug") {
      if (typeof value !== "string" || !slugRegex.test(value)) {
        errors.push(`fields.${name}: invalid slug format`)
      }
    } else if (type === "array") {
      if (!Array.isArray(value)) {
        errors.push(`fields.${name}: expected array, got ${typeof value}`)
      } else {
        if (fieldDef.max_items !== undefined && value.length > fieldDef.max_items) {
          errors.push(`fields.${name}: exceeds max_items ${fieldDef.max_items} (got ${value.length})`)
        }
        const itemType = (fieldDef.items as { type?: string } | undefined)?.type
        if (itemType) {
          for (let i = 0; i < value.length; i++) {
            const item = value[i]
            if (itemType === "string" && typeof item !== "string") {
              errors.push(`fields.${name}[${i}]: expected string, got ${typeof item}`)
            } else if (itemType === "number" && typeof item !== "number") {
              errors.push(`fields.${name}[${i}]: expected number, got ${typeof item}`)
            } else if (itemType === "ref" && typeof item !== "string") {
              errors.push(`fields.${name}[${i}]: expected string, got ${typeof item}`)
            }
          }
        }
      }
    } else if (type === "enum") {
      if (typeof value !== "string") {
        errors.push(`fields.${name}: expected string for enum, got ${typeof value}`)
      } else if (fieldDef.values && !fieldDef.values.includes(value)) {
        errors.push(`fields.${name}: invalid enum value`)
      }
    } else if (type === "tax") {
      if (!Array.isArray(value)) {
        errors.push(`fields.${name}: expected array for tax, got ${typeof value}`)
      } else {
        if (fieldDef.max_items !== undefined && value.length > fieldDef.max_items) {
          errors.push(`fields.${name}: exceeds max_items ${fieldDef.max_items} (got ${value.length})`)
        }
        for (let i = 0; i < value.length; i++) {
          const item = value[i]
          if (typeof item !== "string") {
            errors.push(`fields.${name}[${i}]: expected string`)
          } else if (!slugRegex.test(item)) {
            errors.push(`fields.${name}[${i}]: invalid slug format`)
          }
        }
      }
    } else if (type === "ref") {
      if (typeof value !== "string") {
        errors.push(`fields.${name}: expected string for ref, got ${typeof value}`)
      } else {
        const slashIdx = value.indexOf("/")
        const collection = slashIdx >= 0 ? value.slice(0, slashIdx) : ""
        const slug = slashIdx >= 0 ? value.slice(slashIdx + 1) : ""
        if (!collection || !slug || !slugRegex.test(slug)) {
          errors.push(`fields.${name}: invalid ref format (expected collection/slug)`)
        }
      }
    } else if (type === "asset") {
      if (typeof value !== "string") {
        errors.push(`fields.${name}: expected string for asset, got ${typeof value}`)
      }
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors)
  }
}
