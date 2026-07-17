export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export function normalizeClerkOrganizationRole(
  role: string | null | undefined,
): WorkspaceRole {
  switch (role) {
    case "org:owner":
    case "owner":
      return "owner";
    case "org:admin":
    case "admin":
      return "admin";
    case "org:member":
    case "member":
      return "member";
    case "org:viewer":
    case "viewer":
    default:
      return "viewer";
  }
}
