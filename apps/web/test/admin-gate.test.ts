import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: mocks.currentUser,
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

function clerkUser(email: string) {
  return {
    id: "user_admin",
    primaryEmailAddressId: "email_primary",
    emailAddresses: [
      {
        id: "email_primary",
        emailAddress: email,
      },
    ],
  };
}

describe("requireAdmin", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ADMIN_EMAILS", "admin@riskonradar.com, operations@riskonradar.com");
    mocks.currentUser.mockReset();
    mocks.notFound.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns not found when there is no Clerk user", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const { requireAdmin } = await import("@/lib/admin/gate");

    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  test("returns not found when the primary email is not allowed", async () => {
    mocks.currentUser.mockResolvedValue(clerkUser("engineer@riskonradar.com"));
    const { requireAdmin } = await import("@/lib/admin/gate");

    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  test("allows a matching primary email with normalized casing and whitespace", async () => {
    const user = clerkUser("Admin@RiskOnRadar.com");
    vi.stubEnv("ADMIN_EMAILS", " other@example.com, ADMIN@riskonradar.com ");
    mocks.currentUser.mockResolvedValue(user);
    const { requireAdmin } = await import("@/lib/admin/gate");

    await expect(requireAdmin()).resolves.toBe(user);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
