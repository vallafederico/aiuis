import { Show } from "solid-js";
import { createAsync, query } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import PageContent from "~/components/PageContent";
import { cmsGet } from "~/lib/cms";
import "./PieceView.css";

type PieceResult =
  | {
      slug: string;
      section: string;
      body_html: string;
      title: string;
    }
  | { unavailable: true }
  | null;

// Parses YAML frontmatter from a markdown string to extract a named field
function extractFrontmatterField(md: string, field: string): string | null {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fieldMatch = match[1].match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return fieldMatch ? fieldMatch[1].trim() : null;
}

export const getPiece = query(
  async (slug: string, expectedSection: string): Promise<PieceResult> => {
    "use server";
    try {
      const [html, md] = await Promise.all([
        cmsGet<string>(`/api/v1/pieces/${slug}?format=html`),
        cmsGet<string>(`/api/v1/pieces/${slug}?format=md`),
      ]);

      const section = extractFrontmatterField(md, "section");
      if (!section || section !== expectedSection) return null;

      const title = extractFrontmatterField(md, "title") ?? slug;

      return { slug, section, body_html: html, title };
    } catch (e: unknown) {
      const status =
        e instanceof Error && "status" in e
          ? (e as { status: number }).status
          : undefined;
      if (status === 404) return null;
      if (status === 503) return { unavailable: true };
      throw e;
    }
  },
  "piece"
);

export function PieceView(props: {
  slug: string;
  section: string;
  /* grid width for the piece body — passed through to PageContent */
  width?: string;
}) {
  const data = createAsync(() => getPiece(props.slug, props.section));
  const piece = () => {
    const d = data();
    return d && !("unavailable" in d) ? d : null;
  };
  const unavailable = () => {
    const d = data();
    return !!d && "unavailable" in d;
  };

  return (
    <Show when={data() !== undefined}>
      <Show
        when={!unavailable()}
        fallback={
          <>
            <HttpStatusCode code={503} />
            <PageContent flow>
              <p>Content service is offline — start it with `pnpm cms`.</p>
            </PageContent>
          </>
        }
      >
        <Show
          when={piece()}
          fallback={
            <>
              <HttpStatusCode code={404} />
              <PageContent flow>
                <p>Not found.</p>
              </PageContent>
            </>
          }
        >
          {(p) => (
            <PageContent flow width={props.width}>
              <h1 class="text-3xl -tracking-widest mb-8">{p().title}</h1>
              <article
                class="prose prose-neutral max-w-none"
                innerHTML={p().body_html}
              />
            </PageContent>
          )}
        </Show>
      </Show>
    </Show>
  );
}
