declare module "solid-js" {
  namespace JSX {
    interface Directives {
      webgl: [() => any, (v: any) => any];
      scroll: [() => any, (v: any) => any];
    }
  }
}

declare module "*.wgsl" {
  const shader: Readonly<{ fragment: string; fragmentGlsl: string }>;
  export const fragment: string;
  export const fragmentGlsl: string;
  export default shader;
}
