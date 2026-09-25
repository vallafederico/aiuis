import { For, Show } from "solid-js";
import { createAsync } from "@solidjs/router";
import Metadata from "~/components/Metadata";
import PageContent from "~/components/PageContent";
import MsdfText from "~/components/webgl/MsdfText";
import SdfImage from "~/components/webgl/SdfImage";
import { NavHit, NavHitText } from "~/components/NavHit";
import { getNavCatalog, sectionByHref } from "~/lib/sections";
import "./SectionIndex.css";

/** SDF marks in public/msdf, from src/assets/msdf/svg/section-*.svg. */
const SECTION_ICON: Record<string, string> = {
  "/preface": "section-preface",
  "/foundations": "section-foundations",
  "/uis": "section-uis",
};

export default function SectionIndex(props: { href: string }) {
  const catalog = createAsync(() => getNavCatalog(), { deferStream: true });
  const section = () => {
    const sections = catalog();
    if (!sections) return undefined;
    return sectionByHref(sections, props.href);
  };
  return (
    <>
      <Metadata
        title={`${section()?.title ?? "aiuis"} — aiuis`}
        description={`${section()?.title ?? "Section"} chapters.`}
        path={props.href}
      />
      <PageContent flow width="w-full">
        <div class="section-index flex flex-col gap-4">
          <h1 class="flex items-center text-2xl -tracking-widest">
            <span class="flex w-15 shrink-0 items-center" aria-hidden="true">
              <Show when={SECTION_ICON[props.href]}>
                {(name) => <SdfImage name={name()} class="section-index-icon" />}
              </Show>
            </span>
            <MsdfText
              text={section()?.title ?? ""}
              font="AlteHaasGroteskBold"
              tracking={-0.12}
              weird
            />
          </h1>
          <ul>
            <For each={section()?.items ?? []}>
              {(item, index) => (
                <li class="flex items-center">
                  <NavHit href={item.href} class="relative inline-flex items-center min-h-6 min-w-6 nav-hit">
                    <span class="w-15 shrink-0 text-[.7em] font-garara font-[10]">
                      <NavHitText text={`${index() + 1}.`} font="Garara-10" />
                    </span>
                    <NavHitText text={item.title} font="AlteHaasGroteskBold" />
                  </NavHit>
                </li>
              )}
            </For>
          </ul>
        </div>
      </PageContent>
    </>
  );
}
