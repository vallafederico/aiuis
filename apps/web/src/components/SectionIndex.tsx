import { For } from "solid-js";
import { A } from "@acme/router";
import Metadata from "~/components/Metadata";
import PageContent from "~/components/PageContent";
import MsdfText from "~/components/webgl/MsdfText";
import { sectionByHref } from "~/lib/sections";
import "./SectionIndex.css";

export default function SectionIndex(props: { href: string }) {
  const section = () => sectionByHref(props.href);
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
            <span class="w-15" aria-hidden="true" />
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
                  <p class="w-15 text-[.7em] font-garara font-[10]">
                    <MsdfText text={`${index() + 1}.`} font="Garara-10" weird />
                  </p>
                  <A href={item.href}>
                    <MsdfText text={item.title} font="AlteHaasGroteskBold" weird />
                  </A>
                </li>
              )}
            </For>
          </ul>
        </div>
      </PageContent>
    </>
  );
}
