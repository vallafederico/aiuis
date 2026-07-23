import { Title } from "@solidjs/meta";
import { HttpStatusCode } from "@solidjs/start";
import { A, useLocation } from "@solidjs/router";
import { Show } from "solid-js";
import { MDXContent, PageMeta } from "@local/content/solid";
import Section from "~/components/Section";
import { mdxComponents } from "~/components/content/mdx";
import { getPage } from "~/content";

// cms-only pages land here: a path with no route file renders its matching
// document from src/content/pages with the default layout, else 404
export default function CatchAll() {
  const location = useLocation();
  const page = () => getPage(location.pathname);

  return (
    <Show when={page()} keyed fallback={<NotFound />}>
      {(entry) => (
        <div class="min-h-[100vh] py-20">
          <PageMeta data={entry.data} />

          <Section class="px-gx">
            <article class="flex max-w-[65ch] flex-col gap-4">
              <MDXContent entry={entry} components={mdxComponents} />
            </article>
          </Section>
        </div>
      )}
    </Show>
  );
}

const NotFound = () => (
  <div class="flex-center h-screen">
    <Title>Not Found</Title>
    <HttpStatusCode code={404} />

    <div class="flex flex-col gap-2">
      <h1>Page not found</h1>

      <A href="/">Back to website</A>
    </div>
  </div>
);
