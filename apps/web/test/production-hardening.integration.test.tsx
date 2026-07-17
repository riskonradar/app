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

  test("saved FMEA analysis queries stay inside the active organization", async () => {
    const source = await readFile("src/lib/fmea/server.ts", "utf8");

    expect(source.match(/\.eq\("organization_id", workspace\.organization\.id\)/g)?.length)
      .toBeGreaterThanOrEqual(3);
    expect(source).not.toContain("ownerFilterForWorkspace");
    expect(source).not.toContain("user_account_id.eq.${workspace.userAccount.id}");
  });

  test("knowledge APIs require a workspace before returning product evidence", async () => {
    const [componentsRoute, searchRoute, reviewRoute] = await Promise.all([
      readFile("src/app/api/knowledge/components/route.ts", "utf8"),
      readFile("src/app/api/knowledge/search/route.ts", "utf8"),
      readFile("src/app/api/knowledge/review/route.ts", "utf8"),
    ]);

    for (const source of [componentsRoute, searchRoute]) {
      expect(source).toContain("ensureCurrentWorkspace(request)");
      expect(source).toContain('Response.json({ error: "Unauthorized" }, { status: 401 })');
    }

    expect(reviewRoute).toContain('requireWorkspaceMutationAccess(request, "content")');

    expect(searchRoute).toContain("getSupabaseServiceClient");
    expect(searchRoute).not.toContain("getSupabaseAnonClient");
  });

  test("middleware protects authenticated product routes and product APIs", async () => {
    const source = await readFile("src/proxy.ts", "utf8");

    expect(source).toContain("clerkMiddleware");
    expect(source).toContain("createRouteMatcher");
    expect(source).toContain('"/fmea(.*)"');
    expect(source).toContain('"/admin(.*)"');
    expect(source).toContain('"/api/knowledge(.*)"');
    expect(source).toContain('"/api/fmea(.*)"');
    expect(source).toContain('"/api/billing/payment-status"');
    expect(source).toContain("auth.protect()");
    expect(source).not.toContain("stripe-webhook");
  });

  test("account bootstrap cannot overwrite webhook identity or paid-plan state", async () => {
    const [accountSource, clerkWebhookSource] = await Promise.all([
      readFile("src/lib/account/server.ts", "utf8"),
      readFile("src/app/api/webhooks/clerk/route.ts", "utf8"),
    ]);

    expect(accountSource.match(/ignoreDuplicates: true/g)?.length).toBe(3);
    expect(accountSource).toContain('.eq("clerk_user_id", userId)');
    expect(accountSource).toContain('.eq("clerk_organization_id", context.orgId)');
    expect(accountSource).toContain('.eq("slug", slug)');
    expect(clerkWebhookSource).toContain("email: primaryEmail");
    expect(clerkWebhookSource).toContain("first_name: first_name ?? null");
    expect(clerkWebhookSource).toContain("last_name: last_name ?? null");
  });

  test("billing return always requires server-side Stripe confirmation", async () => {
    const source = await readFile("src/app/billing/return/page.tsx", "utf8");

    expect(source).toContain("/api/billing/payment-status?session_id=");
    expect(source).not.toContain("isLocalDevCheckout");
    expect(source).not.toContain("window.location.hostname");
  });

  test("knowledge search resolves component and failure-mode taxonomies in Postgres", async () => {
    const [searchRoute, componentsRoute, taxonomyMigration] = await Promise.all([
      readFile("src/app/api/knowledge/search/route.ts", "utf8"),
      readFile("src/app/api/knowledge/components/route.ts", "utf8"),
      readFile("../../supabase/migrations/20260717170000_failure_mode_taxonomy_search.sql", "utf8"),
    ]);

    expect(searchRoute).toContain('"resolve_fmea_taxonomy_node"');
    expect(searchRoute).toContain('"search_fmea_by_component"');
    expect(searchRoute).toContain('"search_fmea_by_failure_mode"');
    expect(taxonomyMigration).toContain("component_taxonomy_id");
    expect(taxonomyMigration).toContain("failure_mode_taxonomy_id");
    expect(componentsRoute).toContain('"get_component_taxonomy"');
  });

  test("database hardening migration gates product data and removes global review mutation", async () => {
    const source = await readFile(
      "../../supabase/migrations/20260710120000_security_and_taxonomy_hardening.sql",
      "utf8",
    );

    expect(source).toContain("DROP FUNCTION IF EXISTS public.update_evidence_review_status");
    expect(source).toContain("REVOKE EXECUTE ON FUNCTION public.get_turbofan_fmea(int) FROM PUBLIC, anon");
    expect(source).toContain("SET search_path = pg_catalog");
    expect(source).toContain("auth.role() IN ('authenticated', 'service_role')");
    expect(source).toContain("auth.role() = 'service_role'");
    expect(source).toContain("llm-extractor-v2:gemini:gemini-flash-latest");
    expect(source).toContain('DROP POLICY IF EXISTS "open read paper_classifications"');
    expect(source).not.toContain('CREATE POLICY "authenticated read paper_classifications"');
  });

  test("the obsolete turbofan-only knowledge RPC is retired", async () => {
    const source = await readFile(
      "../../supabase/migrations/20260717190000_remove_legacy_turbofan_rpc.sql",
      "utf8",
    );

    expect(source).toContain("DROP FUNCTION IF EXISTS public.get_turbofan_fmea(integer)");
  });

  test("viewer workspace role cannot mutate saved analyses or evidence reviews", async () => {
    const [roleMapping, fmeaServer, reviewRoute, workspaceAccess] = await Promise.all([
      readFile("src/lib/auth/roles.ts", "utf8"),
      readFile("src/lib/fmea/server.ts", "utf8"),
      readFile("src/app/api/knowledge/review/route.ts", "utf8"),
      readFile("src/lib/auth/workspace-access.ts", "utf8"),
    ]);

    expect(roleMapping).toContain('case "org:viewer"');
    expect(roleMapping).toContain('case "org:member"');
    expect(roleMapping).toContain('default:');
    expect(roleMapping).toContain('return "viewer"');
    expect(fmeaServer).toContain('requireWorkspaceMutationAccess(request, "content")');
    expect(fmeaServer).toContain("forbidden: true as const");
    expect(reviewRoute).toContain('requireWorkspaceMutationAccess(request, "content")');
    expect(workspaceAccess).toContain('content: new Set(["owner", "admin", "member"])');
    expect(workspaceAccess).toContain("status: 403");
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
