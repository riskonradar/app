import React from "react";
import { readFile } from "node:fs/promises";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { EvidenceDrawer } from "@/components/fmea/evidence-drawer";
import { buildCsv, neutralizeSpreadsheetFormula } from "@/lib/fmea/export";
import { parseKnowledgeSearchParams } from "@/lib/fmea/search";
import { scoreSuggestionsForRow } from "@/lib/fmea/scoring";
import type { FmeaRow } from "@/lib/fmea/types";
import {
  applyFmeaRowUpdate,
  canPersistWorksheet,
  knowledgeRowsToEvidenceRows,
  normalizeSavedRows,
  selectRowsForExport,
  templateRowsForComponents,
  toFmeaRows,
} from "@/lib/fmea/worksheet";

const mocks = vi.hoisted(() => ({
  ensureCurrentWorkspace: vi.fn(),
  requireWorkspaceMutationAccess: vi.fn(),
  rpc: vi.fn(),
  schema: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/account/server", () => ({
  ensureCurrentWorkspace: mocks.ensureCurrentWorkspace,
}));

vi.mock("@/lib/auth/workspace-access", () => ({
  requireWorkspaceMutationAccess: mocks.requireWorkspaceMutationAccess,
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServiceClient: () => ({
    rpc: mocks.rpc,
    schema: mocks.schema,
  }),
}));

const workspace = {
  role: "member",
  organization: { id: "org-1", billing_status: "active" },
  userAccount: { id: "user-1" },
};

function row(): FmeaRow {
  return {
    id: "bearing-fatigue",
    component: "Bearing",
    function: "Support rotating load",
    requirement: "Maintain alignment",
    industry: "Aviation",
    failureMode: "Fatigue",
    effect: "Engine shutdown",
    severity: "8",
    cause: "Cyclic loading",
    occurrence: "4",
    currentControl: "Ultrasonic inspection",
    detection: "3",
    correctiveAction: "Replace bearing",
    rpn: "96",
    evidenceCount: 1,
    sources: [{ title: "Bearing study", doi: "10.1000/example", year: "2025" }],
    evidence: [
      {
        field: "failure_mode",
        claimId: "11111111-1111-4111-8111-111111111111",
        claimType: "failure_mode",
        value: "Fatigue",
        confidence: 0.93,
        supportType: "direct_span",
        reviewStatus: "needs_review",
        spans: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            sourceField: "abstract",
            text: "Fatigue cracking initiated at the inner race.",
            charStart: 41,
            charEnd: 89,
            licenseSafe: true,
          },
        ],
        source: { title: "Bearing study", doi: "10.1000/example", year: "2025" },
      },
    ],
    scoreSuggestions: {},
    owner: "Riley",
    status: "accepted",
    included: true,
    provenance: "evidence",
    engineerEditedFields: [],
    reviewedAt: "2026-07-18T10:00:00.000Z",
    domains: ["Aviation"],
    operatingContexts: ["turbofan at cruise"],
  };
}

describe("FMEA product loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureCurrentWorkspace.mockResolvedValue(workspace);
    mocks.requireWorkspaceMutationAccess.mockResolvedValue({ ok: true, workspace });
    mocks.rpc.mockResolvedValue({ data: "analysis-1", error: null });

    mocks.schema.mockImplementation(() => ({
      from: (table: string) => {
        const builder = {
          select: vi.fn(() => builder),
          neq: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          or: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({
            data: table === "fmea_analyses"
              ? { id: "analysis-1", name: "Bearing FMEA", status: "draft", metadata: {} }
              : null,
            error: null,
          })),
          then: (resolve: (value: unknown) => void) => resolve(
            table === "fmea_rows"
              ? { data: [], error: null }
              : { data: [], count: 0, error: null },
          ),
        };
        return builder;
      },
    }));
  });

  test("save calls one transactional RPC with field-level evidence lineage", async () => {
    const { saveFmeaAnalysis } = await import("@/lib/fmea/server");
    const request = new Request("https://app.example/api/fmea/analyses", { method: "POST" });

    const result = await saveFmeaAnalysis(request, { name: "Bearing FMEA", rows: [row()] });

    expect(result).not.toBeNull();
    expect(mocks.requireWorkspaceMutationAccess).toHaveBeenCalledWith(request, "content");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("save_fmea_analysis_transaction", expect.objectContaining({
      p_analysis_id: null,
      p_organization_id: "org-1",
      p_user_account_id: "user-1",
      p_rows: [expect.objectContaining({
        id: "bearing-fatigue",
        rowOrder: 0,
        evidence: [expect.objectContaining({
          claimId: "11111111-1111-4111-8111-111111111111",
          spans: [expect.objectContaining({ id: "22222222-2222-4222-8222-222222222222" })],
        })],
      })],
    }));
  });

  test("an existing analysis cannot save without a verified loaded-row baseline", async () => {
    const { saveFmeaAnalysis } = await import("@/lib/fmea/server");
    const request = new Request("https://app.example/api/fmea/analyses", { method: "POST" });

    const result = await saveFmeaAnalysis(request, {
      id: "analysis-1",
      name: "Bearing FMEA",
      rows: [],
    });

    expect(result).toEqual({
      conflict: true,
      message: "Reload this analysis before saving; no verified row baseline was supplied.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  test("evidence drawer shows DOI, confidence, exact span, offsets, and claim ID", () => {
    render(<EvidenceDrawer row={row()} onClose={() => undefined} />);

    expect(screen.getByRole("link", { name: "DOI: 10.1000/example" })).toHaveAttribute(
      "href",
      "https://doi.org/10.1000/example",
    );
    expect(screen.getByText("93% confidence")).toBeInTheDocument();
    expect(screen.getByText(/Fatigue cracking initiated at the inner race/)).toBeInTheDocument();
    expect(screen.getByText(/characters 41–89/)).toBeInTheDocument();
    expect(screen.getByText(/Claim 11111111-1111-4111-8111-111111111111/)).toBeInTheDocument();
  });

  test("unsafe evidence spans never reach the lineage UI or export", () => {
    const unsafeRow = row();
    unsafeRow.evidence[0].spans.push({
      id: "33333333-3333-4333-8333-333333333333",
      sourceField: "full_text",
      text: "restricted full text must not be displayed",
      charStart: 10,
      charEnd: 52,
      licenseSafe: false,
    });

    render(<EvidenceDrawer row={unsafeRow} onClose={() => undefined} />);

    expect(screen.queryByText(/restricted full text/)).not.toBeInTheDocument();
    expect(buildCsv([unsafeRow])).not.toContain("restricted full text");
  });

  test("CSV and workbook text neutralize spreadsheet formulas", () => {
    const formulaRow = { ...row(), component: "=HYPERLINK(\"https://bad.example\")", owner: " +cmd" };
    const csv = buildCsv([formulaRow]);

    expect(neutralizeSpreadsheetFormula("=1+1")).toBe("'=1+1");
    expect(neutralizeSpreadsheetFormula("  @SUM(A1:A2)")).toBe("'  @SUM(A1:A2)");
    expect(csv).toContain("'=");
    expect(csv).toContain("' +cmd");
  });

  test("editing accepted evidence-backed content invalidates acceptance and only stale field lineage", () => {
    const edited = applyFmeaRowUpdate(
      row(),
      { failureMode: "Engineer-corrected fatigue fracture" },
      "2026-07-18T12:00:00.000Z",
    );

    expect(edited.status).toBe("edited");
    expect(edited.reviewedAt).toBeUndefined();
    expect(edited.engineerEditedFields).toContain("failureMode");
    expect(edited.evidence).toHaveLength(0);
    expect(edited.evidenceCount).toBe(0);
    expect(edited.sources).toHaveLength(0);
  });

  test("saved engineer overrides cannot regain reconstructed stale field lineage", () => {
    const restored = normalizeSavedRows([{
      ...row(),
      status: "edited",
      engineerEditedFields: ["failureMode"],
    }]);

    expect(restored[0].evidence).toHaveLength(0);
    expect(restored[0].sources).toHaveLength(0);
    expect(restored[0].evidenceCount).toBe(0);
  });

  test("failed or unverified saved-analysis loads are never saveable", () => {
    expect(canPersistWorksheet("loading", null, null)).toBe(false);
    expect(canPersistWorksheet("error", null, null)).toBe(false);
    expect(canPersistWorksheet("ready", "analysis-1", null)).toBe(false);
    expect(canPersistWorksheet("ready", "analysis-1", [])).toBe(true);
    expect(canPersistWorksheet("idle", null, null)).toBe(true);
  });

  test("final exports include only complete accepted evidence while drafts exclude rejected rows", () => {
    const accepted = row();
    const needsReview = { ...row(), id: "needs-review", status: "needs_review" as const };
    const rejected = { ...row(), id: "rejected", status: "rejected" as const };
    const manual = {
      ...row(),
      id: "manual",
      provenance: "manual" as const,
      evidence: [],
      sources: [],
      evidenceCount: 0,
    };

    expect(selectRowsForExport([accepted, needsReview, rejected, manual], "final")).toEqual([accepted]);
    expect(selectRowsForExport([accepted, needsReview, rejected, manual], "draft")).toEqual([
      accepted,
      needsReview,
      manual,
    ]);
    expect(buildCsv([accepted, needsReview, rejected, manual])).toContain("FINAL — accepted evidence-backed row");
    expect(buildCsv([accepted, needsReview, rejected, manual])).not.toContain("needs-review");
    expect(buildCsv([accepted, needsReview, rejected, manual], "draft")).toContain("DRAFT — engineering review required");
  });

  test("manual worksheet rows start blank, unconfirmed, and excluded", () => {
    const [manual] = templateRowsForComponents(["Bearing"]);

    expect(manual).toMatchObject({
      component: "Bearing",
      function: "",
      requirement: "",
      industry: "",
      currentControl: "",
      failureMode: "",
      status: "needs_review",
      included: false,
      provenance: "manual",
      evidenceCount: 0,
    });
  });

  test("taxonomy-backed rows preserve specific labels and canonical IDs", () => {
    const evidenceRows = knowledgeRowsToEvidenceRows([{
      failure_mode_claim_id: "11111111-1111-4111-8111-111111111111",
      failure_mode_taxonomy_id: "44444444-4444-4444-8444-444444444444",
      failure_mode_slug: "low-cycle-fatigue",
      component_taxonomy_id: "55555555-5555-4555-8555-555555555555",
      component_slug: "turbine-disk",
      component: "Turbine disk",
      failure_mode: "Low-cycle fatigue",
      cause: null,
      effect: null,
      control: null,
      confidence: 0.9,
      doi: null,
      title: "LCF study",
      journal: null,
      publication_year: 2026,
      total_count: 1,
      evidence: [],
    }]);
    const worksheetRows = toFmeaRows(evidenceRows);

    expect(worksheetRows[0]).toMatchObject({
      component: "Turbine disk",
      failureMode: "Low-cycle fatigue",
      componentTaxonomyId: "55555555-5555-4555-8555-555555555555",
      failureModeTaxonomyId: "44444444-4444-4444-8444-444444444444",
    });
  });

  test("knowledge-search pagination accepts only bounded integer values", () => {
    expect(parseKnowledgeSearchParams("https://app.example/api/knowledge/search?type=failure_mode&limit=50&offset=100")).toMatchObject({
      type: "failure_mode",
      limit: 50,
      offset: 100,
    });
    expect(parseKnowledgeSearchParams("https://app.example/api/knowledge/search?limit=NaN&offset=-2")).toMatchObject({
      type: "component",
      limit: 100,
      offset: 0,
    });
    expect(parseKnowledgeSearchParams("https://app.example/api/knowledge/search?limit=99999&offset=999999")).toMatchObject({
      limit: 500,
      offset: 100_000,
    });
  });

  test("scoring heuristics remain suggestions separate from engineer inputs", () => {
    const suggestion = scoreSuggestionsForRow({ ...row(), severity: "", occurrence: "", detection: "" });

    expect(suggestion.severity?.value).toBe("8");
    expect(suggestion.occurrence?.rationale).toContain("Corpus-frequency indication only");
    expect(suggestion.detection?.rationale).toContain("Confirm against the actual control plan");
  });

  test("transaction migration preserves stable rows, normalized lineage, audit events, and service-role gating", async () => {
    const migration = await readFile(
      "../../supabase/migrations/20260717160000_transactional_fmea_saves.sql",
      "utf8",
    );

    expect(migration).toContain("fmea_rows_analysis_client_row_id_idx");
    expect(migration).toContain("get_fmea_evidence_lineage");
    expect(migration).toContain("save_fmea_analysis_transaction");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("FREE_PLAN_ANALYSIS_LIMIT");
    expect(migration).toContain("v_saved_analysis_count >= 1");
    expect(migration).toContain("INSERT INTO app.fmea_row_evidence");
    expect(migration).toContain("public.get_fmea_evidence_lineage");
    expect(migration).toContain("span.license_safe = true");
    expect(migration).toContain("safe_span.evidence_claim_id = (v_evidence->>'claimId')::uuid");
    expect(migration).toContain("validated_relationship.classification_job_id = validated_claim.classification_job_id");
    expect(migration).toContain("'evidence', v_validated_evidence");
    expect(migration).not.toContain("'evidence', COALESCE(v_row->'evidence'");
    expect(migration).toContain("INSERT INTO app.fmea_review_events");
    expect(migration).toContain("review_status = 'superseded'");
    expect(migration).toContain("SET search_path = pg_catalog");
    expect(migration).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
  });

  test("the worksheet consumes taxonomy-aware live search instead of the turbofan snapshot RPC", async () => {
    const [page, searchRoute, exportHelpers, taxonomyMigration] = await Promise.all([
      readFile("src/app/fmea/page.tsx", "utf8"),
      readFile("src/app/api/knowledge/search/route.ts", "utf8"),
      readFile("src/lib/fmea/export.ts", "utf8"),
      readFile("../../supabase/migrations/20260717170000_failure_mode_taxonomy_search.sql", "utf8"),
    ]);

    expect(page).toContain("/api/knowledge/search?");
    expect(page).not.toContain("/api/knowledge/fmea");
    expect(page).not.toContain("fetchLiveTurbofanDataset");
    expect(exportHelpers).toContain('"Evidence claim IDs"');
    expect(exportHelpers).toContain('"Exact evidence spans"');
    expect(exportHelpers).toContain('"Claim confidence"');
    expect(page).not.toContain("componentFamilies");
    expect(page).not.toContain("failureModeFamilies");
    expect(searchRoute).toContain("search_fmea_by_component");
    expect(searchRoute).toContain("search_fmea_by_failure_mode");
    expect(searchRoute).toContain("getFmeaEvidenceByFailureModeClaimIds");
    expect(searchRoute).toContain("countProbe");
    expect(taxonomyMigration).toContain("resolve_fmea_taxonomy_node");
    expect(taxonomyMigration).toContain("failure_mode_taxonomy_id");
    expect(taxonomyMigration).toContain("component_taxonomy_id");
    expect(taxonomyMigration.match(/COUNT\(\*\) OVER \(\) AS total_count/g)).toHaveLength(3);
  });

  test("all saved-analysis mutations enforce content-role access", async () => {
    const [server, collectionRoute, itemRoute] = await Promise.all([
      readFile("src/lib/fmea/server.ts", "utf8"),
      readFile("src/app/api/fmea/analyses/route.ts", "utf8"),
      readFile("src/app/api/fmea/analyses/[id]/route.ts", "utf8"),
    ]);

    expect(server.match(/requireWorkspaceMutationAccess\(request, "content"\)/g)).toHaveLength(3);
    expect(collectionRoute).toContain('"forbidden" in result');
    expect(itemRoute.match(/"forbidden" in result/g)?.length).toBeGreaterThanOrEqual(3);
    expect(itemRoute).toContain("You do not have permission to delete this analysis.");
  });

  test("saved analyses are scoped only to the active organization", async () => {
    const [server, transactionMigration, isolationMigration] = await Promise.all([
      readFile("src/lib/fmea/server.ts", "utf8"),
      readFile("../../supabase/migrations/20260717160000_transactional_fmea_saves.sql", "utf8"),
      readFile("../../supabase/migrations/20260717162000_enforce_fmea_workspace_isolation.sql", "utf8"),
    ]);

    expect(server).not.toContain("ownerFilterForWorkspace");
    expect(server.match(/\.eq\("organization_id", workspace\.organization\.id\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(transactionMigration).toContain("AND organization_id = p_organization_id");
    expect(transactionMigration).not.toContain("organization_id = p_organization_id OR user_account_id");
    expect(isolationMigration).toContain("personal_organization.clerk_organization_id IS NULL");
    expect(isolationMigration).toContain("WHERE organization_id IN (SELECT app.current_organization_ids())");
  });
});
