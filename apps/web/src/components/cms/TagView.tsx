import { For, Show } from "solid-js";
import { createAsync } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import Metadata from "~/components/Metadata";
import PageContent from "~/components/PageContent";
import { NavHit, NavHitText } from "~/components/NavHit";
import MsdfText from "~/components/webgl/MsdfText";
import GlRoundRect from "~/components/webgl/GlRoundRect";
import { SECTION_LABEL, piecePath } from "~/lib/piece-sections";
import { getTagPage } from "~/lib/tags";
import { tagPath } from "~/uis/meta";
import "./CompPiece.css";
import "./TagView.css";

export { getTagPage };

export default function TagView(props: { tag: string }) {
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
                title={`${result.label} — aiuis`}
                description={`Pieces tagged ${result.label}.`}
                path={tagPath(result.tag)}
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
                        text={result.label}
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
                          <NavHit class="nav-hit" href={piecePath(piece.section, piece.slug)}>
                            <span class="tag-page-section">
                              <NavHitText
                                text={`${SECTION_LABEL[piece.section].charAt(0)}.`}
                                font="Garara-10"
                              />
                            </span>
                            <span class="tag-page-item">
                              <NavHitText
                                text={piece.title}
                                font="AlteHaasGroteskBold"
                                tracking={-0.12}
                              />
                            </span>
                          </NavHit>
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
