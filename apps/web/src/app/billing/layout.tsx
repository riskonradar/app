import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Billing",
  description: "Verify and manage Risk on Radar billing status.",
};

export default function BillingLayout({ children }: { children: ReactNode }) {
  return children;
}
