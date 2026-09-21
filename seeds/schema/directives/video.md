---
_kind: directive_schema
name: video
form: leaf
attributes:
  src: { type: string, required: true }
  poster: { type: string }
  caption: { type: string }
  ambient: { type: boolean }
intent: "Embed a video asset. src is required (asset ref). poster is an optional thumbnail asset ref. caption is optional display text. ambient makes the video autoplay, muted, looped, no controls."
---
Use ::video to embed video files uploaded via upload_asset. The src and optional poster attributes must reference registered assets (assets/... path). Use ambient for background/decoration videos; omit for standard player with controls.
