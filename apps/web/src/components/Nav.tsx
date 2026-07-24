import { A } from "@acme/router";
import { For, Show } from "solid-js";
import MsdfText from "./webgl/MsdfText";
import SdfImage from "./webgl/SdfImage";

/* breadcrumb trail — grows as sections are added; only real routes here */
const NAV_CRUMBS: { to: string; text: string }[] = [
  { to: "/", text: "Index" },
  { to: "/exp/1", text: "Exp 1" },
  { to: "/exp/1/", text: "Index" },
  { to: "/exp/1/", text: "FAQs" },
  { to: "/exp/1/", text: "Index" },
];

// Solid blue per spec: #2200ff = rgb(34, 0, 255) normalized
const BLUE: [number, number, number] = [34 / 255, 0, 1];

function getCrumbAlpha(i: number, total: number): number {
  // current crumb (last) is always 1.0; preceding ones fade
  const fromEnd = total - 1 - i;
  if (fromEnd === 0) return 1.0;
  if (fromEnd === 1) return 0.4;
  return 0.2;
}

export const Nav = () => {
  return (
    <>
      <div class="fixed top-0 right-0 pr-gx py-[3svh]">
        <div class="w-grid-1">
          <SdfImage
            name="logo"
            class="w-full"
            //   blur={{ radius: 24, angle: 180, from: 0.2 }}
          />
        </div>
      </div>
      <nav
        class="flex fixed top-0 left-0 flex-col h-lvh pl-gx"
      >
        <div
          class="flex flex-col justify-between h-full
            w-grid-2 py-[3svh]"
        >
          <Breadcrumbs items={NAV_CRUMBS} />
          <div class="flex flex-col">
            <div>
              <SdfImage
                name="logotype"
                class="w-full"
                blur={{ radius: 24, angle: 180, from: 0.2 }}
              />
            </div>
            <div class="flex flex-col gap-4">
              <ListBlock
                title="Preface"
                items={[
                  {
                    title: "Foreword",
                    href: "/",
                  },
                  {
                    title: "Credits",
                    href: "/",
                  },
                ]}
              />
              <ListBlock
                title="Foundations"
                items={[
                  {
                    title: "Representing Thinking",
                    href: "/",
                  },
                  {
                    title: "Styleguides",
                    href: "/",
                  },
                  {
                    title: "Principles",
                    href: "/",
                  },
                  {
                    title: "Interactions",
                    href: "/",
                  },
                ]}
              />
              <ListBlock
                title="UIs"
                items={[
                  {
                    title: "FAQs",
                    href: "/",
                  },
                  {
                    title: "Infinite Article",
                    href: "/",
                  },
                  {
                    title: "Navigation",
                    href: "/",
                  },
                  {
                    title: "Images",
                    href: "/",
                  },
                  {
                    title: "Bot",
                    href: "/",
                  },
                  {
                    title: "Look At",
                    href: "/",
                  },
                  {
                    title: "Image Generation",
                    href: "/",
                  },
                ]}
              />
            </div>
          </div>
          <div
            class="w-full tracking-wider font-garara
              flex-center"
          >
            <span class="font-[0]">0</span>
            <span class="font-[10]">0</span>
            <span class="font-[10]">2</span>
          </div>
        </div>
      </nav>
    </>
  );
};

const ListBlock = ({
  title,
  items,
}: {
  title: string;
  items: {
    title: string;
    href: string;
  }[];
}) => {
  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-center">
        <p class="w-10 font-[10] tracking-wider font-garara">
          {title.charAt(0).toUpperCase()}.
        </p>
        <h2 class="text-2xl -tracking-widest">{title}</h2>
      </div>
      <ul>
        <For each={items}>
          {(item, index) => (
            <ListItem
              number={String(index() + 1)}
              title={item.title}
              href={item.href}
            />
          )}
        </For>
      </ul>
    </div>
  );
};

const ListItem = ({
  number,
  title,
  href,
}: {
  number: string;
  title: string;
  href: string;
}) => {
  return (
    <li class="flex items-center">
      <p class="w-15 text-[.7em] font-garara font-[10]">
        {number}.
      </p>
      <a href={href}>{title}</a>
    </li>
  );
};

const Breadcrumbs = ({
  items,
}: {
  items: { to: string; text: string }[];
}) => {
  return (
    <div
      class="flex overflow-visible flex-nowrap justify-end
        whitespace-nowrap w-grids-2 pr-grid-1"
    >
      <For each={NAV_CRUMBS}>
        {(crumb, index) => (
          <>
            <a
              href={crumb.to}
              class="text-sm"
            >
              {crumb.text}
            </a>
            <Show when={index() < items.length - 1}>
              <span class="px-2 text-sm">/</span>
            </Show>
          </>
        )}
      </For>
    </div>
  );
};
