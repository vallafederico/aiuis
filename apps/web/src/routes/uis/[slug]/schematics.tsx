import { Show, Suspense } from "solid-js";
import { createAsync } from "@solidjs/router";
import { useParams } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import Metadata from "~/components/Metadata";
import PageContent from "~/components/PageContent";
import { CompPiece } from "~/components/cms/CompPiece";
import { hastToPlainText, type HastNode } from "~/components/cms/hast";
import { getPiece } from "~/lib/piece";
import { resolveUi } from "~/uis/registry";

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

export default function UisSchematics() {
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
            const Ui = resolveUi(p.component);
            return (
              <Show
                when={Ui}
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
                {(Feature) => (
                  <div class="contents">
                    <Metadata
                      title={`${p.title} schematics — aiuis`}
                      description={metaDescription(p)}
                      path={`/uis/${p.slug}/schematics`}
                      type="article"
                      markdown={`/uis/${p.slug}.md`}
                      dateModified={p.updatedIso}
                    />
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
                  </div>
                )}
              </Show>
            );
          }}
        </Show>
      </Show>
    </Show>
  );
}
