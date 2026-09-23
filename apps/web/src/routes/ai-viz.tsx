import Metadata from "~/components/Metadata";
import AiViz from "~/components/webgl/AiViz";
import { AI_VIZ_DEFAULTS } from "~/components/webgl/ai-viz-params";

export default function AiVizPage() {
  return (
    <>
      <Metadata
        title="AI Viz"
        description="AI visualization"
      />
      <style>{`[data-fcp]{display:none !important}`}</style>
      <div class="relative h-svh min-h-svh w-full overflow-hidden">
        <AiViz params={() => AI_VIZ_DEFAULTS} />
      </div>
    </>
  );
}
