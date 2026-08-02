import { For, Show } from "solid-js";
import MsdfText from "./webgl/MsdfText";
import SdfImage from "./webgl/SdfImage";

/* breadcrumb trail — grows as sections are added; only real routes here */
const NAV_CRUMBS: { to: string; text: string }[] = [
  { to: "/", text: "Index" },
  { to: "/exp/1", text: "Exp 1" },
  { to: "/exp/1/", text: "Index" },
  { to: "/exp/1/", text: "Displaying Thinking" },
  { to: "/exp/1/", text: "Index" },
];

// function getCrumbAlpha(i: number, total: number): number {
//   // current crumb (last) is always 1.0; preceding ones fade
//   const fromEnd = total - 1 - i;
//   if (fromEnd === 0) return 1.0;
//   if (fromEnd === 1) return 0.4;
//   return 0.2;
// }

export const Nav = () => {
  return (
    <>
      <div class="fixed top-0 right-0 pr-gx py-[3svh]">
        <div class="w-grid-1">
          <a href="/">
            <SdfImage
              name="logo"
              class="w-full"
              //   blur={{ radius: 24, angle: 180, from: 0.2 }}
            />
          </a>
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
              <a href="/">
                <SdfImage name="logotype" class="w-full" />
              </a>
            </div>
            <div class="flex flex-col gap-4">
              <ListBlock
                title="Preface"
                items={[
                  {
                    title: "Foreword",
                    href: "/preface/foreword",
                  },
                  {
                    title: "Credits",
                    href: "/preface/credits",
                  },
                ]}
              />
              <ListBlock
                title="Foundations"
                items={[
                  {
                    title: "Representing Thinking",
                    href: "/foundations/representing-thinking",
                  },
                  {
                    title: "Styleguides",
                    href: "/foundations/styleguides",
                  },
                  {
                    title: "Principles",
                    href: "/foundations/principles",
                  },
                  {
                    title: "Interactions",
                    href: "/foundations/interactions",
                  },
                ]}
              />
              <ListBlock
                title="UIs"
                items={[
                  {
                    title: "FAQs",
                    href: "/uis/faqs",
                  },
                  {
                    title: "Infinite Article",
                    href: "/uis/infinite-article",
                  },
                  {
                    title: "Navigation",
                    href: "/uis/navigation",
                  },
                  {
                    title: "Images",
                    href: "/uis/images",
                  },
                  {
                    title: "Bot",
                    href: "/uis/bot",
                  },
                  {
                    title: "Look At",
                    href: "/uis/look-at",
                  },
                  {
                    title: "Image Generation",
                    href: "/uis/image-generation",
                  },
                ]}
              />
            </div>
          </div>
          <div
            class="w-full tracking-wider font-garara
              flex-center"
          >
            <MsdfText
              text="0"
              font="Garara-0"
              weird
            />
            <MsdfText
              text="0"
              font="Garara-10"
              weird
            />
            <MsdfText
              text="2"
              font="Garara-10"
              weird
            />
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
          <MsdfText
            text={title.charAt(0).toUpperCase() + "."}
            font="Garara-10"
            weird
          />
        </p>
        <h2 class="text-2xl -tracking-widest">
          <MsdfText
            text={title}
            font="AlteHaasGroteskBold"
            tracking={-0.12}
            weird
          />
        </h2>
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
        <MsdfText
          text={number + "."}
          font="Garara-10"
          weird
        />
      </p>
      <a href={href}>
        <MsdfText
          text={title}
          font="AlteHaasGroteskBold"
          weird
        />
      </a>
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
              <MsdfText
                text={crumb.text}
                font="AlteHaasGroteskBold"
                weird
              />
            </a>
            <Show when={index() < items.length - 1}>
              <span class="px-2 text-sm">
                <MsdfText
                  text="/"
                  font="AlteHaasGroteskBold"
                  weird
                />
              </span>
            </Show>
          </>
        )}
      </For>
    </div>
  );
};