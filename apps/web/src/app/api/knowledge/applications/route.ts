import { ensureCurrentWorkspace } from "@/lib/account/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const workspace = await ensureCurrentWorkspace(request);
  if (!workspace) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10), 200);
  const parentSlug = searchParams.get("parent")?.trim() || null;

  const supabase = getSupabaseServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_application_taxonomy", {
    p_parent_slug: parentSlug,
  });

  if (error) {
    console.error("get_application_taxonomy error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ applications: (data ?? []).slice(0, limit) });
}
