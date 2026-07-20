/* eslint-disable @typescript-eslint/no-explicit-any */

import "server-only";

import type { EvidenceReference } from "@/lib/fmea/types";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

type EvidenceLineageRow = {
  failure_mode_claim_id: string;
  evidence: EvidenceReference[] | null;
};

export async function getFmeaEvidenceByFailureModeClaimIds(
  failureModeClaimIds: string[],
  organizationId?: string,
) {
  const uniqueIds = [...new Set(failureModeClaimIds.filter(Boolean))].slice(0, 500);
  const result = new Map<string, EvidenceReference[]>();
  if (!uniqueIds.length) return result;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await (supabase.rpc as any)("get_fmea_evidence_lineage", {
    p_failure_mode_claim_ids: uniqueIds,
  });

  if (error) {
    console.error("Failed to load FMEA evidence lineage:", error);
    throw new Error("Could not load evidence lineage.");
  }

  const lineageRows = (data ?? []) as EvidenceLineageRow[];
  const organizationReviews = new Map<string, string>();
  if (organizationId) {
    const claimIds = [
      ...new Set(
        lineageRows.flatMap((row) =>
          (Array.isArray(row.evidence) ? row.evidence : [])
            .map((reference) => reference.claimId)
            .filter(Boolean),
        ),
      ),
    ].slice(0, 5_000);

    for (let offset = 0; offset < claimIds.length; offset += 500) {
      const { data: reviews, error: reviewError } = await (supabase as any)
        .schema("app")
        .from("evidence_claim_reviews")
        .select("evidence_claim_id, review_status")
        .eq("organization_id", organizationId)
        .in("evidence_claim_id", claimIds.slice(offset, offset + 500));
      if (reviewError) {
        console.error("Failed to load workspace evidence reviews:", reviewError);
        throw new Error("Could not load workspace evidence reviews.");
      }
      for (const review of reviews ?? []) {
        organizationReviews.set(review.evidence_claim_id, review.review_status);
      }
    }
  }

  for (const row of lineageRows) {
    const evidence = Array.isArray(row.evidence) ? row.evidence : [];
    result.set(
      row.failure_mode_claim_id,
      evidence.map((reference) => ({
        ...reference,
        reviewStatus: organizationReviews.get(reference.claimId) ?? reference.reviewStatus,
      })),
    );
  }

  return result;
}
