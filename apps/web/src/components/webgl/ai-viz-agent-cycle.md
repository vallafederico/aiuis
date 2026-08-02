# AI Viz — Agent Cycle (internal)

Internal notes for the ai-viz blob system as a representation of an agent turn.
Public article ("representing thinking") comes later — this file is only for product/visual theory.

## Core loop

The minimum cycle that maps cleanly onto a chat / voice agent:

```
idle → listening → thinking → responding → idle
```

| State | Trigger | What it means |
| --- | --- | --- |
| **idle** | No turn in flight; waiting | Ready, ambient, low energy |
| **listening** | User typing / speaking | Input is being received; agent attention is outward |
| **thinking** | User turn submitted; model/reasoning running | Internal computation; no user-facing tokens yet |
| **responding** | Tokens / speech streaming out | Agent attention is outward again, producing |

These four are the spine. Everything else is either a refinement of one of them, or a branch.

## Likely additional states

Worth modelling early even if the viz only implements a subset:

| State | Why it exists | Relation to core |
| --- | --- | --- |
| **acting** | Tool calls, fetches, writes, browser steps — "doing in the world", not just reasoning | Sibling of **thinking**; often interleaved with it in agent runs |
| **awaiting** | Human-in-the-loop: confirm, clarify, approve a tool | Not **idle** — mid-turn pause with intent |
| **interrupted** | User cancels / stops generation | Exit hatch back toward **idle** |
| **error** | Hard failure (network, tool, policy) | Exit hatch; may linger before **idle** |

### Suggested richer cycle

```
idle
  → listening
  → thinking ⇄ acting     (may loop / interleave)
  → awaiting?             (optional branch, then back to thinking/acting)
  → responding
  → idle

any active state → interrupted | error → idle
```

## States we probably do *not* need (yet)

- **connecting / loading** — one-shot cold start, not part of the turn rhythm
- **complete / settling** — micro-transition after respond; can be a timed ease into idle rather than a named state
- Sub-splitting **responding** into TTS vs text — same outward energy, different medium

## Parameter model

The viz is a small set of knobs. A **state** is a target preset for those knobs; transitions lerp between presets (don’t hard-cut).

Breath remains the shared clock — states change **period / amplitude / coupling**, not whether time exists.

### Knob inventory (from `AiViz.tsx` today + near-term)

Grouped by what they express. ★ = primary state drivers; others support.

#### Tempo / breath
| Knob | Today | Role |
| --- | --- | --- |
| ★ `breathPeriod` | `BREATH_PERIOD` (4s) | Master cycle length — the main “how alive / how urgent” signal |
| ★ `pulseAmount` | `PULSE_AMOUNT` | How much radius expands/contracts per breath |
| `phaseSpread` | `PHASE_*` spacing | How out-of-sync the three layers breathe (tight = one organism; wide = layered mind) |

#### Motion
| Knob | Today | Role |
| --- | --- | --- |
| ★ `rotateSpeed` | `ROTATE_SPEED` (rev/breath) | Spin energy; often rises with cognitive load |
| ★ `deformAmount` | `DEFORM_AMOUNT` | Edge wobble; organic “thinking texture” |
| `deformSpeed` | `DEFORM_SPEED` | How fast the wobble pattern scrolls (breath-relative) |
| `driftAmount` | `DRIFT_AMOUNT_*` | Center wander; keep small so blobs stay readable |
| `driftFreq` | `DRIFT_FREQ_*` | Wander rate as breath harmonic |

#### Presence / stacking
| Knob | Today | Role |
| --- | --- | --- |
| ★ `layerOpacity` | `LAYER_OPACITY` (global) | Overall presence; later: per-layer `opacityBg/Mid/Fg` |
| ★ `layerBalance` | — (not yet) | Relative weight of bg / mid / fg — which “depth” dominates |
| `blurAmount` | `BLUR_BG` / `BLUR_FG` | Soft-edge length; dreamier vs sharper |
| `blurDir` | `BLUR_DIR_*` | Soft-edge orientation (mostly aesthetic; can rotate with state) |
| `radiusScale` | `RADIUS_*` | Global size scale (careful — layout/readability) |
| `stagger` | vertical offsets | How separated the Z stack reads |

#### Transition (meta, not shader constants yet)
| Knob | Role |
| --- | --- |
| `easeIn` / `easeOut` | How fast we enter/leave a state preset |
| `hold` | Min time before leaving (avoids flicker on fast token bursts) |

### Design rule

Prefer changing **few knobs a lot** over tweaking everything:

1. `breathPeriod` — urgency
2. `rotateSpeed` + `deformAmount` — internal activity
3. `pulseAmount` — expressive “alive” amplitude
4. `layerOpacity` / `layerBalance` — attention in vs out, depth of stack

Everything else is seasoning.

## State → parameter direction (draft)

Relative to **idle** as baseline. Values are intent, not final numbers.

| State | breathPeriod | pulseAmount | rotateSpeed | deformAmount | opacity / balance | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **idle** | slow (~4–5s) | low | very low | low | soft, balanced stack | Ambient resting breath |
| **listening** | slightly faster | medium, clearer | low | low–med | mid/fg a bit stronger | Outward attention; reactive but not frantic |
| **thinking** | faster (~2–3s) | medium | high | high | denser stack, maybe mid dominant | Inward; most “busy” organic motion |
| **acting** | similar to thinking or slightly sharper | med | med–high | med (less dreamy than thinking) | fg stronger / sharper blur | Purposeful; less mush, more direction |
| **responding** | back toward slow–med | high, open | med → falling | med → low | fg present, bg calmer | Outward release; breath opens as content leaves |
| **awaiting** | very slow or near-held | very low (suspended) | near zero | low, tense | reduced opacity or frozen balance | Tension without progress — almost held breath |
| **interrupted** | snap toward idle period | collapse pulse | brake rotate | collapse deform | brief dip then recover | Short break in the cycle |
| **error** | irregular / stalled then idle | low | stop | low | opacity dip or desaturate later | Don’t loop error forever |

### Qualitative feel (same table, prose)

| State | Feel |
| --- | --- |
| idle | Slow breath, minimal rotate/deform, soft presence |
| listening | Tighter / more reactive pulse; attention outward |
| thinking | Faster breath, denser deform + rotate; layered mind |
| acting | Sharper than thinking — less dreamy, more purposeful |
| responding | Open pulse, motion easing down as output flows |
| awaiting | Held / suspended — almost no pulse |
| interrupted / error | Break, then settle to idle |

## Implementation sketch (later)

```ts
type AgentVizState =
  | "idle"
  | "listening"
  | "thinking"
  | "acting"
  | "responding"
  | "awaiting"
  | "interrupted"
  | "error";

type AgentVizParams = {
  breathPeriod: number;
  pulseAmount: number;
  rotateSpeed: number;
  deformAmount: number;
  deformSpeed: number;
  layerOpacity: number;
  // later: opacityBg, opacityMid, opacityFg, layerBalance, blur…
};

const PRESETS: Record<AgentVizState, AgentVizParams> = { /* … */ };
```

Runtime: own current → lerp toward `PRESETS[state]` each frame; inject lerped values as shader uniforms (not compile-time constants) so state changes don’t rebuild the program.

## Open questions

1. Is **acting** visually distinct from **thinking**, or one "busy" state with a tool sub-flag?
2. Does **listening** cover both text and voice, or does mic-open deserve its own intensity?
3. Should **awaiting** appear in the first shipped viz, or only once agent HITL exists?
4. Who owns the state machine — chat UI, agent runtime, or the viz itself as a thin subscriber?
5. Per-layer opacity now, or start with one global `layerOpacity` and add balance later?
6. Should `breathPeriod` hard-cut on state change, or always ease (risk: weird in-between tempos)?
