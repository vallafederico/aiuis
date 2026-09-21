export const NAV_SECTIONS: {
  title: string;
  href: string;
  items: { title: string; href: string }[];
}[] = [
  {
    title: "Preface",
    href: "/preface",
    items: [
      { title: "Foreword", href: "/preface/foreword" },
      { title: "Credits", href: "/preface/credits" },
    ],
  },
  {
    title: "Foundations",
    href: "/foundations",
    items: [
      { title: "Representing Thinking", href: "/foundations/representing-thinking" },
      { title: "Styleguides", href: "/foundations/styleguides" },
      { title: "Principles", href: "/foundations/principles" },
      { title: "Interactions", href: "/foundations/interactions" },
    ],
  },
  {
    title: "UIs",
    href: "/uis",
    items: [
      { title: "FAQs", href: "/uis/faqs" },
      { title: "Infinite Article", href: "/uis/infinite-article" },
      { title: "Navigation", href: "/uis/navigation" },
      { title: "Images", href: "/uis/images" },
      { title: "Bot", href: "/uis/bot" },
      { title: "Look At", href: "/uis/look-at" },
      { title: "Image Generation", href: "/uis/image-generation" },
    ],
  },
];

export function sectionByHref(href: string) {
  return NAV_SECTIONS.find((section) => section.href === href);
}
