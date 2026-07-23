import { Title } from "@solidjs/meta";
import Section from "../../../components/Section";

import GlItem from "~/components/webgl/GlItem";
import MsdfText from "~/components/webgl/MsdfText";
import SdfImage from "~/components/webgl/SdfImage";

// wgsl-flavoured fragment, converted to glsl by @ssscript/webgl
const uvFragment = `@fragment
fn fsMain(in: VertexOut) -> @location(0) vec4f {
  return vec4f(in.uv, 0.0, 1.0);
}`;

export default function WebGl() {
  return (
    <div class="min-h-[100vh]">
      <Title>WebGL</Title>

      <Section class="flex-center px-gx flex h-screen flex-col gap-16">
        <MsdfText text="aiuis" font="Garara" class="w-[70vw]" />
        <MsdfText
          text={"msdf text\ntype controls"}
          font="AlteHaasGroteskBold"
          fontSize={100}
          tracking={0.02}
          lineHeight={0.95}
        />
      </Section>
      <Section class="flex-center px-gx flex h-screen gap-16">
        <SdfImage name="logo" class="w-[14vw]" />
        <SdfImage name="logotype" class="w-[30vw]" />
        <GlItem
          class="size-[40vmin]"
          options={{ shaders: { fragment: uvFragment } }}
        />
      </Section>
    </div>
  );
}
