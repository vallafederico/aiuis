import { Show } from "solid-js";
import { createAsync, query } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import { cmsGet } from "~/lib/cms";

type PieceResult = {
  slug: string;
  section: string;
  body_html: string;
  title: string;
} | null;

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
      if (
        e instanceof Error &&
        "status" in e &&
        (e as { status: number }).status === 404
      )
        return null;
      throw e;
    }
  },
  "piece"
);

export function PieceView(props: { slug: string; section: string }) {
  const data = createAsync(() => getPiece(props.slug, props.section));

  return (
    <Show when={data() !== undefined}>
      <Show
        when={data()}
        fallback={
          <>
            <HttpStatusCode code={404} />
            <div class="px-gx py-20">
              <p>Not found.</p>
            </div>
          </>
        }
      >
        {(piece) => (
          <div class="px-gx py-20 max-w-[65ch]">
            <h1 class="text-3xl -tracking-widest mb-8">{piece().title}</h1>
            <article
              class="prose prose-neutral max-w-none"
              innerHTML={piece().body_html}
            />
          </div>
        )}
      </Show>
    </Show>
  );
}
