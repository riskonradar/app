/* eslint-disable @typescript-eslint/no-explicit-any */

import { ensureCurrentWorkspace } from "@/lib/account/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export type PersistedFmeaRow = {
  id: string;
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

function ownerFilterForWorkspace(workspace: Workspace) {
  return `organization_id.eq.${workspace.organization.id},user_account_id.eq.${workspace.userAccount.id}`;
}

function isProWorkspace(workspace: Workspace) {
  return ["active", "comped"].includes(workspace.organization.billing_status);
}

function canMutateWorkspace(workspace: Workspace) {
  return workspace.role === "owner" || workspace.role === "admin" || workspace.role === "member";
}

function parseScore(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return parsed >= 1 && parsed <= 10 ? parsed : null;
}

function normalizeStatus(value: unknown): PersistedFmeaRow["status"] {
  if (value === "accepted" || value === "rejected") return value;
  return "needs_review";
}

function rowMetadata(row: PersistedFmeaRow, index: number) {
  return {
    clientRowId: row.id,
    evidenceCount: Number(row.evidenceCount || 0),
    included: row.included !== false,
    industry: row.industry || "",
    requirement: row.requirement || "",
    rowOrder: index,
    rpn: row.rpn || "",
    sources: Array.isArray(row.sources) ? row.sources : [],
  };
}

function dbRowFromClient(analysisId: string, row: PersistedFmeaRow, index: number) {
  return {
    analysis_id: analysisId,
    component: row.component || "Unspecified component",
    function: row.function || "",
    failure_mode: row.failureMode || "Unspecified failure mode",
    effect: row.effect || "",
    severity: parseScore(row.severity),
    cause: row.cause || "",
    occurrence: parseScore(row.occurrence),
    controls: row.currentControl || "",
    detection: "",
    detection_rating: parseScore(row.detection),
    recommended_action: row.correctiveAction || "",
    responsible_owner: row.owner || "",
    review_status: normalizeStatus(row.status),
    model_metadata: rowMetadata(row, index),
  };
}

function clientRowFromDb(row: any): PersistedFmeaRow {
  const metadata = (row.model_metadata ?? {}) as Record<string, any>;

  return {
    id: String(metadata.clientRowId || row.id),
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
    .or(ownerFilterForWorkspace(workspace))
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
    .or(ownerFilterForWorkspace(workspace))
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
      .in("analysis_id", analysisIds);

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
    .eq("analysis_id", analysisId);

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
  const resolved = await resolveFmeaWorkspace(request);
  if (!resolved) return null;

  const { workspace, plan } = resolved;
  if (!canMutateWorkspace(workspace)) {
    return { forbidden: true as const };
  }

  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const name = payload.name?.trim() || "Untitled Failure Mode and Effects Analysis";
  const existingId = payload.id?.trim() || null;

  let analysisId = existingId;
  if (analysisId) {
    const ownedAnalysis = await getOwnedAnalysis(workspace, analysisId);
    if (!ownedAnalysis) return { notFound: true as const };

    const { error } = await appSchema()
      .from("fmea_analyses")
      .update({
        organization_id: workspace.organization.id,
        user_account_id: workspace.userAccount.id,
        name,
        metadata: {
          rowCount: rows.length,
          source: "web_editor",
        },
      })
      .eq("id", analysisId)
      .or(ownerFilterForWorkspace(workspace));

    if (error) {
      console.error("Failed to update FMEA analysis:", error);
      throw new Error("Could not update analysis.");
    }
  } else {
    const { count, error: countError } = await appSchema()
      .from("fmea_analyses")
      .select("id", { count: "exact", head: true })
      .neq("status", "archived")
      .or(ownerFilterForWorkspace(workspace));

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

    const { data, error } = await appSchema()
      .from("fmea_analyses")
      .insert({
        organization_id: workspace.organization.id,
        user_account_id: workspace.userAccount.id,
        created_by_user_account_id: workspace.userAccount.id,
        name,
        metadata: {
          rowCount: rows.length,
          source: "web_editor",
        },
      })
      .select("id")
      .single();

    if (error) {
      console.error("Failed to create FMEA analysis:", error);
      throw new Error("Could not create analysis.");
    }

    analysisId = data.id;
  }

  const { error: deleteError } = await appSchema()
    .from("fmea_rows")
    .delete()
    .eq("analysis_id", analysisId);

  if (deleteError) {
    console.error("Failed to replace FMEA rows:", deleteError);
    throw new Error("Could not replace analysis rows.");
  }

  if (rows.length) {
    const { error: rowsError } = await appSchema()
      .from("fmea_rows")
      .insert(rows.map((row, index) => dbRowFromClient(analysisId!, row, index)));

    if (rowsError) {
      console.error("Failed to save FMEA rows:", rowsError);
      throw new Error("Could not save analysis rows.");
    }
  }

  return getFmeaAnalysis(request, analysisId!);
}

export async function renameFmeaAnalysis(request: Request, analysisId: string, name: string) {
  const resolved = await resolveFmeaWorkspace(request);
  if (!resolved) return null;
  if (!canMutateWorkspace(resolved.workspace)) {
    return { forbidden: true as const };
  }

  const ownedAnalysis = await getOwnedAnalysis(resolved.workspace, analysisId);
  if (!ownedAnalysis) return { notFound: true as const };

  const { error } = await appSchema()
    .from("fmea_analyses")
    .update({ name: name.trim() || ownedAnalysis.name })
    .eq("id", analysisId)
    .or(ownerFilterForWorkspace(resolved.workspace));

  if (error) {
    console.error("Failed to rename FMEA analysis:", error);
    throw new Error("Could not rename analysis.");
  }

  return { updated: true };
}

export async function deleteFmeaAnalysis(request: Request, analysisId: string) {
  const resolved = await resolveFmeaWorkspace(request);
  if (!resolved) return null;
  if (!canMutateWorkspace(resolved.workspace)) {
    return { forbidden: true as const };
  }

  const ownedAnalysis = await getOwnedAnalysis(resolved.workspace, analysisId);
  if (!ownedAnalysis) return { notFound: true as const };

  const { error } = await appSchema()
    .from("fmea_analyses")
    .delete()
    .eq("id", analysisId)
    .or(ownerFilterForWorkspace(resolved.workspace));

  if (error) {
    console.error("Failed to delete FMEA analysis:", error);
    throw new Error("Could not delete analysis.");
  }

  return { deleted: true };
}
