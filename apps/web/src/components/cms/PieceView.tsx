import { Show, Suspense } from "solid-js";
import { createAsync, query } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import Metadata from "~/components/Metadata";
import PageContent from "~/components/PageContent";
import CmsMsdfBlock from "~/components/cms/CmsMsdfBlock";
import { CmsBody, CmsForeword } from "~/components/cms/CmsBody";
import { CompPiece } from "~/components/cms/CompPiece";
import { extractAside, hastToPlainText, type HastNode } from "~/components/cms/hast";
import { cms, cmsStatus, siteSection } from "~/lib/cms";
import { formatUpdated, labelsFromCms, tagsFor, tagsFromMarkdown } from "~/uis/meta";
import { resolveUi, resolveUiName } from "~/uis/registry";
import "./PieceView.css";

type PieceResult =
  | {
      slug: string;
      section: string;
      body_hast: HastNode | null;
      title: string;
      excerpt: string;
      component: string | null;
      tags: string[];
      updated: string | null;
    }
  | { unavailable: true }
  | null;

async function publishedMeta(slug: string): Promise<{
  updated: string | null;
  tags: unknown;
}> {
  try {
    const list = await cms().listCollection("pieces");
    const item = list.items.find((entry) => entry.slug === slug);
    return {
      updated: formatUpdated(item?.updated),
      tags: item?.card?.tags,
    };
  } catch {
    return { updated: null, tags: undefined };
  }
}

export const getPiece = query(
  async (slug: string, expectedSection: string): Promise<PieceResult> => {
    "use server";
    try {
      const data = await cms().getDoc("pieces", slug, { format: "json" });
      const section =
        typeof data.section === "string" ? siteSection(data.section) : null;
      if (!section || section !== expectedSection) return null;
      const title = typeof data.title === "string" && data.title ? data.title : slug;
      const body_hast = (data.body_hast as HastNode | undefined) ?? null;
      const excerpt = typeof data.excerpt === "string" ? data.excerpt : "";
      const component = resolveUiName(
        (data as { component?: unknown }).component,
        slug,
        section,
      );
      const published = component ? await publishedMeta(slug) : { updated: null, tags: undefined };
      let cmsTags: unknown = (data as { tags?: unknown }).tags ?? published.tags;
      if (component && labelsFromCms(cmsTags).length === 0) {
        try {
          const markdown = await cms().getDoc("pieces", slug, { format: "md" });
          if (typeof markdown === "string") cmsTags = tagsFromMarkdown(markdown);
        } catch {
          /* derive JSON omits extra fields; markdown is best-effort */
        }
      }
      const tags = tagsFor(slug, cmsTags);
      return {
        slug,
        section,
        body_hast,
        title,
        excerpt,
        component,
        tags,
        updated: published.updated,
      };
    } catch (e: unknown) {
      const status = cmsStatus(e);
      if (status === 404) return null;
      if (status === 503) return { unavailable: true };
      throw e;
    }
  },
  "piece"
);

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

export function PieceView(props: {
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
            const extracted = () => extractAside(p().body_hast, "cms-foreword");
            const foreword = () => extracted().node;
            const bodyWithoutForeword = () => extracted().rest;
            const Ui = () => resolveUi(p().component);
            return (
              <div class="contents">
                <Metadata
                  title={`${p().title} — aiuis`}
                  description={metaDescription(p())}
                />
                <Show
                  when={Ui()}
                  fallback={
                    <PageContent flow width={props.width}>
                      <h1 class="mb-8">
                        <CmsMsdfBlock text={p().title} class="text-6xl -tracking-widest" />
                      </h1>
                      <Show when={foreword()}>
                        {(node) => (
                          <div class="cms-foreword-wrap mb-8 w-grids-5">
                            <CmsForeword node={node()} />
                          </div>
                        )}
                      </Show>
                      <article class="cms-body max-w-none text-[2rem] leading-snug">
                        <CmsBody hast={bodyWithoutForeword()} />
                      </article>
                    </PageContent>
                  }
                >
                  {(Comp) => {
                    const Feature = Comp();
                    return (
                      <CompPiece
                        title={p().title}
                        body={p().excerpt}
                        tags={p().tags}
                        updated={p().updated}
                      >
                        <Suspense>
                          <Feature slug={p().slug} title={p().title} />
                        </Suspense>
                      </CompPiece>
                    );
                  }}
                </Show>
              </div>
            );
          }}
        </Show>
      </Show>
    </Show>
  );
}
