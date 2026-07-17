import { ensureCurrentWorkspace } from "@/lib/account/server";
import { getFmeaEvidenceByFailureModeClaimIds } from "@/lib/fmea/evidence.server";
import { parseKnowledgeSearchParams } from "@/lib/fmea/search";
import type { TaxonomySearchType } from "@/lib/fmea/types";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

type TaxonomyMatch = {
  id: string;
  claim_type: TaxonomySearchType;
  name: string;
  slug: string;
  path: string;
};

export async function GET(request: Request) {
  const workspace = await ensureCurrentWorkspace(request);
  if (!workspace) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { query, type, domain, limit, offset } = parseKnowledgeSearchParams(request.url);
  const supabase = getSupabaseServiceClient();
  let taxonomyMatch: TaxonomyMatch | null = null;

  if (query) {
    // The database taxonomy is authoritative; the web app no longer maintains a
    // second flat alias dictionary that can collapse specific engineering terms.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolved = await (supabase.rpc as any)("resolve_fmea_taxonomy_node", {
      p_claim_type: type,
      p_query: query,
    });
    if (resolved.error) {
      console.error("taxonomy resolution error:", resolved.error);
      return Response.json({ error: resolved.error.message }, { status: 500 });
    }
    taxonomyMatch = (resolved.data?.[0] as TaxonomyMatch | undefined) ?? null;
  }

  let rpcName: string;
  let rpcArguments: Record<string, unknown>;
  if (taxonomyMatch?.claim_type === "component") {
    rpcName = "search_fmea_by_component";
    rpcArguments = {
      p_component_slug: taxonomyMatch.slug,
      p_domain: domain,
      p_limit: limit,
      p_offset: offset,
      p_min_confidence: 0,
    };
  } else if (taxonomyMatch?.claim_type === "failure_mode") {
    rpcName = "search_fmea_by_failure_mode";
    rpcArguments = {
      p_failure_mode_slug: taxonomyMatch.slug,
      p_component_slug: null,
      p_domain: domain,
      p_limit: limit,
      p_offset: offset,
      p_min_confidence: 0,
    };
  } else {
    // Unresolved terms still get a literal evidence search, but are never
    // rewritten to a guessed taxonomy node.
    rpcName = "search_fmea_evidence";
    rpcArguments = {
      p_query: query,
      p_limit: limit,
      p_offset: offset,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const searchResult = await (supabase.rpc as any)(rpcName, rpcArguments);

  if (searchResult.error) {
    console.error("knowledge search error:", searchResult.error);
    return Response.json({ error: searchResult.error.message }, { status: 500 });
  }

  const rows = searchResult.data ?? [];
  let total = Number(rows[0]?.total_count ?? 0);
  if (!rows.length && offset > 0) {
    // A window count cannot be returned from an empty out-of-range page. Probe
    // the first row so `total` remains the real unpaginated result count.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const countProbe = await (supabase.rpc as any)(rpcName, {
      ...rpcArguments,
      p_limit: 1,
      p_offset: 0,
    });
    if (countProbe.error) {
      console.error("knowledge search count probe error:", countProbe.error);
      return Response.json({ error: countProbe.error.message }, { status: 500 });
    }
    total = Number(countProbe.data?.[0]?.total_count ?? 0);
  }
  const evidenceByFailureMode = await getFmeaEvidenceByFailureModeClaimIds(
    rows
      .map((row: { failure_mode_claim_id?: string }) => row.failure_mode_claim_id)
      .filter(Boolean),
  );

  return Response.json({
    rows: rows.map((row: { failure_mode_claim_id: string }) => ({
      ...row,
      evidence: evidenceByFailureMode.get(row.failure_mode_claim_id) ?? [],
    })),
    total,
    pagination: {
      limit,
      offset,
      hasNext: offset + rows.length < total,
    },
    taxonomyMatch: taxonomyMatch
      ? {
          id: taxonomyMatch.id,
          type: taxonomyMatch.claim_type,
          name: taxonomyMatch.name,
          slug: taxonomyMatch.slug,
          path: taxonomyMatch.path,
        }
      : null,
  });
}
