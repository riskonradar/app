import { readFile } from "node:fs/promises";
import { describe, expect, test, vi } from "vitest";

import { analyzeCascade } from "@/lib/systems/cascade";
import type { ComponentInstance, FailurePropagation } from "@/lib/systems/types";

const mocks = vi.hoisted(() => ({
  ensureCurrentWorkspace: vi.fn(),
  requireWorkspaceMutationAccess: vi.fn(),
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
  getSupabaseServiceClient: () => ({ schema: mocks.schema }),
}));

const source: ComponentInstance = {
  id: "11111111-1111-4111-8111-111111111111",
  assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  parentInstanceId: null,
  componentId: "55555555-5555-4555-8555-555555555555",
  taxonomyName: "Bearing",
  taxonomyPath: "rotating-machinery/bearing",
  name: "Drive-end bearing",
  instanceKey: "BRG-DE-01",
  nodeKind: "component",
  functionText: "Support the drive shaft",
  criticality: "high",
};

const middle: ComponentInstance = {
  ...source,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Drive shaft",
};

const target: ComponentInstance = {
  ...source,
  id: "33333333-3333-4333-8333-333333333333",
  name: "Rotor",
};

function propagation(
  id: string,
  sourceInstanceId: string,
  targetInstanceId: string,
  likelihood: FailurePropagation["likelihood"],
  confidence: number | null,
): FailurePropagation {
  return {
    id,
    assetId: source.assetId,
    sourceInstanceId,
    targetInstanceId,
    sourceFailureModeId: "44444444-4444-4444-8444-444444444444",
    failureModeName: "Fatigue",
    targetEffect: "Transferred vibration",
    triggerCondition: null,
    likelihood,
    confidence,
    rationale: "The shared shaft transfers dynamic loading.",
    evidenceClaimId: null,
    reviewStatus: "accepted",
  };
}

describe("system model foundation", () => {
  test("cascade analysis follows multiple edges and reports conservative path confidence", () => {
    const paths = analyzeCascade(
      [source, middle, target],
      [
        propagation("edge-1", source.id, middle.id, "low", 0.9),
        propagation("edge-2", middle.id, target.id, "high", 0.7),
      ],
      source.id,
    );

    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatchObject({
      instanceIds: [source.id, middle.id, target.id],
      propagationIds: ["edge-1", "edge-2"],
      likelihood: "low",
      confidence: 0.7,
      cycleDetected: false,
    });
  });

  test("an unknown edge keeps the serial path likelihood unknown", () => {
    const paths = analyzeCascade(
      [source, middle, target],
      [
        propagation("edge-1", source.id, middle.id, "high", 0.9),
        propagation("edge-2", middle.id, target.id, "unknown", 0.7),
      ],
      source.id,
    );

    expect(paths[0].likelihood).toBe("unknown");
  });

  test("needs-review edges do not participate in cascade analysis", () => {
    const unreviewed = {
      ...propagation("edge-1", source.id, middle.id, "high", 0.9),
      reviewStatus: "needs_review" as const,
    };

    expect(analyzeCascade([source, middle], [unreviewed], source.id)).toEqual([]);
  });

  test("one unknown edge confidence makes the whole path confidence unknown", () => {
    const paths = analyzeCascade(
      [source, middle, target],
      [
        propagation("edge-1", source.id, middle.id, "high", 0.9),
        propagation("edge-2", middle.id, target.id, "high", null),
      ],
      source.id,
    );

    expect(paths[0].confidence).toBeNull();
  });

  test("cascade analysis terminates explicit cycles instead of recursing forever", () => {
    const paths = analyzeCascade(
      [source, middle],
      [
        propagation("edge-1", source.id, middle.id, "medium", 0.8),
        propagation("edge-2", middle.id, source.id, "medium", 0.8),
      ],
      source.id,
    );

    expect(paths).toHaveLength(1);
    expect(paths[0].cycleDetected).toBe(true);
    expect(paths[0].instanceIds).toEqual([source.id, middle.id, source.id]);
  });

  test("wrong-role mutations stop before any database query", async () => {
    mocks.requireWorkspaceMutationAccess.mockResolvedValueOnce({
      ok: false,
      error: "Your workspace role cannot manage content settings.",
      status: 403,
    });
    mocks.schema.mockClear();

    const { mutateSystemModel } = await import("@/lib/systems/server");
    const result = await mutateSystemModel(
      new Request("https://app.example/api/systems", { method: "POST" }),
      { action: "create_asset", name: "Test system" },
    );

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(mocks.schema).not.toHaveBeenCalled();
  });

  test("an asset ID from another workspace is rejected before its child mutation", async () => {
    const insert = vi.fn();
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "contains", "delete"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.insert = insert;
    builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }));

    mocks.requireWorkspaceMutationAccess.mockResolvedValueOnce({
      ok: true,
      workspace: {
        role: "member",
        organization: { id: "99999999-9999-4999-8999-999999999999" },
        userAccount: { id: "88888888-8888-4888-8888-888888888888" },
      },
    });
    mocks.schema.mockReturnValue({ from: vi.fn(() => builder) });

    const { mutateSystemModel } = await import("@/lib/systems/server");
    await expect(mutateSystemModel(
      new Request("https://app.example/api/systems", { method: "POST" }),
      {
        action: "create_instance",
        assetId: source.assetId,
        name: "Foreign component",
        componentId: source.componentId,
      },
    )).rejects.toThrow("System asset was not found in this workspace.");
    expect(insert).not.toHaveBeenCalled();
  });

  test("self-referential interface edges are rejected before insert", async () => {
    const insert = vi.fn();
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "contains"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.insert = insert;
    builder.maybeSingle = vi.fn(async () => ({ data: { id: source.assetId }, error: null }));

    mocks.requireWorkspaceMutationAccess.mockResolvedValueOnce({
      ok: true,
      workspace: {
        role: "member",
        organization: { id: "99999999-9999-4999-8999-999999999999" },
        userAccount: { id: "88888888-8888-4888-8888-888888888888" },
      },
    });
    mocks.schema.mockReturnValue({ from: vi.fn(() => builder) });

    const { mutateSystemModel } = await import("@/lib/systems/server");
    await expect(mutateSystemModel(
      new Request("https://app.example/api/systems", { method: "POST" }),
      {
        action: "create_dependency",
        assetId: source.assetId,
        sourceInstanceId: source.id,
        targetInstanceId: source.id,
        dependencyType: "mechanical",
      },
    )).rejects.toThrow("Source and target components must be different.");
    expect(insert).not.toHaveBeenCalled();
  });

  test("migration enforces tenant edges, cycle prevention, cascade deletion, RLS, and audit", async () => {
    const migration = await readFile(
      "../../supabase/migrations/20260717180000_system_modeling_foundation.sql",
      "utf8",
    );

    expect(migration).toContain("FOREIGN KEY (organization_id, asset_id)");
    expect(migration.match(/FOREIGN KEY \(asset_id, (source|target)_instance_id\)/g)).toHaveLength(4);
    expect(migration).toContain("app.prevent_asset_component_cycle");
    expect(migration).toContain("A component hierarchy cannot contain a cycle");
    expect(migration).toContain("ON DELETE CASCADE");
    expect(migration).toContain("app.audit_system_model_mutation");
    expect(migration).toContain("app.validate_failure_propagation_evidence");
    expect(migration).toContain("relationship.relationship_type = 'has_failure_mode'");
    expect(migration).toContain("component_link.evidence_claim_id = component_claim.id");
    expect(migration).toContain("failure_mode_link.evidence_claim_id = failure_mode_claim.id");
    expect(migration).toContain("span.license_safe = true");
    expect(migration).toContain("NEW.claim_relationship_id := matched_relationship_id");
    expect(migration).toContain("NEW.evidence_span_id := matched_span_id");
    expect(migration).toContain("public.delete_system_model_entity");
    expect(migration).toContain("pg_catalog.set_config('app.system_model_actor'");
    expect(migration).toContain("SET search_path = pg_catalog");
    expect(migration.match(/organization_id IN \(SELECT app.current_organization_ids\(\)\)/g)).toHaveLength(4);
    expect(migration).not.toContain("user_account_id = app.current_user_account_id()");
  });

  test("all product reads and child writes are scoped to the active organization", async () => {
    const [server, route, proxy, workspaceUi, graph] = await Promise.all([
      readFile("src/lib/systems/server.ts", "utf8"),
      readFile("src/app/api/systems/route.ts", "utf8"),
      readFile("src/proxy.ts", "utf8"),
      readFile("src/components/systems/system-model-workspace.tsx", "utf8"),
      readFile("src/components/systems/system-graph.tsx", "utf8"),
    ]);

    expect(server.match(/\.eq\("organization_id", workspace\.organization\.id\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(server).toContain("requireWorkspaceMutationAccess(request, \"content\")");
    expect(server).toContain("requireOwnedAsset(organizationId, payload.assetId)");
    expect(server).toContain('"delete_system_model_entity"');
    expect(server).toContain('payload.action === "review_propagation"');
    expect(server).toContain("review_status: payload.reviewStatus");
    expect(route).toContain("getSystemModelWorkspace(request)");
    expect(proxy).toContain('"/systems(.*)"');
    expect(proxy).toContain('"/api/systems(.*)"');
    expect(workspaceUi).toContain('action: "review_propagation"');
    expect(workspaceUi).toContain("Accept");
    expect(workspaceUi).toContain("Reject");
    expect(workspaceUi).not.toContain('name="evidenceClaimId"');
    expect(graph).toContain('edge.reviewStatus === "accepted"');
  });
});
