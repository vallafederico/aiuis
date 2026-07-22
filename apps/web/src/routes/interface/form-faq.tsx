import { Title } from "@solidjs/meta";

import Section from "~/components/Section";

import { setLocationCallback } from "~/hooks/useLocationCallback";
import { animateAlpha } from "~/animation/alpha.js";

import { queryFaqAi } from "~/ais/faq";
import Aa from "~/components/Aa";

import Faqs from "~/components/faqs/Faqs";

// const queryFaq = async () => {
//   const response = await queryFaqAi();
//   console.log("response: ", response);
// };

export default function Home() {
  setLocationCallback();

  return (
    <main class="min-h-[100vh] pt-20">
      <Title>Form Faqs</Title>
      <Section class="px-gx h-[200vh]">
        <h1 use:animateAlpha>Form Faqs</h1>

        <Aa to="/interface">Back</Aa>
        <div class="flex-center py-xl">
          <Faqs />
        </div>
      </Section>
    </main>
  );
}
