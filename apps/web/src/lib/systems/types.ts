export type ComponentTaxonomyNode = {
  id: string;
  name: string;
  path: string;
  depth: number;
};

export type FailureModeTaxonomyNode = ComponentTaxonomyNode;

export type SystemAsset = {
  id: string;
  name: string;
  assetType: string;
  operatingContext: Record<string, unknown>;
  updatedAt: string;
};

export type ComponentInstance = {
  id: string;
  assetId: string;
  parentInstanceId: string | null;
  componentId: string;
  taxonomyName: string;
  taxonomyPath: string;
  name: string;
  instanceKey: string | null;
  nodeKind: "system" | "subsystem" | "assembly" | "component";
  functionText: string | null;
  criticality: "unrated" | "low" | "medium" | "high" | "safety_critical";
};

export type AssetDependency = {
  id: string;
  assetId: string;
  sourceInstanceId: string;
  targetInstanceId: string;
  dependencyType:
    | "mechanical"
    | "electrical"
    | "fluid"
    | "thermal"
    | "control"
    | "structural"
    | "data"
    | "other";
  direction: "directed" | "bidirectional";
  name: string | null;
  description: string | null;
};

export type FailurePropagation = {
  id: string;
  assetId: string;
  sourceInstanceId: string;
  targetInstanceId: string;
  sourceFailureModeId: string;
  failureModeName: string;
  targetEffect: string;
  triggerCondition: string | null;
  likelihood: "unknown" | "low" | "medium" | "high";
  confidence: number | null;
  rationale: string;
  evidenceClaimId: string | null;
  reviewStatus: "needs_review" | "accepted" | "rejected" | "superseded";
};

export type SystemModelAuditEvent = {
  id: string;
  assetId: string | null;
  entityType: "asset" | "component_instance" | "dependency" | "failure_propagation";
  entityId: string;
  action: "created" | "updated" | "deleted";
  createdAt: string;
};

export type SystemModelWorkspace = {
  workspaceName: string;
  role: string;
  assets: SystemAsset[];
  instances: ComponentInstance[];
  dependencies: AssetDependency[];
  propagations: FailurePropagation[];
  auditEvents: SystemModelAuditEvent[];
  componentTaxonomy: ComponentTaxonomyNode[];
  failureModeTaxonomy: FailureModeTaxonomyNode[];
};

export type SystemMutationPayload =
  | { action: "create_asset"; name: string; assetType?: string }
  | {
      action: "create_instance";
      assetId: string;
      name: string;
      parentInstanceId?: string | null;
      componentId: string;
      instanceKey?: string | null;
      nodeKind?: ComponentInstance["nodeKind"];
      functionText?: string | null;
      criticality?: ComponentInstance["criticality"];
    }
  | {
      action: "create_dependency";
      assetId: string;
      sourceInstanceId: string;
      targetInstanceId: string;
      dependencyType: AssetDependency["dependencyType"];
      direction?: AssetDependency["direction"];
      name?: string | null;
      description?: string | null;
    }
  | {
      action: "create_propagation";
      assetId: string;
      sourceInstanceId: string;
      targetInstanceId: string;
      sourceFailureModeId: string;
      targetEffect: string;
      triggerCondition?: string | null;
      likelihood?: FailurePropagation["likelihood"];
      confidence?: number | null;
      rationale: string;
      evidenceClaimId?: string | null;
    }
  | {
      action: "review_propagation";
      assetId: string;
      id: string;
      reviewStatus: "accepted" | "rejected";
    }
  | {
      action: "delete_asset" | "delete_instance" | "delete_dependency" | "delete_propagation";
      assetId: string;
      id: string;
    };
