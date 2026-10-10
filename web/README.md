# TrailTruth web

Next.js 16 (App Router, TypeScript, Tailwind v4) + BoardUI. Design notes: [DESIGN.md](./DESIGN.md).

```bash
npm install
npm run dev                      # http://localhost:3000  (API: NEXT_PUBLIC_API_URL, default http://localhost:8000)
npm run build && npm start       # production
STATIC_EXPORT=1 npm run build    # static demo in out/ (renders from public/fixtures)
```

Data falls back: live API → `public/fixtures/*.json` → `lib/mock.ts`, with a "Demo data" chip when not live.
Card generation simulates the Temporal workflow in-browser when the API is down.

Screenshots (server must be running on :3000; the API's CORS allows that port):

```bash
npm run shots        # ../docs/screenshots — every page, 1440/390, light/dark
npm run shots:blog   # ../docs/images — clean 2x set for the DEV post (uses ?clean=1)
```
