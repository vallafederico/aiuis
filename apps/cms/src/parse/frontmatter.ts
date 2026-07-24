import yaml from "yaml"

export class FrontmatterError extends Error {
  raw: string
  constructor(message: string, raw: string) {
    super(message)
    this.name = "FrontmatterError"
    this.raw = raw
  }
}

export function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  // Split on "---" fences (first two occurrences)
  // The format is: "---\n<yaml>\n---\n<body>"
  // If no frontmatter fences, return empty frontmatter and full content as body
  const firstFence = raw.indexOf("---")
  if (firstFence !== 0) {
    return { frontmatter: {}, body: raw }
  }
  const afterFirst = raw.indexOf("\n", firstFence) + 1
  const secondFence = raw.indexOf("---", afterFirst)
  if (secondFence === -1) {
    return { frontmatter: {}, body: raw }
  }
  const yamlStr = raw.slice(afterFirst, secondFence)
  const afterSecond = raw.indexOf("\n", secondFence)
  const body = afterSecond === -1 ? "" : raw.slice(afterSecond + 1)

  let parsed: unknown
  try {
    parsed = yaml.parse(yamlStr)
  } catch (e) {
    throw new FrontmatterError(`Malformed YAML frontmatter: ${e instanceof Error ? e.message : String(e)}`, raw)
  }

  if (parsed === null || parsed === undefined) {
    return { frontmatter: {}, body }
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FrontmatterError("Frontmatter must be a YAML mapping", raw)
  }

  return { frontmatter: parsed as Record<string, unknown>, body }
}

const YAML_DUMP_OPTIONS = {
  sortKeys: false,
  lineWidth: 0,
  defaultKeyType: null,
  defaultStringType: "PLAIN",
  nullStr: "null",
  falseStr: "false",
  trueStr: "true",
} as const

export function dumpFrontmatter(fm: Record<string, unknown>, body: string): string {
  let yamlStr = yaml.stringify(fm, YAML_DUMP_OPTIONS)
  // yaml.stringify adds a trailing newline; strip it before adding "---\n"
  if (yamlStr.endsWith("\n")) {
    yamlStr = yamlStr.slice(0, -1)
  }
  return "---\n" + yamlStr + "\n---\n" + body
}

export const SYSTEM_FIELDS: readonly string[] = [
  "_id", "_collection", "_status", "_created", "_updated", "_rev", "_author"
]

export function assertNoSystemFields(fm: Record<string, unknown>): void {
  const offenders = Object.keys(fm).filter(k => SYSTEM_FIELDS.includes(k))
  if (offenders.length > 0) {
    throw new Error(`Frontmatter contains system-managed fields: ${offenders.join(", ")}`)
  }
}
