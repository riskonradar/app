import type { Metadata } from "next";

export { default } from "./dashboard/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Reliability workspace",
};
