import Metadata from "~/components/Metadata";
import ParticleGrid from "~/components/webgl/ParticleGrid";

export default function Home() {
  return (
    <div class="pt-20 min-h-svh">
      <Metadata
        title="aiuis"
        description="aiuis"
      />

      <ParticleGrid />
    </div>
  );
}
