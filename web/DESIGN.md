# TrailTruth — design notes

**Direction:** NPS ranger signage meets a Linear-grade operations dashboard. It should feel calm, dense and typographic, with earth tones. The product's goal is to be closed quickly, so every screen leads with the decision and keeps the detail one level down.

## Principles (and where they came from)

1. **The decision comes first, the evidence second.** Each park reduces to one of three signals (Go / Caution / No-go), shown before anything else. The alert text, the model JSON and the latency figures sit one click deeper, in an expandable row or the Model Lab.
   _Ref: BoardUI dashboard KPI rows (https://boardui.com/components); dashboard rule "reserve hue for status, grayscale for everything else" — https://www.setproduct.com/blog/effective-dashboard-design-principles_

2. **Hierarchy through weight and spacing, not size jumps.** Linear-style screens stay calm because their type scale is tight. We use BoardUI's composite type tokens (`text-body-medium`, `text-title-3-semibold` and so on) and save the large slab display face for two places only: the hero statement and the trail card's decisions.
   _Ref: "The Linear Aesthetic, Decoded" — https://www.buildmvpfast.com/blog/linear-aesthetic-tokens-density-keyboard-first-ux-2026 ; calm-UI rules — https://skills.sh/brijr/skills/calm-ui_

3. **Signage typography for the artifact.** NPS UniGuide signs use mixed case, flush-left legends on a dark-green overbar over a gray-brown panel, set in Clarendon/Rawlinson-style serifs. The printable trail card borrows that grammar: a pine overbar, a slab serif for park names and verdicts, and a plain sans for supporting text. It does **not** use the NPS arrowhead or any NPS branding.
   _Ref: NPS UniGuide standards — https://www.npshistory.com/publications/management/signs/uniguide-signs-overview.pdf ; 1994 Yosemite sign study — https://www.npshistory.com/publications/yose/sign-study-1994.pdf ; SEGD on UniGuide — https://segd.org/?p=2599_

4. **Earth palette with color-blind-safe signals.** The neutrals are warm granite rather than blue-gray, the accent is pine green, and sandstone and sky serve as secondary data colors. Each signal pairs a color with a distinct **shape**: a circle for Go, a triangle for Caution and an octagon for No-go (the same shape logic as road signs). The decision stays readable in grayscale print and for deuteranopes.
   _Ref: UniGuide color spec (gray-brown panel, dark green overbar) — https://www.generalstaff.org/BBOW/Colors/NPS_uniguide_standards.pdf_

5. **Topography as texture, never as decoration in the data.** Faint contour lines (at most 6–8% opacity) appear behind the hero, the card and the empty states, which gives a sense of place without adding noise. They never appear behind tables or charts.
   _Ref: topographic contour patterns — https://www.framer.com/marketplace/components/topographic-contour/ ; https://uxpilot.ai/labs/pattern-generator/topographic_

6. **Tabular numerals and monospace for machine output.** Latency, costs, model JSON, workflow IDs and attempt counts are set in JetBrains Mono with tabular numbers, so columns line up and machine output reads differently from human prose (the original NPS alert text).

7. **Honest states.** Demo data is labeled with a chip. A model that hasn't been trained yet shows a designed "awaiting training run" state, not zeros. Retries and crash-resumes in the workflow timeline are highlighted rather than hidden, because they show the system is reliable.

8. **Built for leaving.** The KPI is minutes *not* spent in the app. Every page offers a short path to the printable card, the print stylesheet produces a single black-on-white sheet, and the card exports as a lock-screen PNG.

## Tokens

- BoardUI `styles/theme.css` is untouched. `styles/trailtruth.css` layers the outdoor palette on top:
  - The `neutral-*` ramp is remapped to warm granite, so every BoardUI semantic token inherits it.
  - The `accent-*` ramp is remapped to pine green (CTAs, focus rings, selected nav).
  - New semantic tokens `go / caution / nogo` (each with `-solid`, `-surface`, `-text` and `-border`) and `sandstone`, `sky` and `topo`, all with dark-mode values.
  - `chart-1…5` are remapped to pine, sky, sandstone, clay and granite.
- Fonts: Inter (UI), JetBrains Mono (data), Zilla Slab (signage display, used sparingly).
