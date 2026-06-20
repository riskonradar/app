import { getSupabaseServiceClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10), 200);

  const supabase = getSupabaseServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_knowledge_components", { p_limit: limit });

  if (error) {
    console.error("get_knowledge_components error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ components: data ?? [] });
}
