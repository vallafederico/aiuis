import { Show, Suspense } from "solid-js";
import { createAsync } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import Metadata from "~/components/Metadata";
import { ArticleFocus } from "~/components/ArticleFocus";
import PageContent from "~/components/PageContent";
import CmsMsdfBlock from "~/components/cms/CmsMsdfBlock";
import { CmsBody, CmsForeword } from "~/components/cms/CmsBody";
import { CompPiece } from "~/components/cms/CompPiece";
import { extractAside, hastToPlainText, type HastNode } from "~/components/cms/hast";
import { liftKnownAsides } from "~/lib/article-asides";
import { getPiece } from "~/lib/piece";
import { resolveUi } from "~/uis/registry";
import "./PieceView.css";

export { getPiece } from "~/lib/piece";

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

export default function PieceView(props: {
  slug: string;
  section: string;
  /* grid width for the piece body — passed through to PageContent */
  width?: string;
}) {
  const data = createAsync(() => getPiece(props.slug, props.section), { deferStream: true });
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
          when={piece()}
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
            const extracted = extractAside(liftKnownAsides(p.body_hast), "cms-foreword");
            const Ui = resolveUi(p.component);
            return (
              <div class="contents">
                <Metadata
                  title={`${p.title} — aiuis`}
                  description={metaDescription(p)}
                  path={`/${p.section}/${p.slug}`}
                  type="article"
                  markdown={`/${p.section}/${p.slug}.md`}
                  dateModified={p.updatedIso}
                />
                <Show
                  when={Ui}
                  keyed
                  fallback={
                    <PageContent flow width={props.width}>
                      <ArticleFocus>
                        <h1 class="mb-8">
                          <CmsMsdfBlock text={p.title} class="text-6xl -tracking-widest" />
                        </h1>
                        <Show when={extracted.node}>
                          {(node) => (
                            <div class="cms-foreword-wrap mb-8 w-grids-4">
                              <CmsForeword node={node()} />
                            </div>
                          )}
                        </Show>
                        <article class="cms-body max-w-none text-[2rem] leading-snug">
                          <CmsBody hast={extracted.rest} />
                        </article>
                      </ArticleFocus>
                    </PageContent>
                  }
                >
                  {(Feature) => (
                    <CompPiece
                      title={p.title}
                      body={p.excerpt}
                      tags={p.tags}
                      updated={p.updated}
                    >
                      <Suspense>
                        <Feature slug={p.slug} title={p.title} />
                      </Suspense>
                    </CompPiece>
                  )}
                </Show>
              </div>
            );
          }}
        </Show>
      </Show>
    </Show>
  );
}
