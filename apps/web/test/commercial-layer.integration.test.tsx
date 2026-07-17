import React from "react";
import { readFile } from "node:fs/promises";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { BillingLifecycleNotice } from "@/components/billing/billing-lifecycle-notice";
import { canMutateWorkspace } from "@/lib/auth/workspace-access";

describe("commercial workspace layer", () => {
  test("workspace mutation roles are consistent by permission", () => {
    expect(canMutateWorkspace("owner", "billing")).toBe(true);
    expect(canMutateWorkspace("admin", "billing")).toBe(true);
    expect(canMutateWorkspace("member", "billing")).toBe(false);
    expect(canMutateWorkspace("viewer", "billing")).toBe(false);

    expect(canMutateWorkspace("owner", "content")).toBe(true);
    expect(canMutateWorkspace("admin", "content")).toBe(true);
    expect(canMutateWorkspace("member", "content")).toBe(true);
    expect(canMutateWorkspace("viewer", "content")).toBe(false);
  });

  test("past-due and cancelled workspaces show an actionable downgrade state", () => {
    const { rerender } = render(
      <BillingLifecycleNotice status="past_due" />,
    );

    expect(screen.getByText("Payment needs attention")).toBeInTheDocument();
    expect(screen.getByText(/Paid workspace limits are paused/)).toBeInTheDocument();

    rerender(<BillingLifecycleNotice status="cancelled" />);
    expect(screen.getByText("Subscription ended")).toBeInTheDocument();
    expect(screen.getByText(/free-plan limits/)).toBeInTheDocument();
  });

  test("Clerk organization management and purchased-seat synchronization are wired", async () => {
    const [manager, webhook, billingServer] = await Promise.all([
      readFile("src/app/organization/[[...organization-profile]]/organization-manager.tsx", "utf8"),
      readFile("src/app/api/webhooks/clerk/route.ts", "utf8"),
      readFile("src/lib/billing/server.ts", "utf8"),
    ]);

    expect(manager).toContain("OrganizationProfile");
    expect(manager).toContain("OrganizationList");
    expect(webhook).toContain("TRIAL_ORGANIZATION_SEAT_LIMIT");
    expect(webhook).toContain("maxAllowedMemberships: seatLimit");
    expect(billingServer).toContain("maxAllowedMemberships: seats");
  });

  test("both environment templates expose portal and opt-in tax settings", async () => {
    const [appEnv, rootEnv] = await Promise.all([
      readFile(".env.example", "utf8"),
      readFile("../../.env.example", "utf8"),
    ]);

    for (const source of [appEnv, rootEnv]) {
      expect(source).toContain("STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID=");
      expect(source).toContain("STRIPE_TEAM_EXTRA_SEAT_PRICE_ID=");
      expect(source).toContain("STRIPE_TAX_ENABLED=false");
    }
  });
});
