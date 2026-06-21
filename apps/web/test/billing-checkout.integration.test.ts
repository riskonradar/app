import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("billing checkout hardening", () => {
  test("Mollie configuration accepts the test-key fallback", async () => {
    const configSource = await readFile("src/lib/config.ts", "utf8");
    const mollieSource = await readFile("src/lib/mollie/server.ts", "utf8");

    expect(configSource).toContain("MOLLIE_TEST_API_KEY");
    expect(configSource).toContain("getMollieApiKey");
    expect(mollieSource).toContain("getMollieApiKey");
    expect(mollieSource).not.toContain('getRequiredEnv("MOLLIE_API_KEY")');
  });

  test("checkout requires a persisted workspace and a returned checkout URL", async () => {
    const source = await readFile("src/app/api/billing/create-payment/route.ts", "utf8");

    expect(source).toContain("const workspace = await ensureCurrentWorkspace(request);");
    expect(source).not.toContain("signed_in_demo");
    expect(source).not.toContain("demo-${clerkContext.userId}");
    expect(source).toContain("Mollie did not return a checkout URL");
  });
});
