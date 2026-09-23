import { For, Show, createMemo } from "solid-js";
import { createAsync } from "@solidjs/router";
import { A, usePreloadRoute } from "@acme/router";
import Metadata from "~/components/Metadata";
import PageContent from "~/components/PageContent";
import MsdfText from "~/components/webgl/MsdfText";
import GlDot from "~/components/webgl/GlDot";
import { createWipe } from "~/components/NavHit";
import { getNavCatalog, type NavItem } from "~/lib/sections";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const GARARA_FONTS = [
  "Garara",
  "Garara-0",
  "Garara-10",
] as const;
const GARARA_COUNT = 5;
const GARARA_INDICES = new Set(
  [...ALPHABET.keys()]
    .sort(() => Math.random() - 0.5)
    .slice(0, GARARA_COUNT),
);
const FONT_BY_INDEX = ALPHABET.map((_, i) =>
  GARARA_INDICES.has(i)
    ? (GARARA_FONTS[
        Math.floor(Math.random() * GARARA_FONTS.length)
      ] ?? "Garara")
    : "AlteHaasGroteskBold",
);

/** Stable cell for each UI, so the same piece always owns the same letter. */
function dotCells(items: NavItem[]): Map<number, NavItem> {
  const used = new Set<number>();
  const cells = new Map<number, NavItem>();
  for (const item of items) {
    let hash = 0;
    for (let i = 0; i < item.href.length; i++) {
      hash = (hash * 31 + item.href.charCodeAt(i)) >>> 0;
    }
    let index = hash % ALPHABET.length;
    while (used.has(index)) index = (index + 1) % ALPHABET.length;
    used.add(index);
    cells.set(index, item);
  }
  return cells;
}

function DotCell(props: { item: NavItem; letter: string; font: string }) {
  const preload = usePreloadRoute();
  const motion = createWipe(220);
  return (
    <A
      href={props.item.href}
      aria-label={props.item.title}
      class="flex h-full w-full items-center justify-center"
      onPointerEnter={() => {
        motion.enter();
        preload(props.item.href, { preloadData: true });
      }}
      onPointerLeave={() => motion.leave()}
      onFocusIn={() => motion.enter()}
      onFocusOut={() => motion.leave()}
    >
      <GlDot show grow={motion.wipe()}>
        <span aria-hidden="true">
          <MsdfText
            text={props.letter}
            font={props.font}
            class="text-[clamp(0.75rem,1.5vw,1.1rem)]"
          />
        </span>
      </GlDot>
    </A>
  );
}

export default function Home() {
  const catalog = createAsync(() => getNavCatalog());
  const cells = createMemo(() => {
    const uis = catalog()?.find((section) => section.href === "/uis")?.items ?? [];
    return dotCells(uis);
  });

  return (
    <>
      <Metadata
        title="aiuis"
        description="Working notes on designing interfaces for systems that think back."
        path="/"
      />
      <h1 sr-only>aiuis</h1>
      <PageContent>
        <div class="flex justify-center">
          <div class="grid grid-cols-6 gap-gutter w-grids-6">
            <For each={ALPHABET}>
              {(letter, i) => (
                <div class="aspect-square">
                  <Show
                    when={cells().get(i())}
                    fallback={
                      <div class="flex h-full w-full items-center justify-center">
                        <MsdfText
                          text={letter}
                          font={FONT_BY_INDEX[i()]}
                          class="text-[clamp(0.75rem,1.5vw,1.1rem)]"
                        />
                      </div>
                    }
                  >
                    {(item) => (
                      <DotCell item={item()} letter={letter} font={FONT_BY_INDEX[i()]} />
                    )}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </PageContent>
    </>
  );
}
