import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import yaml from "yaml";

const SEEDS_DIR = join(import.meta.dirname, "..", "seeds");
const VALID_KINDS = new Set(["schema", "slice_schema", "taxonomy", "skill"]);

function collectSeedFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectSeedFiles(full));
    } else if (entry.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

function extractFrontmatter(content: string): string | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

// Norway-problem check: yaml core schema must parse "yes" as string, not boolean
describe("yaml Norway-problem check", () => {
  it('parses "yes" as the string "yes", not boolean true', () => {
    // yaml v2 uses YAML 1.2 core schema by default — "yes" is a string
    const result = yaml.parse("value: yes");
    expect(result.value).toBe("yes");
    expect(typeof result.value).toBe("string");
  });
});

describe("seed files", () => {
  const seedFiles = collectSeedFiles(SEEDS_DIR);

  it("finds at least one seed file", () => {
    expect(seedFiles.length).toBeGreaterThan(0);
  });

  for (const filePath of seedFiles) {
    const relativePath = filePath.replace(SEEDS_DIR + "/", "");

    describe(relativePath, () => {
      const content = readFileSync(filePath, "utf-8");
      const rawFrontmatter = extractFrontmatter(content);

      it("has frontmatter", () => {
        expect(rawFrontmatter).not.toBeNull();
      });

      it("frontmatter parses as valid YAML without error", () => {
        expect(() => yaml.parse(rawFrontmatter!)).not.toThrow();
      });

      it("_kind is a valid value", () => {
        const fm = yaml.parse(rawFrontmatter!);
        expect(VALID_KINDS.has(fm._kind)).toBe(true);
      });
    });
  }
});
