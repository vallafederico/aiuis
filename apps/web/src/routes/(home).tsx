import { For } from "solid-js";
import Metadata from "~/components/Metadata";
import PageContent from "~/components/PageContent";
import MsdfText from "~/components/webgl/MsdfText";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const GARARA_FONTS = ["Garara", "Garara-0", "Garara-10"] as const;
const GARARA_COUNT = 5;
const GARARA_INDICES = new Set(
  [...ALPHABET.keys()]
    .sort(() => Math.random() - 0.5)
    .slice(0, GARARA_COUNT),
);
const FONT_BY_INDEX = ALPHABET.map((_, i) =>
  GARARA_INDICES.has(i)
    ? GARARA_FONTS[Math.floor(Math.random() * GARARA_FONTS.length)]!
    : "AlteHaasGroteskBold",
);

export default function Home() {
  return (
    <>
      <Metadata
        title="aiuis"
        description="aiuis"
      />
      <PageContent>
        <div class="flex justify-center">
          <div class="grid grid-cols-6 gap-gutter w-grids-6">
            <For each={ALPHABET}>
              {(letter, i) => (
                <div class="aspect-square flex-center">
                  <MsdfText
                    text={letter}
                    font={FONT_BY_INDEX[i()]}
                    class="text-[clamp(0.75rem,1.5vw,1.1rem)]"
                  />
                </div>
              )}
            </For>
          </div>
        </div>
      </PageContent>
    </>
  );
}
