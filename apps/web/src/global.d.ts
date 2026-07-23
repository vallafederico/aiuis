/// <reference types="@solidjs/start/env" />

declare module "*.mdx" {
  import type { Component } from "solid-js";
  export const frontmatter: Record<string, unknown>;
  const MDXComponent: Component<{
    components?: Record<string, Component<any>>;
  }>;
  export default MDXComponent;
}

declare module "*.md" {
  import type { Component } from "solid-js";
  export const frontmatter: Record<string, unknown>;
  const MDXComponent: Component<{
    components?: Record<string, Component<any>>;
  }>;
  export default MDXComponent;
}

// declare module "solid-js" {
//   namespace JSX {
//     interface Directives {
//       model: [() => any, (v: any) => any];
//     }
//   }
// }
