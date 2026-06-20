import { getCurrentClerkUserId } from "@/lib/auth/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

const VALID_STATUSES = ["accepted", "rejected", "edited", "needs_review"] as const;
type ReviewStatus = (typeof VALID_STATUSES)[number];

export async function POST(request: Request) {
  const userId = await getCurrentClerkUserId();
  if (!userId) {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)("update_evidence_review_status", {
    p_claim_id: claimId,
    p_status: status,
  });

  if (error) {
    console.error("update_evidence_review_status error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ updated: true });
}
