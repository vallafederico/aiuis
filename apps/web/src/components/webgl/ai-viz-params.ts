/** Live-tunable AiViz motion knobs — packed into shader uniforms at runtime (see AiViz.tsx). */
export type AiVizParams = {
  /** seconds per full inhale + exhale */
  breathPeriod: number;
  pulseAmount: number;
  /** revolutions per breath */
  rotateSpeed: number;
  deformAmount: number;
  /** multiples of breath hz */
  deformSpeed: number;
  layerOpacity: number;
  /** global scale multiplier applied to the existing per-layer drift amounts */
  driftAmount: number;
};

/** Current baseline — matches the values AiViz.tsx used to bake in at compile time. */
export const AI_VIZ_DEFAULTS: AiVizParams = {
  breathPeriod: 4,
  pulseAmount: 0.08,
  rotateSpeed: 0.05,
  deformAmount: 0.05,
  deformSpeed: 0.25,
  layerOpacity: 0.8,
  driftAmount: 1,
};

export type AiVizState =
  | "idle"
  | "listening"
  | "thinking"
  | "acting"
  | "responding"
  | "awaiting";

export const AI_VIZ_STATES: AiVizState[] = [
  "idle",
  "listening",
  "thinking",
  "acting",
  "responding",
  "awaiting",
];

/** Draft preset directions from ai-viz-agent-cycle.md — tune via the dashboard. */
export const AI_VIZ_PRESETS: Record<AiVizState, AiVizParams> = {
  idle: {
    breathPeriod: 4.5,
    pulseAmount: 0.05,
    rotateSpeed: 0.02,
    deformAmount: 0.03,
    deformSpeed: 0.2,
    layerOpacity: 0.7,
    driftAmount: 1,
  },
  listening: {
    breathPeriod: 3.5,
    pulseAmount: 0.1,
    rotateSpeed: 0.04,
    deformAmount: 0.06,
    deformSpeed: 0.3,
    layerOpacity: 0.85,
    driftAmount: 1,
  },
  thinking: {
    breathPeriod: 2.5,
    pulseAmount: 0.09,
    rotateSpeed: 0.14,
    deformAmount: 0.11,
    deformSpeed: 0.5,
    layerOpacity: 0.9,
    driftAmount: 1.2,
  },
  acting: {
    breathPeriod: 2.5,
    pulseAmount: 0.08,
    rotateSpeed: 0.1,
    deformAmount: 0.08,
    deformSpeed: 0.4,
    layerOpacity: 0.9,
    driftAmount: 1,
  },
  responding: {
    breathPeriod: 3.5,
    pulseAmount: 0.16,
    rotateSpeed: 0.05,
    deformAmount: 0.05,
    deformSpeed: 0.3,
    layerOpacity: 0.85,
    driftAmount: 1,
  },
  awaiting: {
    breathPeriod: 6,
    pulseAmount: 0.02,
    rotateSpeed: 0.005,
    deformAmount: 0.03,
    deformSpeed: 0.15,
    layerOpacity: 0.55,
    driftAmount: 0.6,
  },
};
