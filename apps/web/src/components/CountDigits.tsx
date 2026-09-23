import { For } from "solid-js";
import MsdfText from "./webgl/MsdfText";

/** Three-digit count. The leading zero uses Garara-0; the rest use Garara-10. */
export function CountDigits(props: { value: number }) {
  const digits = () => String(Math.max(0, props.value)).padStart(3, "0").slice(-3).split("");
  return (
    <For each={digits()}>
      {(digit, index) => (
        <MsdfText
          text={digit}
          font={index() === 0 && digit === "0" ? "Garara-0" : "Garara-10"}
          weird
        />
      )}
    </For>
  );
}
