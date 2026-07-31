import { createMemo, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import CmsMsdfBlock from "./CmsMsdfBlock";
import MsdfText from "~/components/webgl/MsdfText";
import {
  hastChildren,
  hastClassNames,
  hastHasClass,
  hastToPlainText,
  isMeaningfulNode,
  type HastElement,
  type HastNode,
} from "./hast";

const HEADING_CLASS: Record<string, string> = {
  h1: "text-5xl -tracking-widest",
  h2: "text-4xl -tracking-widest",
  h3: "text-3xl -tracking-widest",
  h4: "text-2xl",
  h5: "text-xl",
  h6: "text-lg",
};

function attr(node: HastElement, key: string): string | undefined {
  const v = node.properties?.[key];
  if (v == null) return undefined;
  return Array.isArray(v) ? v.join(" ") : String(v);
}

function elementChildren(node: HastElement, tagName: string): HastElement[] {
  return hastChildren(node).filter(
    (c): c is HastElement => c.type === "element" && c.tagName === tagName,
  );
}

function CmsParagraph(props: { node: HastElement }) {
  const kids = () => hastChildren(props.node).filter(isMeaningfulNode);
  // a paragraph that's entirely one link stays clickable; mixed inline
  // links/emphasis flatten to plain text for now (no run-splitting yet)
  const soleLink = (): HastElement | null => {
    const list = kids();
    const [only] = list;
    return list.length === 1 && only.type === "element" && only.tagName === "a" ? only : null;
  };
  return (
    <Show
      when={soleLink()}
      fallback={
        <p>
          <CmsMsdfBlock text={hastToPlainText(props.node)} />
        </p>
      }
    >
      {(a) => (
        <p>
          <a href={attr(a(), "href")}>
            <CmsMsdfBlock text={hastToPlainText(a())} />
          </a>
        </p>
      )}
    </Show>
  );
}

function CmsHeading(props: { node: HastElement }) {
  return (
    <Dynamic component={props.node.tagName}>
      <CmsMsdfBlock
        text={hastToPlainText(props.node)}
        class={HEADING_CLASS[props.node.tagName] ?? "text-2xl"}
      />
    </Dynamic>
  );
}

function CmsNotes(props: { node: HastElement }) {
  const paragraphs = () => elementChildren(props.node, "p");
  return (
    <aside class={hastClassNames(props.node).join(" ") || "cms-notes"}>
      <p class="cms-notes-label uppercase tracking-[0.15em] text-[0.6875rem] mb-2">
        <MsdfText text="Notes" font="Garara-10" alpha={0.7} />
      </p>
      <For each={paragraphs()}>
        {(child) => (
          <p>
            <CmsMsdfBlock text={hastToPlainText(child)} alpha={0.55} />
          </p>
        )}
      </For>
    </aside>
  );
}

function CmsFigure(props: { node: HastElement }) {
  const isVideo = () => hastHasClass(props.node, "cms-video")
  const img = () =>
    hastChildren(props.node).find(
      (c): c is HastElement => c.type === "element" && c.tagName === "img",
    )
  const video = () =>
    hastChildren(props.node).find(
      (c): c is HastElement => c.type === "element" && c.tagName === "video",
    )
  const caption = () =>
    hastChildren(props.node).find(
      (c): c is HastElement => c.type === "element" && c.tagName === "figcaption",
    )
  return (
    <Show
      when={isVideo() ? video() : img()}
      fallback={null}
    >
      {(media) => (
        <figure class={hastClassNames(props.node).join(" ") || "cms-figure"}>
          <Show when={isVideo()} fallback={<CmsImg node={media() as HastElement} />}>
            <CmsVideoEl node={media() as HastElement} />
          </Show>
          <Show when={caption()}>
            {(cap) => <figcaption>{hastToPlainText(cap())}</figcaption>}
          </Show>
        </figure>
      )}
    </Show>
  )
}

function CmsVideoEl(props: { node: HastElement }) {
  const isAmbient = () => attr(props.node, "autoplay") != null
  return (
    <video
      src={attr(props.node, "src")}
      poster={attr(props.node, "poster")}
      controls={!isAmbient() || undefined}
      autoplay={isAmbient() || undefined}
      muted={isAmbient() || undefined}
      loop={isAmbient() || undefined}
      playsinline={isAmbient() || undefined}
    />
  )
}

function CmsImg(props: { node: HastElement }) {
  return (
    <img
      src={attr(props.node, "src")}
      alt={attr(props.node, "alt") ?? ""}
      width={attr(props.node, "width")}
      height={attr(props.node, "height")}
      loading="lazy"
      decoding="async"
      data-lqip={attr(props.node, "data-lqip")}
    />
  );
}

function CmsList(props: { node: HastElement }) {
  const items = () => elementChildren(props.node, "li");
  const ordered = props.node.tagName === "ol";
  return (
    <Dynamic
      component={ordered ? "ol" : "ul"}
      class={ordered ? "list-decimal pl-8" : "list-disc pl-8"}
    >
      <For each={items()}>
        {(li) => (
          <li>
            <CmsMsdfBlock text={hastToPlainText(li)} />
          </li>
        )}
      </For>
    </Dynamic>
  );
}

function CmsBlockquote(props: { node: HastElement }) {
  return (
    <blockquote class="border-l-2 pl-4">
      <CmsMsdfBlock text={hastToPlainText(props.node)} />
    </blockquote>
  );
}

function CmsPre(props: { node: HastElement }) {
  return (
    <pre class="overflow-x-auto whitespace-pre text-[1.25rem]">
      <code>{hastToPlainText(props.node)}</code>
    </pre>
  );
}

function HastNodeView(props: { node: HastNode }) {
  const node = props.node;

  if (node.type !== "element") {
    if (!isMeaningfulNode(node)) return null;
    return (
      <p>
        <CmsMsdfBlock text={hastToPlainText(node)} />
      </p>
    );
  }

  if (node.tagName === "p") return <CmsParagraph node={node} />;
  if (/^h[1-6]$/.test(node.tagName)) return <CmsHeading node={node} />;
  if (node.tagName === "aside" && hastHasClass(node, "cms-notes")) return <CmsNotes node={node} />;
  if (node.tagName === "figure") return <CmsFigure node={node} />;
  if (node.tagName === "img") return <CmsImg node={node} />;
  if (node.tagName === "ul" || node.tagName === "ol") return <CmsList node={node} />;
  if (node.tagName === "blockquote") return <CmsBlockquote node={node} />;
  if (node.tagName === "pre") return <CmsPre node={node} />;

  // unknown element — fall back to its flattened text, drop if empty
  const text = hastToPlainText(node);
  return text.trim() ? (
    <p>
      <CmsMsdfBlock text={text} />
    </p>
  ) : null;
}

export function CmsBody(props: { hast: HastNode | null | undefined }) {
  const children = createMemo<HastNode[]>(() => {
    const root = props.hast;
    if (!root || root.type !== "root") return [];
    return hastChildren(root).filter(isMeaningfulNode);
  });

  return (
    <Show when={children().length > 0} fallback={<p class="opacity-60">No content.</p>}>
      <For each={children()}>{(node) => <HastNodeView node={node} />}</For>
    </Show>
  );
}
