import { findComponentTaxonomyNode } from "@riskonradar/shared/taxonomy";

import { ensureCurrentWorkspace } from "@/lib/account/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const workspace = await ensureCurrentWorkspace(request);
  if (!workspace) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() || null;
  const component = searchParams.get("component")?.trim() || query;
  const componentNode = findComponentTaxonomyNode(component);
  const domain = searchParams.get("domain")?.trim() || null;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10), 500);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10), 0);

  const supabase = getSupabaseServiceClient();
  const { data, error } = componentNode
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)("search_fmea_by_component", {
        p_component_slug: componentNode.slug,
        p_domain: domain,
        p_limit: limit,
        p_offset: offset,
        p_min_confidence: 0,
      })
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)("search_fmea_evidence", {
        p_query: query,
        p_limit: limit,
        p_offset: offset,
      });

  if (error) {
    console.error("knowledge search error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    rows: data ?? [],
    total: data?.length ?? 0,
    taxonomyMatch: componentNode
      ? {
          name: componentNode.name,
          slug: componentNode.slug,
          path: componentNode.path,
        }
      : null,
  });
}
