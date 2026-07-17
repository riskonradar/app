/* eslint-disable @typescript-eslint/no-explicit-any */

import { ensureCurrentWorkspace } from "@/lib/account/server";
import { requireWorkspaceMutationAccess } from "@/lib/auth/workspace-access";
import type { EvidenceReference, ScoreSuggestions } from "@/lib/fmea/types";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export type PersistedFmeaRow = {
  id: string;
  componentTaxonomyId?: string;
  failureModeTaxonomyId?: string;
  component: string;
  function: string;
  requirement: string;
  industry: string;
  failureMode: string;
  effect: string;
  severity: string;
  cause: string;
  occurrence: string;
  currentControl: string;
  detection: string;
  correctiveAction: string;
  rpn: string;
  evidenceCount: number;
  sources: unknown[];
  evidence: EvidenceReference[];
  scoreSuggestions?: ScoreSuggestions;
  owner: string;
  status: "needs_review" | "accepted" | "rejected";
  included: boolean;
};

export type FmeaAnalysisPayload = {
  id?: string | null;
  name?: string | null;
  rows?: PersistedFmeaRow[];
};

type Workspace = NonNullable<Awaited<ReturnType<typeof ensureCurrentWorkspace>>>;

function appSchema() {
  return (getSupabaseServiceClient() as any).schema("app");
}

function isProWorkspace(workspace: Workspace) {
  return ["active", "comped"].includes(workspace.organization.billing_status);
}

function normalizeStatus(value: unknown): PersistedFmeaRow["status"] {
  if (value === "accepted" || value === "rejected") return value;
  return "needs_review";
}

function clientRowFromDb(row: any): PersistedFmeaRow {
  const metadata = (row.model_metadata ?? {}) as Record<string, any>;
  const evidence = (Array.isArray(metadata.evidence) ? metadata.evidence : []).map(
    (reference: EvidenceReference) => ({
      ...reference,
      spans: Array.isArray(reference.spans)
        ? reference.spans.filter((span) => span.licenseSafe === true)
        : [],
    }),
  );

  return {
    id: String(metadata.clientRowId || row.id),
    componentTaxonomyId: metadata.componentTaxonomyId || undefined,
    failureModeTaxonomyId: metadata.failureModeTaxonomyId || undefined,
    component: row.component ?? "",
    function: row.function ?? "",
    requirement: String(metadata.requirement ?? ""),
    industry: String(metadata.industry ?? ""),
    failureMode: row.failure_mode ?? "",
    effect: row.effect ?? "",
    severity: row.severity ? String(row.severity) : "",
    cause: row.cause ?? "",
    occurrence: row.occurrence ? String(row.occurrence) : "",
    currentControl: row.controls ?? "",
    detection: row.detection_rating ? String(row.detection_rating) : "",
    correctiveAction: row.recommended_action ?? "",
    rpn: String(metadata.rpn ?? ""),
    evidenceCount: Number(metadata.evidenceCount || 0),
    sources: Array.isArray(metadata.sources) ? metadata.sources : [],
    evidence,
    scoreSuggestions: metadata.scoreSuggestions ?? {},
    owner: row.responsible_owner ?? "",
    status: normalizeStatus(row.review_status),
    included: metadata.included !== false,
  };
}

function rowRpn(row: PersistedFmeaRow) {
  const explicit = Number(row.rpn);
  if (explicit > 0) return explicit;
  const severity = Number(row.severity);
  const occurrence = Number(row.occurrence);
  const detection = Number(row.detection);
  if (!severity || !occurrence || !detection) return 0;
  return severity * occurrence * detection;
}

function analysisSummary(analysis: any, rows: PersistedFmeaRow[]) {
  const components = Array.from(new Set(rows.map((row) => row.component).filter(Boolean))).sort();
  const includedRows = rows.filter((row) => row.included);
  const topRisks = [...rows]
    .filter((row) => rowRpn(row) > 0)
    .sort((a, b) => rowRpn(b) - rowRpn(a) || b.evidenceCount - a.evidenceCount)
    .slice(0, 3)
    .map((row) => ({
      component: row.component,
      failureMode: row.failureMode,
      rpn: rowRpn(row),
    }));

  return {
    id: analysis.id as string,
    name: analysis.name as string,
    scope: components.length === 1 ? components[0] : `${components.length} components`,
    rowCount: rows.length,
    componentCount: components.length,
    includedCount: includedRows.length,
    highestRpn: rows.reduce((max, row) => Math.max(max, rowRpn(row)), 0),
    updatedAt: new Date(analysis.updated_at ?? analysis.created_at ?? Date.now()).toLocaleString(),
    topRisks,
  };
}

async function getOwnedAnalysis(workspace: Workspace, analysisId: string) {
  const { data, error } = await appSchema()
    .from("fmea_analyses")
    .select("id, name, status, metadata, created_at, updated_at")
    .eq("id", analysisId)
    .eq("organization_id", workspace.organization.id)
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch FMEA analysis:", error);
    throw new Error("Could not load analysis.");
  }

  return data;
}

export async function resolveFmeaWorkspace(request?: Request) {
  const workspace = await ensureCurrentWorkspace(request);
  if (!workspace) return null;
  return {
    workspace,
    plan: {
      isPro: isProWorkspace(workspace),
      savedAnalysisLimit: isProWorkspace(workspace) ? null : 1,
      status: workspace.organization.billing_status,
    },
  };
}

export async function listFmeaAnalyses(request?: Request) {
  const resolved = await resolveFmeaWorkspace(request);
  if (!resolved) return null;

  const { workspace, plan } = resolved;
  const { data: analyses, error: analysesError } = await appSchema()
    .from("fmea_analyses")
    .select("id, name, status, metadata, created_at, updated_at")
    .neq("status", "archived")
    .eq("organization_id", workspace.organization.id)
    .order("updated_at", { ascending: false });

  if (analysesError) {
    console.error("Failed to list FMEA analyses:", analysesError);
    throw new Error("Could not list analyses.");
  }

  const analysisIds = (analyses ?? []).map((analysis: any) => analysis.id);
  const rowsByAnalysis = new Map<string, PersistedFmeaRow[]>();

  if (analysisIds.length) {
    const { data: rows, error: rowsError } = await appSchema()
      .from("fmea_rows")
      .select("*")
      .in("analysis_id", analysisIds)
      .neq("review_status", "superseded");

    if (rowsError) {
      console.error("Failed to list FMEA analysis rows:", rowsError);
      throw new Error("Could not list analysis rows.");
    }

    for (const row of rows ?? []) {
      const nextRows = rowsByAnalysis.get(row.analysis_id) ?? [];
      nextRows.push(clientRowFromDb(row));
      rowsByAnalysis.set(row.analysis_id, nextRows);
    }
  }

  return {
    analyses: (analyses ?? []).map((analysis: any) =>
      analysisSummary(analysis, rowsByAnalysis.get(analysis.id) ?? []),
    ),
    plan,
  };
}

export async function getFmeaAnalysis(request: Request, analysisId: string) {
  const resolved = await resolveFmeaWorkspace(request);
  if (!resolved) return null;

  const analysis = await getOwnedAnalysis(resolved.workspace, analysisId);
  if (!analysis) return { notFound: true as const };

  const { data: rows, error } = await appSchema()
    .from("fmea_rows")
    .select("*")
    .eq("analysis_id", analysisId)
    .neq("review_status", "superseded");

  if (error) {
    console.error("Failed to load FMEA rows:", error);
    throw new Error("Could not load analysis rows.");
  }

  const clientRows = ((rows ?? []) as any[])
    .map((row) => ({
      order: Number(row.model_metadata?.rowOrder ?? 0),
      row: clientRowFromDb(row),
    }))
    .sort((a: { order: number }, b: { order: number }) => a.order - b.order)
    .map((entry) => entry.row);

  return {
    analysis: {
      ...analysisSummary(analysis, clientRows),
      rows: clientRows,
    },
    plan: resolved.plan,
  };
}

export async function saveFmeaAnalysis(request: Request, payload: FmeaAnalysisPayload) {
  const access = await requireWorkspaceMutationAccess(request, "content");
  if (!access.ok) {
    return access.status === 401 ? null : { forbidden: true as const };
  }

  const workspace = access.workspace;
  const plan = {
    isPro: isProWorkspace(workspace),
    savedAnalysisLimit: isProWorkspace(workspace) ? null : 1,
    status: workspace.organization.billing_status,
  };

  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const name = payload.name?.trim() || "Untitled Failure Mode and Effects Analysis";
  const existingId = payload.id?.trim() || null;

  if (existingId) {
    const ownedAnalysis = await getOwnedAnalysis(workspace, existingId);
    if (!ownedAnalysis) return { notFound: true as const };
  } else {
    const { count, error: countError } = await appSchema()
      .from("fmea_analyses")
      .select("id", { count: "exact", head: true })
      .neq("status", "archived")
      .eq("organization_id", workspace.organization.id);

    if (countError) {
      console.error("Failed to count FMEA analyses:", countError);
      throw new Error("Could not check analysis limit.");
    }

    if (!plan.isPro && (count ?? 0) >= 1) {
      return {
        limitExceeded: true as const,
        message: "Free tier includes 1 saved Failure Mode and Effects Analysis table. Upgrade to Pro for unlimited saved analyses.",
      };
    }

  }

  const { data: analysisId, error } = await (getSupabaseServiceClient().rpc as any)(
    "save_fmea_analysis_transaction",
    {
      p_analysis_id: existingId,
      p_organization_id: workspace.organization.id,
      p_user_account_id: workspace.userAccount.id,
      p_name: name,
      p_rows: rows.map((row, rowOrder) => ({ ...row, rowOrder })),
    },
  );

  if (error || !analysisId) {
    if (error?.message?.includes("FREE_PLAN_ANALYSIS_LIMIT")) {
      return {
        limitExceeded: true as const,
        message: "Free tier includes 1 saved Failure Mode and Effects Analysis table. Upgrade to Pro for unlimited saved analyses.",
      };
    }
    console.error("Failed to save FMEA analysis transaction:", error);
    throw new Error("Could not save analysis.");
  }

  return getFmeaAnalysis(request, String(analysisId));
}

export async function renameFmeaAnalysis(request: Request, analysisId: string, name: string) {
  const access = await requireWorkspaceMutationAccess(request, "content");
  if (!access.ok) return access.status === 401 ? null : { forbidden: true as const };
  const resolved = { workspace: access.workspace };

  const ownedAnalysis = await getOwnedAnalysis(resolved.workspace, analysisId);
  if (!ownedAnalysis) return { notFound: true as const };

  const { error } = await appSchema()
    .from("fmea_analyses")
    .update({ name: name.trim() || ownedAnalysis.name })
    .eq("id", analysisId)
    .eq("organization_id", resolved.workspace.organization.id);

  if (error) {
    console.error("Failed to rename FMEA analysis:", error);
    throw new Error("Could not rename analysis.");
  }

  return { updated: true };
}

export async function deleteFmeaAnalysis(request: Request, analysisId: string) {
  const access = await requireWorkspaceMutationAccess(request, "content");
  if (!access.ok) return access.status === 401 ? null : { forbidden: true as const };
  const resolved = { workspace: access.workspace };

  const ownedAnalysis = await getOwnedAnalysis(resolved.workspace, analysisId);
  if (!ownedAnalysis) return { notFound: true as const };

  const { error } = await appSchema()
    .from("fmea_analyses")
    .delete()
    .eq("id", analysisId)
    .eq("organization_id", resolved.workspace.organization.id);

  if (error) {
    console.error("Failed to delete FMEA analysis:", error);
    throw new Error("Could not delete analysis.");
  }

  return { deleted: true };
}
