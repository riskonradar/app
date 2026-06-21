/* eslint-disable @typescript-eslint/no-explicit-any */

import { ensureCurrentWorkspace } from "@/lib/account/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

const VALID_STATUSES = ["accepted", "rejected", "edited", "needs_review"] as const;
type ReviewStatus = (typeof VALID_STATUSES)[number];

export async function POST(request: Request) {
  const workspace = await ensureCurrentWorkspace();
  if (!workspace) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { claimId, status } = body as { claimId?: string; status?: string };

  if (!claimId || !status) {
    return Response.json({ error: "claimId and status are required" }, { status: 400 });
  }

  if (!VALID_STATUSES.includes(status as ReviewStatus)) {
    return Response.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await (supabase as any).schema("app")
    .from("evidence_claim_reviews")
    .upsert(
      {
        organization_id: workspace.organization.id,
        evidence_claim_id: claimId,
        reviewer_user_account_id: workspace.userAccount.id,
        review_status: status,
      },
      { onConflict: "organization_id,evidence_claim_id" },
    );

  if (error) {
    console.error("evidence_claim_reviews upsert error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ updated: true });
}
