import React from "react";
import { readFile } from "node:fs/promises";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  getWorkspaceSummary: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: mocks.currentUser,
}));

vi.mock("@clerk/nextjs", () => ({
  SignInButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  UserButton: () => <button type="button">User menu</button>,
  useUser: mocks.useUser,
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/account/server", () => ({
  getWorkspaceSummary: mocks.getWorkspaceSummary,
}));

describe("production hardening flows", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.currentUser.mockReset();
    mocks.getWorkspaceSummary.mockReset();
    mocks.useUser.mockReset();

    mocks.currentUser.mockImplementation(() => Promise.resolve(null));
    mocks.getWorkspaceSummary.mockImplementation(() => Promise.resolve(null));

    mocks.useUser.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: {
        firstName: "Riley",
        fullName: "Riley Engineer",
        primaryEmailAddress: { emailAddress: "riley@example.com" },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("dashboard renders the saved-analysis workspace without redirecting to a new worksheet", async () => {
    const { default: DashboardPage } = await import("@/app/dashboard/page");

    const page = await DashboardPage();

    render(page);

    expect(screen.getByText("Your Failure Mode and Effects Analysis tables")).toBeInTheDocument();
    expect(screen.getByText("Open an analysis to continue editing")).toBeInTheDocument();
    expect(screen.getByLabelText("Create new Failure Mode and Effects Analysis table")).toHaveAttribute(
      "href",
      "/fmea?mode=new",
    );
  });

  test("saved FMEA analyses are hydrated from the account API instead of browser localStorage", async () => {
    const source = await readFile("src/components/fmea/analysis-list.tsx", "utf8");

    expect(source).not.toContain("localStorage");
    expect(source).toContain("/api/fmea/analyses");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        analyses: [
          {
            id: "server-analysis",
            name: "Server-backed Failure Mode and Effects Analysis",
            scope: "2 components",
            rowCount: 4,
            componentCount: 2,
            includedCount: 3,
            highestRpn: 144,
            updatedAt: "2026-06-21",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    window.localStorage.setItem(
      "riskonradar-fmea-analyses",
      JSON.stringify([
        {
          id: "browser-only-analysis",
          name: "Browser-only injected Failure Mode and Effects Analysis",
          scope: "1 component",
          rowCount: 1,
          componentCount: 1,
          includedCount: 1,
          highestRpn: 999,
          updatedAt: "localStorage",
        },
      ]),
    );

    const { AnalysisList } = await import("@/components/fmea/analysis-list");

    render(<AnalysisList />);

    expect(
      screen.queryByText("Browser-only injected Failure Mode and Effects Analysis"),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText("Server-backed Failure Mode and Effects Analysis"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Server-backed Failure Mode and Effects Analysis").closest("a"),
    ).toHaveAttribute("href", "/fmea?analysis=server-analysis");
    expect(fetchMock).toHaveBeenCalledWith("/api/fmea/analyses", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  });

  test("saved FMEA analysis mutations use account API endpoints", async () => {
    const source = await readFile("src/components/fmea/analysis-list.tsx", "utf8");

    expect(source).toContain('method: "DELETE"');
    expect(source).toContain('method: "PATCH"');
    expect(source).toContain("/api/fmea/analyses/${analysis.id}");
  });

  test("saved FMEA analysis queries match organization or user ownership", async () => {
    const source = await readFile("src/lib/fmea/server.ts", "utf8");

    expect(source).toContain("organization_id.eq.${workspace.organization.id}");
    expect(source).toContain("user_account_id.eq.${workspace.userAccount.id}");
    expect(source.match(/\.or\(ownerFilterForWorkspace/g)?.length).toBeGreaterThanOrEqual(5);
  });

  test("account membership display prefers server billing status over localStorage", async () => {
    window.localStorage.setItem(
      "riskonradar-membership",
      JSON.stringify({
        planKey: "individual",
        status: "paid",
        paidAt: "2026-06-21T00:00:00.000Z",
      }),
    );

    const { AccountOverview } = await import("@/app/account/account-overview");
    const { MembershipStatus } = await import("@/components/billing/membership-status");

    render(
      <>
        <AccountOverview
          billingStatus="free"
          memberCount={1}
          role="owner"
          serverPlan="individual"
          workspaceName="Personal workspace"
          workspaceSlug="personal-riley"
        />
        <MembershipStatus serverPlan="individual" serverStatus="free" />
      </>,
    );

    expect(screen.queryByText("You are a Pro member")).not.toBeInTheDocument();
    expect(screen.queryByText("Pro")).not.toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Free workspace")).toBeInTheDocument();
  });

  test("billing success does not grant membership from the browser without server confirmation", async () => {
    const source = await readFile("src/app/billing/success/page.tsx", "utf8");

    expect(source).not.toContain("localStorage");

    const { default: BillingSuccessPage } = await import("@/app/billing/success/page");
    mocks.getWorkspaceSummary.mockResolvedValue({
      organization: {
        billing_status: "free",
        name: "Personal workspace",
        plan_key: "individual",
      },
    });

    render(await BillingSuccessPage());

    expect(screen.queryByText("You are now a Pro member")).not.toBeInTheDocument();
    expect(screen.getByText("Payment received, plan update pending")).toBeInTheDocument();
    expect(screen.getByText("free")).toBeInTheDocument();
    expect(window.localStorage.getItem("riskonradar-membership")).toBeNull();
  });
});
