---
_kind: taxonomy
name: topics
policy: propose
normalize: { case: lower, slugify: true, singularize: true }
aliases:
  ml: machine-learning
  llm: ai
  llms: ai
  webgl2: webgl
  glsl: webgl
  "3d": webgl
hierarchy: false
terms:
  - { slug: webgl, title: WebGL, description: "WebGL 2, GLSL shaders, GPU programming, raw canvas — anything that runs on the graphics pipeline." }
  - { slug: solid, title: Solid, description: "SolidJS and SolidStart — fine-grained reactivity, SSR, routing. Not general frontend framework content." }
  - { slug: ai, title: AI, description: "LLM tooling, agent systems, MCP, inference, model behaviour. Avoid: use more specific terms if available." }
  - { slug: machine-learning, title: Machine Learning, description: "Training, fine-tuning, embeddings, classical ML. Distinct from ai (inference/tooling)." }
  - { slug: cloudflare, title: Cloudflare, description: "Workers, D1, R2, KV, Queues, Durable Objects — the platform stack." }
  - { slug: devlog, title: Devlog, description: "Build-in-public updates, project retrospectives, process notes. Use for posts primarily about the journey, not the technique." }
  - { slug: animation, title: Animation, description: "CSS animation, GSAP, canvas animation, motion design — visual movement that isn't GPU/shader work." }
  - { slug: tools, title: Tools, description: "CLI tools, editor config, build systems, local dev setup. Not the product of the tooling — the tooling itself." }
---
Pairing guidance for agents:

Most posts take 1–2 topics. Three is the limit before a post becomes a survey — surveys usually indicate it should be split or the scope narrowed.

`devlog` pairs well with any technical topic: a devlog about building a WebGL scene gets both `devlog` and `webgl`.

`ai` and `machine-learning` are distinct: a post about running an LLM for content generation is `ai`; a post about training an image classifier is `machine-learning`. When in doubt, `ai` is the broader bucket.

Proposing a new term: propose only when the gap is genuine — when none of the existing terms accurately describes the post, and when you expect more than one future post would use this term. Single-post novelty topics fragment the taxonomy without benefit.
