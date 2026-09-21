import { For, Show } from "solid-js";
import { createAsync } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import Metadata from "~/components/Metadata";
import PageContent from "~/components/PageContent";
import MsdfText from "~/components/webgl/MsdfText";
import GlRoundRect from "~/components/webgl/GlRoundRect";
import { SECTION_LABEL, piecePath } from "~/lib/llm-seo";
import { getTagPage } from "~/lib/tags";
import "./CompPiece.css";
import "./TagView.css";

export { getTagPage };

export function TagView(props: { tag: string }) {
  const data = createAsync(() => getTagPage(props.tag), { deferStream: true });
  const page = () => {
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
          when={page()}
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
          {(result) => (
            <>
              <Metadata
                title={`${result.tag} — aiuis`}
                description={`Pieces tagged ${result.tag}.`}
                path={`/data/${encodeURIComponent(result.tag)}`}
              />
              <PageContent flow>
                <div class="tag-page">
                  <p class="uis-meta-label">
                    <MsdfText text="DATA" font="Garara-10" weird />
                  </p>
                  <h1 class="tag-page-title">
                    <span class="uis-tag">
                      <GlRoundRect class="uis-tag-fill" />
                      <MsdfText
                        text={result.tag}
                        font="AlteHaasGroteskBold"
                        tracking={0.32}
                        weird
                      />
                    </span>
                  </h1>
                  <ul class="tag-page-list">
                    <For each={result.pieces}>
                      {(piece) => (
                        <li>
                          <a href={piecePath(piece.section, piece.slug)}>
                            <span class="tag-page-section">
                              <MsdfText
                                text={`${SECTION_LABEL[piece.section].charAt(0)}.`}
                                font="Garara-10"
                                weird
                              />
                            </span>
                            <span class="tag-page-item">
                              <MsdfText
                                text={piece.title}
                                font="AlteHaasGroteskBold"
                                tracking={-0.12}
                                weird
                              />
                            </span>
                          </a>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </PageContent>
            </>
          )}
        </Show>
      </Show>
    </Show>
  );
}
