import {
  For,
  Show,
  Suspense,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { createAsync } from "@solidjs/router";
import { A, onLeave, useLocation, useNavigate, usePreloadRoute } from "@acme/router";
import GlMark from "./webgl/GlMark";
import GlRoundRect from "./webgl/GlRoundRect";
import MsdfText from "./webgl/MsdfText";
import SdfImage from "./webgl/SdfImage";
import { readCssColor } from "./webgl/css-color";
import {
  crumbProgress,
  onPageMosaicIn,
  playCrumbMosaic,
} from "./webgl/mosaic-clock";
import {
  componentNeighbors,
  getNavCatalog,
  navTotal,
  type NavSection,
} from "~/lib/sections";
import {
  enterSolo,
  enterSoloInstant,
  exitSolo,
  hasSoloQuery,
  iconMorph,
  isComponentPath,
  resetSolo,
  solo,
  withSoloPath,
} from "~/lib/solo";
import { labelForTag } from "~/uis/meta";
import { CountDigits } from "./CountDigits";
import { NavHit, NavHitText, createWipe } from "./NavHit";

function normalizePath(path: string) {
  if (!path || path === "/") return "/";
  return path.replace(/\/+$/, "") || "/";
}

function titleFor(path: string, sections: NavSection[]) {
  const n = normalizePath(path);
  if (n === "/") return "Index";
  for (const section of sections) {
    if (normalizePath(section.href) === n) return section.title;
    const item = section.items.find((entry) => normalizePath(entry.href) === n);
    if (item) return item.title;
  }
  if (n.startsWith("/data/")) {
    return labelForTag(decodeURIComponent(n.slice("/data/".length)));
  }
  const slug = n.split("/").filter(Boolean).pop();
  if (!slug) return "Index";
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function warm(preload: ReturnType<typeof usePreloadRoute>, href: string) {
  return () => preload(href, { preloadData: true });
}

const TAP_LINK = "relative inline-flex items-center min-h-6 min-w-6";

function NavMsdf(props: {
  text: string;
  font?: string;
  tracking?: number;
  lineHeight?: number;
  class?: string;
  alpha?: number;
}) {
  return (
    <MsdfText
      text={props.text}
      font={props.font}
      tracking={props.tracking}
      lineHeight={props.lineHeight}
      class={props.class}
      alpha={props.alpha}
      weird
    />
  );
}

export const Nav = () => {
  const location = useLocation();
  const preload = usePreloadRoute();
  const [soloReady, setSoloReady] = createSignal(false);

  onMount(() => {
    if (isComponentPath(location.pathname) && hasSoloQuery(location.search)) {
      enterSoloInstant();
    }
    setSoloReady(true);
  });

  createEffect((prev?: { path: string }) => {
    if (!soloReady()) return prev;
    const path = location.pathname;
    const want = isComponentPath(path) && hasSoloQuery(location.search);
    const pathChanged = prev != null && prev.path !== path;
    if (want) {
      if (!solo()) {
        // Another page's mosaic already covers the landing. Same-path ?solo
        // (Hide interface) has to play the solo enter itself.
        if (pathChanged) enterSoloInstant();
        else void enterSolo();
      }
    } else if (solo()) {
      if (pathChanged) resetSolo();
      else void exitSolo();
    }
    return { path };
  });

  return (
    <>
      <div class="fixed top-0 right-0 z-20 pr-gx py-[3svh]" data-ui-solo-hide>
        <div class="w-grid-1" data-mosaic-chrome="logo">
          <A
            href="/"
            aria-label="aiuis home"
            class="block w-full"
            onPointerEnter={warm(preload, "/")}
          >
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
          <Suspense>
            <NavCatalog pathname={location.pathname} preload={preload} />
          </Suspense>
        </div>
      </nav>
      <Suspense>
        <CatalogDock pathname={location.pathname} />
      </Suspense>
    </>
  );
}

function CatalogDock(props: { pathname: string }) {
  const catalog = createAsync(() => getNavCatalog(), { deferStream: true });
  return (
    <Show when={catalog()}>
      {(sections) => <ComponentDock sections={sections()} pathname={props.pathname} />}
    </Show>
  );
};

function NavCatalog(props: {
  pathname: string;
  preload: ReturnType<typeof usePreloadRoute>;
}) {
  const catalog = createAsync(() => getNavCatalog(), { deferStream: true });
  const sections = () => catalog() ?? [];

  return (
    <>
      <div class="relative self-start w-grids-1 shrink-0 h-[1em] text-sm leading-none">
        <Breadcrumbs sections={sections()} preload={props.preload} />
      </div>
      <div data-ui-solo-hide class="flex flex-col">
        <div>
          <A
            href="/"
            aria-label="aiuis home"
            class="block w-full"
            onPointerEnter={warm(props.preload, "/")}
          >
            <SdfImage name="logotype" class="w-full" aria-hidden="true" />
          </A>
        </div>
        <div class="flex flex-col gap-4">
          <For each={sections()}>
            {(section, index) => (
              <ListBlock
                pathname={props.pathname}
                title={section.title}
                href={section.href}
                items={section.items}
                preload={props.preload}
                start={sections()
                  .slice(0, index())
                  .reduce((count, entry) => count + entry.items.length, 0)}
              />
            )}
          </For>
        </div>
      </div>
      <div
        data-ui-solo-hide
        class="w-full tracking-wider font-garara
          flex-center"
      >
        <CountDigits value={navTotal(sections())} />
      </div>
    </>
  );
}

const UI_PREVIEW = 5;

const ListBlock = (props: {
  title: string;
  href: string;
  items: {
    title: string;
    href: string;
    updated?: string | null;
  }[];
  pathname: string;
  preload: ReturnType<typeof usePreloadRoute>;
  /** How many pieces sit above this section. Item numbers continue from here. */
  start: number;
}) => {
  const href = () => props.href;
  const uis = () => normalizePath(href()) === "/uis";
  const shown = () => {
    const rows = props.items.map((item, index) => ({
      item,
      number: props.start + index + 1,
    }));
    if (!uis() || rows.length <= UI_PREVIEW) return rows;
    return [...rows]
      .sort((a, b) => {
        const ta = Date.parse(a.item.updated ?? "");
        const tb = Date.parse(b.item.updated ?? "");
        const aOk = Number.isFinite(ta);
        const bOk = Number.isFinite(tb);
        if (aOk && bOk && ta !== tb) return tb - ta;
        if (aOk !== bOk) return aOk ? -1 : 1;
        return b.number - a.number;
      })
      .slice(0, UI_PREVIEW)
      .sort((a, b) => a.number - b.number);
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
          <NavHit
            href={href()}
            end
            class={`${TAP_LINK} nav-hit -tracking-widest`}
            current={normalizePath(props.pathname) === normalizePath(href())}
            onPointerEnter={warm(props.preload, href())}
          >
            <NavHitText
              text={props.title}
              font="AlteHaasGroteskBold"
              tracking={-0.12}
            />
            <Show when={normalizePath(props.pathname) === normalizePath(href())}>
              <CurrentStrike />
            </Show>
          </NavHit>
        </p>
      </div>
      <ul>
        <For each={shown()}>
          {(row) => (
            <ListItem
              number={String(row.number)}
              title={row.item.title}
              href={row.item.href}
              preload={props.preload}
              current={normalizePath(props.pathname) === normalizePath(row.item.href)}
            />
          )}
        </For>
        <Show when={uis()}>
          <li class="mt-3 flex items-center text-[1.125em]">
            <p class="w-15 shrink-0" aria-hidden="true" />
            <NavHit
              href={href()}
              class={`${TAP_LINK} nav-hit`}
              current={normalizePath(props.pathname) === normalizePath(href())}
              onPointerEnter={warm(props.preload, href())}
            >
              <NavHitText text="See All " font="AlteHaasGroteskBold" />
              <NavHitText text={`(${props.items.length})`} font="Garara-10" />
              <Show when={normalizePath(props.pathname) === normalizePath(href())}>
                <CurrentStrike />
              </Show>
            </NavHit>
          </li>
        </Show>
      </ul>
    </div>
  );
};

const ListItem = (props: {
  number: string;
  title: string;
  href: string;
  current: boolean;
  preload: ReturnType<typeof usePreloadRoute>;
}) => {
  return (
    <li class="flex items-center">
      <p class="w-15 shrink-0 text-[.7em] font-garara font-[10]">
        <NavMsdf text={props.number + "."} font="Garara-10" />
      </p>
      <NavHit
        href={props.href}
        class={`${TAP_LINK} nav-hit`}
        current={props.current}
        onPointerEnter={warm(props.preload, props.href)}
      >
        <span class="relative inline-flex w-max">
          <NavHitText text={props.title} font="AlteHaasGroteskBold" />
          <Show when={props.current}>
            <CurrentStrike />
          </Show>
        </span>
      </NavHit>
    </li>
  );
};

const PAPER: [number, number, number] = [0.9137, 0.9137, 0.9176];

function lerp3(
  from: [number, number, number],
  to: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

/** Same hover as a data tag: pill fills blue, the mark knocks out to paper. */
function DockHit(props: {
  href?: string;
  label: string;
  pressed?: boolean;
  onClick?: () => void;
  kind: "prev" | "next" | "corners";
  morph?: number;
}) {
  const motion = createWipe(220);
  const pill = () => lerp3(PAPER, readCssColor("--color-key"), motion.wipe());
  const mark = () => lerp3(readCssColor("--color-key"), PAPER, motion.wipe());
  const handlers = {
    onPointerEnter: () => motion.enter(),
    onPointerLeave: () => motion.leave(),
    onFocusIn: () => motion.enter(),
    onFocusOut: () => motion.leave(),
  };
  const face = (
    <>
      <GlRoundRect class="pointer-events-none absolute inset-0" fill={pill()} />
      <GlMark kind={props.kind} morph={props.morph} color={mark()} />
    </>
  );
  if (props.href) {
    return (
      <A
        href={props.href}
        aria-label={props.label}
        class="dock-hit relative flex items-center justify-center w-6 h-6"
        {...handlers}
      >
        {face}
      </A>
    );
  }
  return (
    <button
      type="button"
      class="dock-hit relative flex items-center justify-center w-6 h-6"
      aria-pressed={props.pressed}
      aria-label={props.label}
      onClick={() => props.onClick?.()}
      {...handlers}
    >
      {face}
    </button>
  );
}

function ComponentDock(props: { sections: NavSection[]; pathname: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const neighbors = () => componentNeighbors(props.sections, props.pathname);
  const hrefFor = (href: string) => (solo() ? withSoloPath(href) : href);
  return (
    <Show when={isComponentPath(props.pathname)}>
      <div class="fixed bottom-[3svh] left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 pointer-events-auto">
        <Show when={neighbors()}>
          {(pair) => (
            <DockHit
              href={hrefFor(pair().prev.href)}
              label={`Previous, ${pair().prev.title}`}
              kind="prev"
            />
          )}
        </Show>
        <DockHit
          kind="corners"
          morph={iconMorph()}
          pressed={solo()}
          label={solo() ? "Show interface" : "Hide interface"}
          onClick={() => {
            navigate(
              withSoloPath(location.pathname, location.search, !solo()),
              { replace: true },
            );
          }}
        />
        <Show when={neighbors()}>
          {(pair) => (
            <DockHit
              href={hrefFor(pair().next.href)}
              label={`Next, ${pair().next.title}`}
              kind="next"
            />
          )}
        </Show>
      </div>
    </Show>
  );
}

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
const TRAIL_KEY = "aiuis:crumbs";

function readCrumbs(): Crumb[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(TRAIL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: Crumb[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const href = typeof rec.href === "string" ? normalizePath(rec.href) : "";
      const title = typeof rec.title === "string" ? rec.title.trim() : "";
      if (!href || !title) continue;
      out.push({ href, title });
    }
    return out.slice(-TRAIL_MAX);
  } catch {
    return [];
  }
}

function writeCrumbs(items: Crumb[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(TRAIL_KEY, JSON.stringify(items.slice(-TRAIL_MAX)));
}

function pushCrumb(trail: Crumb[], href: string, sections: NavSection[]): Crumb[] {
  const next = { href, title: titleFor(href, sections) };
  return [...trail.filter((item) => item.href !== href), next].slice(-TRAIL_MAX);
}

const Breadcrumbs = (props: {
  sections: NavSection[];
  preload: ReturnType<typeof usePreloadRoute>;
}) => {
  const location = useLocation();
  const start = normalizePath(location.pathname);
  const [trail, setTrail] = createSignal<Crumb[]>([
    { href: start, title: titleFor(start, props.sections) },
  ]);
  let persist = false;

  onMount(() => {
    setTrail(pushCrumb(readCrumbs(), start, props.sections));
    persist = true;
  });

  createEffect(() => {
    const items = trail();
    if (!persist) return;
    writeCrumbs(items);
  });
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
          setTrail((items) => pushCrumb(items, path, props.sections));
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
    <div
      data-mosaic-page="crumbs"
      data-ui-solo-hide
      class="absolute right-0 top-0 flex overflow-visible flex-nowrap
        items-baseline w-max max-w-none whitespace-nowrap"
    >
        <For each={trail()}>
          {(crumb, index) => (
            <>
              <Show when={index() > 0}>
                <span class="px-2 text-sm">
                  <NavMsdf text="/" font="AlteHaasGroteskBold" />
                </span>
              </Show>
              <NavHit
                href={crumb.href}
                class={`${TAP_LINK} nav-hit text-sm`}
                current={index() === trail().length - 1}
                onPointerEnter={warm(props.preload, crumb.href)}
              >
                <NavHitText text={crumb.title} font="AlteHaasGroteskBold" />
              </NavHit>
            </>
          )}
        </For>
    </div>
  );
};
