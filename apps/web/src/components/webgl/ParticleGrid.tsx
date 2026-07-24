import { createEffect, onCleanup } from "solid-js";
import { isServer } from "solid-js/web";
import { createParticles, type ParticlesController } from "@ssscript/webgl";
import { webgl } from "~/lib/stores/webglStore";

// Generate a grid of clip-space positions
// 40 columns × 24 rows, from -0.9 to 0.9 inclusive in both axes
function generateGridPositions(cols: number, rows: number): Float32Array {
  const positions = new Float32Array(cols * rows * 2);
  let i = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      positions[i++] = cols > 1 ? -0.9 + (col / (cols - 1)) * 1.8 : 0;
      positions[i++] = rows > 1 ? -0.9 + (row / (rows - 1)) * 1.8 : 0;
    }
  }
  return positions;
}

const GRID_POSITIONS = generateGridPositions(40, 24);

export default function ParticleGrid() {
  if (isServer) return null;

  let particles: ParticlesController | undefined;

  createEffect(() => {
    if (!webgl.loaded) return;
    particles?.destroy();
    particles = createParticles({
      positions: GRID_POSITIONS,
      size: 2,
      color: [1, 1, 1, 1],
    });
  });

  onCleanup(() => {
    particles?.destroy();
    particles = undefined;
  });

  return null;
}
