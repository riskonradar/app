import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "FMEA workspace · Risk on Radar",
  description: "Build and review evidence-backed Failure Mode and Effects Analysis worksheets.",
};

export default function FmeaLayout({ children }: { children: ReactNode }) {
  return children;
}
