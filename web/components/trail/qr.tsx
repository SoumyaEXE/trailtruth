import QRCode from "qrcode";
import { cx } from "@/utils/cx";

/** Synchronous SVG QR code (no canvas, SSR-safe, prints crisp). */
export function QR({ value, className, label }: { value: string; className?: string; label?: string }) {
  let size = 0;
  let d = "";
  try {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    size = qr.modules.size;
    const data = qr.modules.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (data[y * size + x]) d += `M${x} ${y}h1v1h-1z`;
      }
    }
  } catch {
    return null;
  }
  return (
    <svg
      viewBox={`-2 -2 ${size + 4} ${size + 4}`}
      className={cx("block", className)}
      role="img"
      aria-label={label ?? `QR code: ${value}`}
      shapeRendering="crispEdges"
    >
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#fff" />
      <path d={d} fill="#111" />
    </svg>
  );
}
