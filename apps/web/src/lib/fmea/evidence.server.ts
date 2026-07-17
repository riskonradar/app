/* eslint-disable @typescript-eslint/no-explicit-any */

import "server-only";

import type { EvidenceReference } from "@/lib/fmea/types";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

type EvidenceLineageRow = {
  failure_mode_claim_id: string;
  evidence: EvidenceReference[] | null;
};

export async function getFmeaEvidenceByFailureModeClaimIds(failureModeClaimIds: string[]) {
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

  for (const row of (data ?? []) as EvidenceLineageRow[]) {
    result.set(row.failure_mode_claim_id, Array.isArray(row.evidence) ? row.evidence : []);
  }

  return result;
}
