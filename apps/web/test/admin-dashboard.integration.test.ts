import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("admin pipeline dashboard boundaries", () => {
  test("the route gates access before loading query parameters or data", async () => {
    const source = await readFile("src/app/admin/page.tsx", "utf8");
    const gateCall = source.indexOf("await requireAdmin();");
    const paramsRead = source.indexOf("const params = await searchParams;");
    const dataLoad = source.indexOf("await getAdminDashboard");

    expect(gateCall).toBeGreaterThan(0);
    expect(gateCall).toBeLessThan(paramsRead);
    expect(gateCall).toBeLessThan(dataLoad);
  });

  test("the admin route is bookmark-only and not protected by a redirecting middleware gate", async () => {
    const [navigation, proxy] = await Promise.all([
      readFile("src/components/app-nav.tsx", "utf8"),
      readFile("src/proxy.ts", "utf8"),
    ]);

    expect(navigation).not.toContain('href="/admin"');
    expect(proxy).toContain('"/admin/:path*"');
    expect(proxy.slice(0, proxy.indexOf("export default"))).not.toContain('"/admin(.*)"');
  });

  test("the server data layer contains no database mutations", async () => {
    const source = await readFile("src/lib/admin/server.ts", "utf8");

    expect(source).toContain("getSupabaseServiceClient");
    expect(source).toContain('"get_taxonomy_inbox"');
    expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});
