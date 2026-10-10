import type { Metadata } from "next";
import { CardView } from "@/components/views/card";

export const metadata: Metadata = { title: "Trail card" };

export default function CardPage() {
  return <CardView />;
}
