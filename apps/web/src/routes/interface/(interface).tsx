import { Title } from "@solidjs/meta";

import Section from "~/components/Section";
import Aa from "~/components/Aa";

import { setLocationCallback } from "~/hooks/useLocationCallback";
import { animateAlpha } from "~/animation/alpha.js";

import { queryFaqAi } from "~/ais/faq";

const links = [
  {
    label: "Form Faqs",
    to: "/interface/form-faq",
  },
];

export default function Home() {
  setLocationCallback();

  return (
    <main class="min-h-[100vh] pt-20">
      <Title>Home</Title>
      <Section class="px-gx h-[50vh]">
        <h1 use:animateAlpha>Home</h1>

        <ul use:animateAlpha class="mt-md">
          {links.map((link) => (
            <li>
              <Aa to={link.to}>{link.label}</Aa>
            </li>
          ))}
        </ul>
      </Section>
    </main>
  );
}
