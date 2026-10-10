import { cx } from "@/utils/cx";

/**
 * Deterministic topographic contour texture. Pure SVG, computed once at
 * module load so server and client render identical markup.
 */

type Peak = { x: number; y: number; rings: number; r0: number; step: number; seed: number; sx?: number; sy?: number };

function ring(p: Peak, k: number): string {
  const N = 72;
  const r = p.r0 + k * p.step;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const wobble =
      1 +
      0.13 * Math.sin(3 * t + p.seed + k * 0.17) +
      0.07 * Math.sin(5 * t + p.seed * 1.7 - k * 0.11) +
      0.04 * Math.cos(7 * t + p.seed * 0.6 + k * 0.23);
    pts.push([p.x + Math.cos(t) * r * wobble * (p.sx ?? 1), p.y + Math.sin(t) * r * wobble * (p.sy ?? 1)]);
  }
  // Closed Catmull-Rom → cubic Bézier
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % N];
    const p3 = pts[(i + 2) % N];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

function build(peaks: Peak[]) {
  return peaks.flatMap((p) => Array.from({ length: p.rings }, (_, k) => ({ d: ring(p, k), index: k })));
}

const VARIANTS = {
  hero: build([
    { x: 640, y: 120, rings: 16, r0: 18, step: 26, seed: 1.3, sx: 1.25 },
    { x: 120, y: 520, rings: 10, r0: 30, step: 30, seed: 4.1, sy: 0.8 },
  ]),
  card: build([
    { x: 700, y: 80, rings: 13, r0: 14, step: 24, seed: 2.2, sx: 1.3 },
    { x: 60, y: 560, rings: 8, r0: 24, step: 28, seed: 5.4 },
  ]),
  empty: build([{ x: 400, y: 300, rings: 12, r0: 16, step: 22, seed: 3.3, sx: 1.4 }]),
};

export type TopoVariant = keyof typeof VARIANTS;

export function Topo({
  variant = "hero",
  className,
  opacity = 0.09,
}: {
  variant?: TopoVariant;
  className?: string;
  opacity?: number;
}) {
  const paths = VARIANTS[variant];
  return (
    <svg
      aria-hidden
      viewBox="0 0 800 600"
      preserveAspectRatio="xMidYMid slice"
      className={cx("tt-topo pointer-events-none absolute inset-0 size-full text-topo", className)}
    >
      <g fill="none" stroke="currentColor" strokeWidth={1} style={{ opacity }}>
        {paths.map((p, i) => (
          <path key={i} d={p.d} strokeWidth={p.index % 5 === 4 ? 1.6 : 0.9} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  );
}
