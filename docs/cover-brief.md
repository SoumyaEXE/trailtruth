# Cover image brief: TrailTruth DEV post

**Size:** 1000 × 420 px PNG. DEV crops to `width=1000,height=420,fit=cover`, so keep everything important inside a **920 × 360 safe area**, centred. The image also shows as a small thumbnail in feeds, so it has to read at about 300 px wide.

## Concept: "the card, at the trailhead"

The cover is the product: **one printed TrailTruth card**, photographed (or rendered to look) as if it's clipped to a trailhead sign or lying on a granite rock next to a boot. No phone in the shot. That absence is the point.

```
┌──────────────────────────────────────────────────────────────────────┐
│  [left 55%]                               [right 45%]                │
│   Printed trail card, tilted ~-4°,          TRAILTRUTH               │
│   soft shadow, slight paper texture          627 park alerts.        │
│   ┌──────────────────────────────┐           One card.               │
│   │ TRAILTRUTH · week of Oct 11  │           Then go outside.        │
│   │ HAWAIʻI VOLCANOES   [CAUTION]│                                   │
│   │ Go, but skip Halemaʻumaʻu Tr.│          small mono line:         │
│   │ CHICKAMAUGA/CHATT.  [CAUTION]│          "a territorial barred    │
│   │ Watch for: barred owl, Bluff │           owl may be present"     │
│   │ Trail                        │                                   │
│   └──────────────────────────────┘                                   │
│  background: blurred forest / basalt, muted greens, warm light       │
└──────────────────────────────────────────────────────────────────────┘
```

### Card content
Use the **real card text from a real workflow run** (`GET /api/cards/{id}`). The lines above are placeholders and must match whatever the post shows. Keep it to **two parks and at most six lines** so it's legible as a thumbnail. Decisions appear as stamp-style pills:

| Decision | Pill colour | Text |
|---|---|---|
| go | `#2F7D4F` forest green | GO |
| caution | `#C98A1B` trail-blaze amber | CAUTION |
| no_go | `#B23A2E` closure-sign red | NO-GO |

### Type
- Card body: a monospace or receipt-style face (e.g. *IBM Plex Mono*, *JetBrains Mono*). It should read as "printed", not "app".
- Right-side headline: a bold condensed sans (e.g. *Inter Tight* 800 or *Oswald* 600), 44–52 px, off-white `#F5F1E8` on the dark background. At most 3 short lines.
- The owl quote: italic, 18 px, 70% opacity. Optional; drop it if the thumbnail gets busy.

### Palette
Background: deep pine `#1E2A22` → basalt `#2B2B2B` gradient, or a real photo darkened 40%. Paper: `#FBF8F1`. Accents: the three decision colours only. Nothing in neon, no purple AI gradients, no robot or brain icons.

## How to make it (pick one)

1. **Real photo (best, and doubles as field-test proof).** Print the actual card. Photograph it outdoors at the trailhead from the field test, landscape, card filling the left half. Add the headline in Figma or Canva. Credit the location in the post's alt text.
2. **Rendered from the app.** Open the dashboard's printable card view, set the viewport to 1000 × 420, and screenshot with Playwright (`page.setViewportSize({width:1000,height:420})`). Composite it over a CC0 forest or lava photo (Unsplash/Pexels, with credit in the post) and add a CSS `transform: rotate(-4deg)` plus a drop shadow.
3. **Pure CSS/HTML.** A single `cover.html` with the card as a div over a gradient. Fastest, but the least warm option. Use it only if there's no time for 1 or 2.

## Don'ts
- No phone mock-ups, no laptop, no dashboard screenshot. The cover should promise less screen.
- No partner logos. Categories are judged on use, not branding.
- No made-up park data. If the card on the cover shows a closure, it has to come from a real alert.
- Keep text off the outer 40 px. DEV's crop and rounded corners eat it.

## Alt text (for the post's cover and hero)
"A printed TrailTruth card on a trailhead rock reading: Hawaiʻi Volcanoes, caution, go but skip Halemaʻumaʻu Trail; Chickamauga and Chattanooga, caution, watch for a barred owl on Bluff Trail." Update it to match the real card.
