import { ensureCurrentWorkspace } from "@/lib/account/server";

export type WorkspaceMutationPermission = "billing" | "content" | "organization";

type Workspace = NonNullable<Awaited<ReturnType<typeof ensureCurrentWorkspace>>>;

export type WorkspaceMutationAccess =
  | {
      ok: true;
      workspace: Workspace;
    }
  | {
      ok: false;
      error: string;
      status: 401 | 403;
    };

const ALLOWED_ROLES: Record<WorkspaceMutationPermission, ReadonlySet<string>> = {
  billing: new Set(["owner", "admin"]),
  content: new Set(["owner", "admin", "member"]),
  organization: new Set(["owner", "admin"]),
};

export function canMutateWorkspace(
  role: string,
  permission: WorkspaceMutationPermission,
) {
  return ALLOWED_ROLES[permission].has(role);
}

export async function requireWorkspaceMutationAccess(
  request: Request,
  permission: WorkspaceMutationPermission,
): Promise<WorkspaceMutationAccess> {
  const workspace = await ensureCurrentWorkspace(request);
  if (!workspace) {
    return {
      ok: false,
      error: "Sign in to continue.",
      status: 401,
    };
  }

  if (!canMutateWorkspace(workspace.role, permission)) {
    return {
      ok: false,
      error: `Your workspace role cannot manage ${permission} settings.`,
      status: 403,
    };
  }

  return { ok: true, workspace };
}
