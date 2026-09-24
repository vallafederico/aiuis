import { Show, Suspense } from "solid-js";
import { createAsync } from "@solidjs/router";
import { useParams } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import Metadata from "~/components/Metadata";
import PageContent from "~/components/PageContent";
import { CompPiece } from "~/components/cms/CompPiece";
import { extractAside, hastToPlainText, type HastNode } from "~/components/cms/hast";
import { getPiece } from "~/lib/piece";
import { resolveDirectedUi, resolveUi } from "~/uis/registry";

export const route = {
  preload: ({ params }: { params: { slug: string } }) =>
    getPiece(params.slug, "uis"),
};

function metaDescription(piece: {
  excerpt: string;
  title: string;
  body_hast: HastNode | null;
}): string {
  const excerpt = piece.excerpt.trim();
  if (excerpt) {
    return excerpt.length <= 160 ? excerpt : `${excerpt.slice(0, 157).trimEnd()}…`;
  }
  const text = piece.body_hast
    ? hastToPlainText(piece.body_hast).replace(/\s+/g, " ").trim()
    : "";
  if (!text) return piece.title;
  if (text.length <= 160) return text;
  return `${text.slice(0, 157).trimEnd()}…`;
}

function forewordText(body: HastNode | null): string | null {
  const { node } = extractAside(body, "cms-foreword");
  return node ? hastToPlainText(node).trim() || null : null;
}

/** The art-directed component, one click behind the schematic at `/uis/:slug`. */
export default function UisComponent() {
  const params = useParams();
  const data = createAsync(() => getPiece(params.slug, "uis"), { deferStream: true });
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
              <p>Content service is offline.</p>
            </PageContent>
          </>
        }
      >
        <Show
          when={piece() && resolveUi(piece()!.component) ? piece() : null}
          keyed
          fallback={
            <>
              <HttpStatusCode code={404} />
              <PageContent flow>
                <p>Not found.</p>
              </PageContent>
            </>
          }
        >
          {(p) => {
            const Directed = resolveDirectedUi(p.component);
            return (
              <div class="contents">
                <Metadata
                  title={`${p.title} component — aiuis`}
                  description={metaDescription(p)}
                  path={`/uis/${p.slug}/component`}
                  type="article"
                  markdown={`/uis/${p.slug}.md`}
                  dateModified={p.updatedIso}
                />
                <CompPiece
                  title={p.title}
                  body={forewordText(p.body_hast) ?? p.excerpt}
                  tags={p.tags}
                  updated={p.updated}
                  altHref={`/uis/${p.slug}`}
                  altLabel="Schematics"
                >
                  <Show when={Directed} keyed fallback={<div class="uis-stage" />}>
                    {(Feature) => (
                      <Suspense>
                        <Feature slug={p.slug} title={p.title} />
                      </Suspense>
                    )}
                  </Show>
                </CompPiece>
              </div>
            );
          }}
        </Show>
      </Show>
    </Show>
  );
}
