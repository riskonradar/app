/* eslint-disable @typescript-eslint/no-explicit-any */

import "server-only";

import { ensureCurrentWorkspace } from "@/lib/account/server";
import { requireWorkspaceMutationAccess } from "@/lib/auth/workspace-access";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import type {
  AssetDependency,
  ComponentInstance,
  FailurePropagation,
  SystemModelAuditEvent,
  SystemModelWorkspace,
  SystemMutationPayload,
} from "@/lib/systems/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NODE_KINDS = new Set(["system", "subsystem", "assembly", "component"]);
const CRITICALITIES = new Set(["unrated", "low", "medium", "high", "safety_critical"]);
const DEPENDENCY_TYPES = new Set([
  "mechanical", "electrical", "fluid", "thermal", "control", "structural", "data", "other",
]);
const LIKELIHOODS = new Set(["unknown", "low", "medium", "high"]);

function appSchema() {
  return (getSupabaseServiceClient() as any).schema("app");
}

function knowledgeSchema() {
  return (getSupabaseServiceClient() as any).schema("knowledge");
}

function requiredText(value: unknown, label: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return text;
}

function optionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`Text must be ${maxLength} characters or fewer.`);
  return text;
}

function requiredUuid(value: unknown, label: string) {
  const text = typeof value === "string" ? value : "";
  if (!UUID_PATTERN.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}

function optionalUuid(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  return requiredUuid(value, label);
}

function throwDatabaseError(error: { message?: string } | null, context: string) {
  if (!error) return;
  console.error(`${context}:`, error);
  if (error.message?.includes("Evidence claim does not support")) {
    throw new Error("Evidence claim does not support this component and failure mode.");
  }
  throw new Error(`Could not ${context.toLowerCase()}.`);
}

export async function getSystemModelWorkspace(request?: Request): Promise<SystemModelWorkspace | null> {
  const workspace = await ensureCurrentWorkspace(request);
  if (!workspace) return null;

  const [{ data: assets, error: assetsError }, { data: components, error: componentError }, { data: failureModes, error: failureModeError }] =
    await Promise.all([
      appSchema()
        .from("assets")
        .select("id, name, asset_type, operating_context, updated_at")
        .eq("organization_id", workspace.organization.id)
        .contains("metadata", { system_model: true })
        .order("updated_at", { ascending: false }),
      knowledgeSchema()
        .from("components")
        .select("id, name, path, depth")
        .eq("is_active", true)
        .order("path", { ascending: true }),
      knowledgeSchema()
        .from("failure_modes")
        .select("id, name, path, depth")
        .eq("is_active", true)
        .order("path", { ascending: true }),
    ]);

  throwDatabaseError(assetsError, "load system assets");
  throwDatabaseError(componentError, "load component taxonomy");
  throwDatabaseError(failureModeError, "load failure-mode taxonomy");

  const assetIds = (assets ?? []).map((asset: any) => asset.id);
  let instances: any[] = [];
  let dependencies: any[] = [];
  let propagations: any[] = [];
  let auditEvents: any[] = [];

  if (assetIds.length) {
    const [instanceResult, dependencyResult, propagationResult, auditResult] = await Promise.all([
      appSchema()
        .from("asset_component_instances")
        .select("id, asset_id, parent_instance_id, component_id, name, instance_key, node_kind, function_text, criticality")
        .eq("organization_id", workspace.organization.id)
        .in("asset_id", assetIds)
        .order("created_at", { ascending: true }),
      appSchema()
        .from("asset_dependencies")
        .select("id, asset_id, source_instance_id, target_instance_id, dependency_type, direction, name, description")
        .eq("organization_id", workspace.organization.id)
        .in("asset_id", assetIds)
        .order("created_at", { ascending: true }),
      appSchema()
        .from("asset_failure_propagations")
        .select("id, asset_id, source_instance_id, target_instance_id, source_failure_mode_id, target_effect, trigger_condition, likelihood, confidence, rationale, evidence_claim_id, review_status")
        .eq("organization_id", workspace.organization.id)
        .in("asset_id", assetIds)
        .order("created_at", { ascending: true }),
      appSchema()
        .from("system_model_audit_events")
        .select("id, asset_id, entity_type, entity_id, action, created_at")
        .eq("organization_id", workspace.organization.id)
        .in("asset_id", assetIds)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    throwDatabaseError(instanceResult.error, "load component instances");
    throwDatabaseError(dependencyResult.error, "load asset dependencies");
    throwDatabaseError(propagationResult.error, "load failure propagations");
    throwDatabaseError(auditResult.error, "load system-model audit history");
    instances = instanceResult.data ?? [];
    dependencies = dependencyResult.data ?? [];
    propagations = propagationResult.data ?? [];
    auditEvents = auditResult.data ?? [];
  }

  const componentsById = new Map<string, { name: string; path: string }>(
    (components ?? []).map((node: any) => [node.id, { name: node.name, path: node.path }]),
  );
  const failureModesById = new Map<string, { name: string }>(
    (failureModes ?? []).map((node: any) => [node.id, { name: node.name }]),
  );

  return {
    workspaceName: workspace.organization.name,
    role: workspace.role,
    assets: (assets ?? []).map((asset: any) => ({
      id: asset.id,
      name: asset.name,
      assetType: asset.asset_type,
      operatingContext: asset.operating_context ?? {},
      updatedAt: asset.updated_at,
    })),
    instances: instances.map((instance: any): ComponentInstance => ({
      id: instance.id,
      assetId: instance.asset_id,
      parentInstanceId: instance.parent_instance_id,
      componentId: instance.component_id,
      taxonomyName: componentsById.get(instance.component_id)?.name ?? "Unknown component",
      taxonomyPath: componentsById.get(instance.component_id)?.path ?? "unknown-component",
      name: instance.name,
      instanceKey: instance.instance_key,
      nodeKind: instance.node_kind,
      functionText: instance.function_text,
      criticality: instance.criticality,
    })),
    dependencies: dependencies.map((edge: any): AssetDependency => ({
      id: edge.id,
      assetId: edge.asset_id,
      sourceInstanceId: edge.source_instance_id,
      targetInstanceId: edge.target_instance_id,
      dependencyType: edge.dependency_type,
      direction: edge.direction,
      name: edge.name,
      description: edge.description,
    })),
    propagations: propagations.map((edge: any): FailurePropagation => ({
      id: edge.id,
      assetId: edge.asset_id,
      sourceInstanceId: edge.source_instance_id,
      targetInstanceId: edge.target_instance_id,
      sourceFailureModeId: edge.source_failure_mode_id,
      failureModeName: failureModesById.get(edge.source_failure_mode_id)?.name ?? "Unknown failure mode",
      targetEffect: edge.target_effect,
      triggerCondition: edge.trigger_condition,
      likelihood: edge.likelihood,
      confidence: edge.confidence === null ? null : Number(edge.confidence),
      rationale: edge.rationale,
      evidenceClaimId: edge.evidence_claim_id,
      reviewStatus: edge.review_status,
    })),
    auditEvents: auditEvents.map((event: any): SystemModelAuditEvent => ({
      id: event.id,
      assetId: event.asset_id,
      entityType: event.entity_type,
      entityId: event.entity_id,
      action: event.action,
      createdAt: event.created_at,
    })),
    componentTaxonomy: (components ?? []).map((node: any) => ({
      id: node.id,
      name: node.name,
      path: node.path,
      depth: node.depth,
    })),
    failureModeTaxonomy: (failureModes ?? []).map((node: any) => ({
      id: node.id,
      name: node.name,
      path: node.path,
      depth: node.depth,
    })),
  };
}

async function requireOwnedAsset(organizationId: string, assetId: unknown) {
  const id = requiredUuid(assetId, "Asset");
  const { data, error } = await appSchema()
    .from("assets")
    .select("id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .contains("metadata", { system_model: true })
    .maybeSingle();
  throwDatabaseError(error, "verify system asset");
  if (!data) throw new Error("System asset was not found in this workspace.");
  return id;
}

export async function mutateSystemModel(request: Request, payload: SystemMutationPayload) {
  const access = await requireWorkspaceMutationAccess(request, "content");
  if (!access.ok) return access;

  const { workspace } = access;
  const organizationId = workspace.organization.id;
  const actorId = workspace.userAccount.id;

  if (payload.action === "create_asset") {
    const name = requiredText(payload.name, "System name", 160);
    const assetType = optionalText(payload.assetType, 80) ?? "engineering_system";
    const { error } = await appSchema().from("assets").insert({
      organization_id: organizationId,
      user_account_id: actorId,
      created_by_user_account_id: actorId,
      updated_by_user_account_id: actorId,
      name,
      asset_type: assetType,
      metadata: { system_model: true },
    });
    throwDatabaseError(error, "create system asset");
  } else {
    const assetId = await requireOwnedAsset(organizationId, payload.assetId);

    if (payload.action === "create_instance") {
      const nodeKind = payload.nodeKind ?? "component";
      const criticality = payload.criticality ?? "unrated";
      if (!NODE_KINDS.has(nodeKind)) throw new Error("Node kind is invalid.");
      if (!CRITICALITIES.has(criticality)) throw new Error("Criticality is invalid.");

      const { error } = await appSchema().from("asset_component_instances").insert({
        organization_id: organizationId,
        asset_id: assetId,
        parent_instance_id: optionalUuid(payload.parentInstanceId, "Parent component"),
        component_id: requiredUuid(payload.componentId, "Component taxonomy node"),
        name: requiredText(payload.name, "Instance name", 160),
        instance_key: optionalText(payload.instanceKey, 80),
        node_kind: nodeKind,
        function_text: optionalText(payload.functionText, 1000),
        criticality,
        created_by_user_account_id: actorId,
        updated_by_user_account_id: actorId,
      });
      throwDatabaseError(error, "create component instance");
    } else if (payload.action === "create_dependency") {
      if (!DEPENDENCY_TYPES.has(payload.dependencyType)) throw new Error("Dependency type is invalid.");
      const sourceInstanceId = requiredUuid(payload.sourceInstanceId, "Source component");
      const targetInstanceId = requiredUuid(payload.targetInstanceId, "Target component");
      if (sourceInstanceId === targetInstanceId) {
        throw new Error("Source and target components must be different.");
      }
      const { error } = await appSchema().from("asset_dependencies").insert({
        organization_id: organizationId,
        asset_id: assetId,
        source_instance_id: sourceInstanceId,
        target_instance_id: targetInstanceId,
        dependency_type: payload.dependencyType,
        direction: payload.direction === "bidirectional" ? "bidirectional" : "directed",
        name: optionalText(payload.name, 160),
        description: optionalText(payload.description, 2000),
        created_by_user_account_id: actorId,
        updated_by_user_account_id: actorId,
      });
      throwDatabaseError(error, "create dependency");
    } else if (payload.action === "create_propagation") {
      const likelihood = payload.likelihood ?? "unknown";
      if (!LIKELIHOODS.has(likelihood)) throw new Error("Likelihood is invalid.");
      const confidence = payload.confidence ?? null;
      if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
        throw new Error("Confidence must be between 0 and 1.");
      }
      const sourceInstanceId = requiredUuid(payload.sourceInstanceId, "Source component");
      const targetInstanceId = requiredUuid(payload.targetInstanceId, "Target component");
      if (sourceInstanceId === targetInstanceId) {
        throw new Error("Source and target components must be different.");
      }

      const { error } = await appSchema().from("asset_failure_propagations").insert({
        organization_id: organizationId,
        asset_id: assetId,
        source_instance_id: sourceInstanceId,
        target_instance_id: targetInstanceId,
        source_failure_mode_id: requiredUuid(payload.sourceFailureModeId, "Failure mode"),
        target_effect: requiredText(payload.targetEffect, "Downstream effect", 1000),
        trigger_condition: optionalText(payload.triggerCondition, 1000),
        likelihood,
        confidence,
        rationale: requiredText(payload.rationale, "Engineering rationale", 3000),
        evidence_claim_id: optionalUuid(payload.evidenceClaimId, "Evidence claim"),
        created_by_user_account_id: actorId,
        updated_by_user_account_id: actorId,
      });
      throwDatabaseError(error, "create failure propagation");
    } else if (payload.action === "review_propagation") {
      if (payload.reviewStatus !== "accepted" && payload.reviewStatus !== "rejected") {
        throw new Error("Review status is invalid.");
      }
      const id = requiredUuid(payload.id, "Failure propagation");
      const { data, error } = await appSchema()
        .from("asset_failure_propagations")
        .update({
          review_status: payload.reviewStatus,
          updated_by_user_account_id: actorId,
        })
        .eq("id", id)
        .eq("asset_id", assetId)
        .eq("organization_id", organizationId)
        .select("id")
        .maybeSingle();
      throwDatabaseError(error, "review failure propagation");
      if (!data) throw new Error("Failure propagation was not found in this workspace.");
    } else {
      const entityTypeByAction = {
        delete_asset: "asset",
        delete_instance: "component_instance",
        delete_dependency: "dependency",
        delete_propagation: "failure_propagation",
      } as const;
      const id = requiredUuid(payload.id, "Record");
      const { data, error } = await (getSupabaseServiceClient() as any).rpc(
        "delete_system_model_entity",
        {
          p_organization_id: organizationId,
          p_asset_id: assetId,
          p_entity_type: entityTypeByAction[payload.action],
          p_entity_id: id,
          p_actor_user_account_id: actorId,
        },
      );
      throwDatabaseError(error, "delete system-model record");
      if (!data) throw new Error("System-model record was not found in this workspace.");
    }
  }

  return { ok: true as const };
}
