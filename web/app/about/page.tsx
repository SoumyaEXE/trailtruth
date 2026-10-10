import type { Metadata } from "next";
import { AboutView } from "@/components/views/about";

export const metadata: Metadata = { title: "Why open" };

export default function AboutPage() {
  return <AboutView />;
}
