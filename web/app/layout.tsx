import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Zilla_Slab } from "next/font/google";
import "@/styles/globals.css";
import { AppShell } from "@/components/trail/app-shell";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-mono-source", subsets: ["latin"], display: "swap" });
const zilla = Zilla_Slab({ variable: "--font-zilla", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "TrailTruth — Check once. Then go outside.",
    template: "%s · TrailTruth",
  },
  description:
    "National-park alerts distilled into one printable go / no-go trail card by a tiny open model. Check once, then go outside.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f6" },
    { media: "(prefers-color-scheme: dark)", color: "#161512" },
  ],
};

// Runs before paint: stored theme, else the OS preference (persisted so the
// BoardUI ThemeToggle agrees on mount).
const themeScript = `(function(){try{var k='boardui:theme',t=localStorage.getItem(k);if(t!=='dark'&&t!=='light'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';localStorage.setItem(k,t);}document.documentElement.classList.toggle('dark',t==='dark');}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable} ${zilla.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full font-sans">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
