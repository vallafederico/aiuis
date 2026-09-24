import { uis } from "~/uis/registry";

/** UI piece routes (schematic, component, schematics) for the prev/next dock. */
export function isComponentPath(path: string) {
  const n = path.replace(/\/+$/, "") || "/";
  const match = n.match(/^\/uis\/([^/]+)(?:\/component|\/schematics)?$/);
  return !!match && !!uis[match[1]!];
}
