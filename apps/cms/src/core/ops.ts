import { parseFrontmatter, dumpFrontmatter, SYSTEM_FIELDS } from "../parse/frontmatter.js"

export type EditOp =
  | { op: "str_replace"; old: string; new: string }
  | { op: "append"; text: string }
  | { op: "set_field"; field: string; value: unknown }
  | { op: "delete_field"; field: string }

export class OpsError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = "OpsError"
    this.code = code
  }
}

export function applyEdits(raw: string, ops: EditOp[]): { frontmatter: Record<string, unknown>; body: string; raw: string } {
  // Parse the document first
  const { frontmatter: originalFm, body: originalBody } = parseFrontmatter(raw)

  // Work on mutable copies
  let currentFm: Record<string, unknown> = { ...originalFm }
  let currentBody: string = originalBody

  // Apply all ops; if any throw, propagate immediately (all-or-none semantics)
  for (const op of ops) {
    if (op.op === "str_replace") {
      // Count matches in body only
      let count = 0
      let pos = 0
      while (true) {
        const idx = currentBody.indexOf(op.old, pos)
        if (idx === -1) break
        count++
        pos = idx + 1
      }
      if (count === 0) {
        throw new OpsError("str_replace: no match for old text", "str_replace_miss")
      }
      if (count > 1) {
        throw new OpsError(`str_replace: ambiguous — found ${count} matches`, "str_replace_miss")
      }
      currentBody = currentBody.replace(op.old, op.new)
    } else if (op.op === "append") {
      if (currentBody.length > 0 && !currentBody.endsWith("\n")) {
        currentBody += "\n"
      }
      currentBody += op.text
    } else if (op.op === "set_field") {
      if ((SYSTEM_FIELDS as readonly string[]).includes(op.field)) {
        throw new OpsError(`cannot set system field ${op.field}`, "system_field_violation")
      }
      currentFm = { ...currentFm, [op.field]: op.value }
    } else if (op.op === "delete_field") {
      if ((SYSTEM_FIELDS as readonly string[]).includes(op.field)) {
        throw new OpsError(`cannot set system field ${op.field}`, "system_field_violation")
      }
      const newFm = { ...currentFm }
      delete newFm[op.field]
      currentFm = newFm
    }
  }

  const newRaw = dumpFrontmatter(currentFm, currentBody)
  return { frontmatter: currentFm, body: currentBody, raw: newRaw }
}
