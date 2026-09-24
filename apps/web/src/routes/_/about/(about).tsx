import { ContentProvider, Slot } from "@local/content/solid";
import * as content from "~/content";
import { mdxComponents } from "~/components/content/mdx";
import { animateAlpha } from "~/animation/alpha";
import Section from "~/components/Section";
import GridExample from "~/components/GridExample";

import { useWindowResize } from "~/lib/hooks/useWindowResize";

export default function About() {
  useWindowResize(({ height, width }) => {
    console.log("hello!", height, width);
  });

  return (
    <div class="pt-navh min-h-[100vh]">
      <Section class="py-20 px-gx">
        <h1>About</h1>

        {/* head metadata + body from content/pages/_/about.mdx — same name
            in the cms and in the router */}
        {/* Provided here, not at the app root: the content module bundles every
            local MDX page, and only this route resolves one by path. */}
        <ContentProvider content={content} components={mdxComponents}>
          <article class="mt-8 flex max-w-[65ch] flex-col gap-4">
            <Slot />
          </article>
        </ContentProvider>
      </Section>

      <GridExample />

      <Section class="flex-center px-gx h-[80svh] w-full">
        <h1 use:animateAlpha>Two</h1>
      </Section>
      <Section class="flex-center px-gx h-[80svh] w-full">
        <h1 use:animateAlpha>Last</h1>
      </Section>
    </div>
  );
}
