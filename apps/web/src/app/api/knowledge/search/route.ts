import { getSupabaseServiceClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() || null;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10), 500);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10), 0);

  const supabase = getSupabaseServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("search_fmea_evidence", {
    p_query: query,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    console.error("search_fmea_evidence error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ rows: data ?? [], total: data?.length ?? 0 });
}
