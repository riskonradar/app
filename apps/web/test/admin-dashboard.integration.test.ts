import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const gateMocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: gateMocks.currentUser,
}));

vi.mock("next/navigation", () => ({
  notFound: gateMocks.notFound,
}));

const originalAdminEmails = process.env.ADMIN_EMAILS;

describe("admin pipeline dashboard boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAILS = "founder@example.com, operations@example.com";
  });

  afterEach(() => {
    if (originalAdminEmails === undefined) {
      delete process.env.ADMIN_EMAILS;
    } else {
      process.env.ADMIN_EMAILS = originalAdminEmails;
    }
  });

  test("the hard gate hides no-user and wrong-email requests with notFound", async () => {
    const { requireAdmin } = await import("@/lib/admin/gate");

    gateMocks.currentUser.mockResolvedValueOnce(null);
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");

    gateMocks.currentUser.mockResolvedValueOnce({
      primaryEmailAddressId: "email-1",
      emailAddresses: [{ id: "email-1", emailAddress: "intruder@example.com" }],
    });
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(gateMocks.notFound).toHaveBeenCalledTimes(2);
  });

  test("the hard gate accepts only a listed primary email, case-insensitively", async () => {
    const { requireAdmin } = await import("@/lib/admin/gate");
    const user = {
      primaryEmailAddressId: "email-1",
      emailAddresses: [{ id: "email-1", emailAddress: "Founder@Example.com" }],
    };
    gateMocks.currentUser.mockResolvedValueOnce(user);

    await expect(requireAdmin()).resolves.toBe(user);
    expect(gateMocks.notFound).not.toHaveBeenCalled();
  });

  test("the hard gate fails closed when ADMIN_EMAILS is unset", async () => {
    const { requireAdmin } = await import("@/lib/admin/gate");
    delete process.env.ADMIN_EMAILS;
    gateMocks.currentUser.mockResolvedValueOnce({
      primaryEmailAddressId: "email-1",
      emailAddresses: [{ id: "email-1", emailAddress: "founder@example.com" }],
    });

    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  test("the route gates access before loading query parameters or data", async () => {
    const source = await readFile("src/app/admin/page.tsx", "utf8");
    const gateCall = source.indexOf("await requireAdmin();");
    const paramsRead = source.indexOf("const params = await searchParams;");
    const dataLoad = source.indexOf("await getAdminDashboard");

    expect(gateCall).toBeGreaterThan(0);
    expect(gateCall).toBeLessThan(paramsRead);
    expect(gateCall).toBeLessThan(dataLoad);
  });

  test("the admin route is bookmark-only and protected by middleware plus its page gate", async () => {
    const [navigation, proxy] = await Promise.all([
      readFile("src/components/app-nav.tsx", "utf8"),
      readFile("src/proxy.ts", "utf8"),
    ]);

    expect(navigation).not.toContain('href="/admin"');
    expect(proxy).toContain('"/admin/:path*"');
    expect(proxy.slice(0, proxy.indexOf("export default"))).toContain('"/admin(.*)"');
  });

  test("the server data layer contains no database mutations", async () => {
    const source = await readFile("src/lib/admin/server.ts", "utf8");

    expect(source).toContain("getSupabaseServiceClient");
    expect(source).toContain('"get_taxonomy_inbox"');
    expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  test("failed LLM attempts remain visible after a keyword fallback classifies the paper", async () => {
    const source = await readFile("src/lib/admin/server.ts", "utf8");

    expect(source).toContain("const visiblePaperIds = paperRows.map");
    expect(source).toContain('.in("paper_candidate_id", visiblePaperIds)');
    expect(source).not.toContain("classification_status === \"failed\"");
  });
});
