import Metadata from "~/components/Metadata";
import AiViz from "~/components/webgl/AiViz";

export default function AiVizPage() {
  return (
    <>
      <Metadata
        title="AI Viz"
        description="AI visualization"
      />
      <div class="relative h-svh min-h-svh w-full overflow-hidden">
        <AiViz />
      </div>
    </>
  );
}
