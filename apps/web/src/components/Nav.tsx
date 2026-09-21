import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { A, onLeave, useLocation, usePreloadRoute } from "@acme/router";
import GlRoundRect from "./webgl/GlRoundRect";
import MsdfText from "./webgl/MsdfText";
import SdfImage from "./webgl/SdfImage";
import { readCssColor } from "./webgl/css-color";
import {
  crumbProgress,
  onPageMosaicIn,
  playCrumbMosaic,
} from "./webgl/mosaic-clock";
import { NAV_SECTIONS } from "~/lib/sections";

const PAGE_TITLES = new Map<string, string>([
  ["/", "Index"],
  ...NAV_SECTIONS.flatMap(
    (section) =>
      [
        [normalizePath(section.href), section.title],
        ...section.items.map((item) => [normalizePath(item.href), item.title]),
      ] as [string, string][],
  ),
]);

function normalizePath(path: string) {
  if (!path || path === "/") return "/";
  return path.replace(/\/+$/, "") || "/";
}

function titleFor(path: string) {
  const n = normalizePath(path);
  const named = PAGE_TITLES.get(n);
  if (named) return named;
  if (n.startsWith("/data/")) {
    return decodeURIComponent(n.slice("/data/".length))
      .replaceAll("_", "-")
      .toUpperCase();
  }
  const slug = n.split("/").filter(Boolean).pop();
  if (!slug) return "Index";
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function NavMsdf(props: {
  text: string;
  font?: string;
  tracking?: number;
  lineHeight?: number;
  class?: string;
}) {
  return (
    <MsdfText
      text={props.text}
      font={props.font}
      tracking={props.tracking}
      lineHeight={props.lineHeight}
      class={props.class}
      weird
    />
  );
}

export const Nav = () => {
  const location = useLocation();
  const preload = usePreloadRoute();

  onMount(() => {
    preload("/", { preloadData: true });
    for (const section of NAV_SECTIONS) {
      preload(section.href, { preloadData: true });
      for (const item of section.items) {
        preload(item.href, { preloadData: true });
      }
    }
  });

  return (
    <>
      <div class="fixed top-0 right-0 z-20 pr-gx py-[3svh]">
        <div class="w-grid-1" data-mosaic-chrome="logo">
          <A href="/" aria-label="aiuis home">
            <SdfImage
              name="logo"
              class="w-full"
              aria-hidden="true"
              //   blur={{ radius: 24, angle: 180, from: 0.2 }}
            />
          </A>
        </div>
      </div>
      <nav
        aria-label="Site"
        class="flex fixed top-0 left-0 z-20 flex-col h-lvh pl-gx"
        data-mosaic-chrome="nav"
      >
        <div
          class="relative flex flex-col justify-between h-full overflow-visible
            w-grid-2 py-[3svh]"
        >
          <Breadcrumbs />
          <div class="flex flex-col">
            <div>
              <A href="/" aria-label="aiuis home">
                <SdfImage name="logotype" class="w-full" aria-hidden="true" />
              </A>
            </div>
            <div class="flex flex-col gap-4">
              <For each={NAV_SECTIONS}>
                {(section) => (
                  <ListBlock
                    pathname={location.pathname}
                    title={section.title}
                    items={section.items}
                  />
                )}
              </For>
            </div>
          </div>
          <div
            class="w-full tracking-wider font-garara
              flex-center"
          >
            <NavMsdf text="0" font="Garara-0" />
            <NavMsdf text="0" font="Garara-10" />
            <NavMsdf text="2" font="Garara-10" />
          </div>
        </div>
      </nav>
    </>
  );
};

const ListBlock = (props: {
  title: string;
  items: {
    title: string;
    href: string;
  }[];
  pathname: string;
}) => {
  const href = () => {
    const match = NAV_SECTIONS.find((section) => section.title === props.title);
    return match?.href ?? props.items[0]?.href ?? "/";
  };
  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-center">
        <p class="w-10 font-[10] tracking-wider font-garara">
          <NavMsdf
            text={props.title.charAt(0).toUpperCase() + "."}
            font="Garara-10"
          />
        </p>
        <p class="text-2xl -tracking-widest">
          <A
            href={href()}
            end
            class="relative inline-block"
            aria-current={
              normalizePath(props.pathname) === normalizePath(href())
                ? "page"
                : undefined
            }
          >
            <NavMsdf
              text={props.title}
              font="AlteHaasGroteskBold"
              tracking={-0.12}
            />
            <Show when={normalizePath(props.pathname) === normalizePath(href())}>
              <CurrentStrike />
            </Show>
          </A>
        </p>
      </div>
      <ul>
        <For each={props.items}>
          {(item, index) => (
            <ListItem
              number={String(index() + 1)}
              title={item.title}
              href={item.href}
              current={normalizePath(props.pathname) === normalizePath(item.href)}
            />
          )}
        </For>
      </ul>
    </div>
  );
};

const ListItem = (props: {
  number: string;
  title: string;
  href: string;
  current: boolean;
}) => {
  return (
    <li class="flex items-center">
      <p class="w-15 text-[.7em] font-garara font-[10]">
        <NavMsdf text={props.number + "."} font="Garara-10" />
      </p>
      <A
        href={props.href}
        class="relative inline-block"
        aria-current={props.current ? "page" : undefined}
      >
        <NavMsdf text={props.title} font="AlteHaasGroteskBold" />
        <Show when={props.current}>
          <CurrentStrike />
        </Show>
      </A>
    </li>
  );
};

/** Thick blue bar through the sidebar label of the page you're on. */
function CurrentStrike() {
  return (
    <GlRoundRect
      layer={20}
      radius={0}
      fill={readCssColor("--color-key")}
      class="pointer-events-none absolute top-1/2 -right-[0.28em] -left-[0.16em] h-[0.7em] -translate-y-1/2"
    />
  );
}

type Crumb = { href: string; title: string };

const TRAIL_MAX = 3;

function pushCrumb(trail: Crumb[], href: string): Crumb[] {
  const next = { href, title: titleFor(href) };
  return [...trail.filter((item) => item.href !== href), next].slice(-TRAIL_MAX);
}

const Breadcrumbs = () => {
  const location = useLocation();
  const start = normalizePath(location.pathname);
  const [trail, setTrail] = createSignal<Crumb[]>([
    { href: start, title: titleFor(start) },
  ]);
  let shownHref = start;
  let swapGen = 0;

  onLeave(() => {
    swapGen += 1;
  });

  onCleanup(
    onPageMosaicIn(() => {
      const gen = ++swapGen;
      const path = normalizePath(location.pathname);
      void (async () => {
        if (path !== shownHref) {
          await playCrumbMosaic(0);
          if (gen !== swapGen) return;
          shownHref = path;
          setTrail((items) => pushCrumb(items, path));
          await playCrumbMosaic(1);
          return;
        }
        if (crumbProgress() < 0.999) {
          await playCrumbMosaic(1);
        }
      })();
    }),
  );

  return (
    <div class="flex overflow-visible self-start justify-end w-grids-1">
      <div
        data-mosaic-page="crumbs"
        class="flex overflow-visible flex-nowrap items-baseline
          w-max max-w-none whitespace-nowrap"
      >
        <For each={trail()}>
          {(crumb, index) => (
            <>
              <Show when={index() > 0}>
                <span class="px-2 text-sm">
                  <NavMsdf text="/" font="AlteHaasGroteskBold" />
                </span>
              </Show>
              <A
                href={crumb.href}
                class="text-sm"
                aria-current={index() === trail().length - 1 ? "page" : undefined}
              >
                <NavMsdf text={crumb.title} font="AlteHaasGroteskBold" />
              </A>
            </>
          )}
        </For>
      </div>
    </div>
  );
};
