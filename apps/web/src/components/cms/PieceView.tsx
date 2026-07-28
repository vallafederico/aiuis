import { Show } from "solid-js";
import { createAsync, query } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import PageContent from "~/components/PageContent";
import CmsMsdfBlock from "~/components/cms/CmsMsdfBlock";
import { CmsBody } from "~/components/cms/CmsBody";
import type { HastNode } from "~/components/cms/hast";
import { cmsGet } from "~/lib/cms";
import "./PieceView.css";

type PieceResult =
  | {
      slug: string;
      section: string;
      body_hast: HastNode | null;
      title: string;
    }
  | { unavailable: true }
  | null;

export const getPiece = query(
  async (slug: string, expectedSection: string): Promise<PieceResult> => {
    "use server";
    try {
      const data = await cmsGet<Record<string, unknown>>(`/api/v1/pieces/${slug}?format=json`);
      const section = typeof data.section === "string" ? data.section : null;
      if (!section || section !== expectedSection) return null;
      const title = typeof data.title === "string" && data.title ? data.title : slug;
      const body_hast = (data.body_hast as HastNode | undefined) ?? null;
      return { slug, section, body_hast, title };
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
              <h1 class="mb-8">
                <CmsMsdfBlock text={p().title} class="text-6xl -tracking-widest" />
              </h1>
              <article class="cms-body max-w-none text-[2rem] leading-snug">
                <CmsBody hast={p().body_hast} />
              </article>
            </PageContent>
          )}
        </Show>
      </Show>
    </Show>
  );
}
