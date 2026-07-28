// Minimal hast node types for the subset the CMS derive pipeline emits
// (see apps/cms/src/derive/pipeline.ts) — root/element/text/comment only.

export type HastProperties = Record<string, string | number | boolean | string[] | undefined>;

export type HastText = { type: "text"; value: string };
export type HastComment = { type: "comment"; value: string };
export type HastElement = {
  type: "element";
  tagName: string;
  properties?: HastProperties;
  children: HastNode[];
};
export type HastRoot = { type: "root"; children: HastNode[] };

export type HastNode = HastRoot | HastElement | HastText | HastComment;

export function hastChildren(node: HastNode): HastNode[] {
  return "children" in node ? node.children : [];
}

export function hastToPlainText(node: HastNode): string {
  if (node.type === "text") return node.value;
  if (node.type === "comment") return "";
  return hastChildren(node).map(hastToPlainText).join("");
}

export function hastClassNames(node: HastElement): string[] {
  const cls = node.properties?.className;
  if (Array.isArray(cls)) return cls.map(String);
  if (typeof cls === "string") return cls.split(/\s+/).filter(Boolean);
  return [];
}

export function hastHasClass(node: HastElement, name: string): boolean {
  return hastClassNames(node).includes(name);
}

/** Skip whitespace-only text nodes (line-break padding between block siblings). */
export function isMeaningfulNode(node: HastNode): boolean {
  if (node.type === "comment") return false;
  if (node.type === "text") return node.value.trim().length > 0;
  return true;
}
