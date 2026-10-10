// Shared helpers for the TrailTruth blog visuals.
// Decision signals are always shape + color + label: go = circle, caution = triangle, no_go = octagon.
window.TTV = (function () {
  const C = {
    go: "#22804f", caution: "#c27c00", no_go: "#b42318",
    goS: "#e4f2e8", cautionS: "#fcf0d4", no_goS: "#fbe6e2",
  };
  const LABEL = { go: "Go", caution: "Caution", no_go: "No-go" };

  function octPts(cx, cy, r) {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      pts.push((cx + r * Math.cos(a)).toFixed(2) + "," + (cy + r * Math.sin(a)).toFixed(2));
    }
    return pts.join(" ");
  }
  function triPts(cx, cy, r) {
    // equilateral, optically centred
    const h = r * 1.9;
    const top = cy - h * 0.58, bot = cy + h * 0.42, half = h / Math.sqrt(3);
    return `${cx},${top.toFixed(2)} ${(cx + half).toFixed(2)},${bot.toFixed(2)} ${(cx - half).toFixed(2)},${bot.toFixed(2)}`;
  }
  // kind: go|caution|no_go ; style: "fill" | "outline"
  function shape(kind, cx, cy, r, style = "fill", color) {
    const col = color || C[kind];
    const fill = style === "fill" ? col : "none";
    const sw = style === "fill" ? 0 : Math.max(1.6, r * 0.28);
    const common = `fill="${fill}" stroke="${col}" stroke-width="${sw}" stroke-linejoin="round"`;
    if (kind === "go") return `<circle cx="${cx}" cy="${cy}" r="${style === "fill" ? r : r - sw / 2}" ${common}/>`;
    if (kind === "caution") return `<polygon points="${triPts(cx, cy, style === "fill" ? r * 1.08 : r * 1.0)}" ${common}/>`;
    return `<polygon points="${octPts(cx, cy, style === "fill" ? r * 1.04 : r - sw / 2)}" ${common}/>`;
  }
  // small inline svg icon for HTML text
  function icon(kind, size = 12, style = "fill") {
    const r = size / 2;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="vertical-align:-1px">${shape(kind, r, r, r * 0.92, style)}</svg>`;
  }
  const money = (v) => (v === 0 ? "$0" : "$" + v.toFixed(2));
  return { C, LABEL, shape, icon, money };
})();
