import type { NextConfig } from "next";

// STATIC_EXPORT=1 npm run build → a fully static demo (renders from /fixtures).
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  reactCompiler: true,
  ...(staticExport ? { output: "export" as const, images: { unoptimized: true } } : {}),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
