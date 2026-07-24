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

      <Section
        class="flex flex-col gap-16 h-screen flex-center
          px-gx"
      >
        <MsdfText
          text="aiuis"
          font="Garara"
          class="w-[70vw]"
          fitWidth
        />
        <MsdfText
          text={"msdf text\ntype controls"}
          font="AlteHaasGroteskBold"
          fontSize={100}
        />
      </Section>
      <Section
        class="flex gap-16 h-screen flex-center px-gx"
      >
        <SdfImage
          name="logo"
          class="w-[14vw]"
        />
        <SdfImage
          name="logotype"
          class="w-[30vw]"
          blur={{ radius: 24, angle: 180, from: 0.2 }}
        />
        <GlItem
          class="size-[40vmin]"
          options={{ shaders: { fragment: uvFragment } }}
        />
      </Section>
    </div>
  );
}
