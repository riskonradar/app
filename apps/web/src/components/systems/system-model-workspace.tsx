"use client";

import { FormEvent, useMemo, useState } from "react";

import { SystemGraph } from "@/components/systems/system-graph";
import { analyzeCascade } from "@/lib/systems/cascade";
import type {
  AssetDependency,
  ComponentInstance,
  FailurePropagation,
  SystemModelWorkspace as WorkspaceData,
  SystemMutationPayload,
} from "@/lib/systems/types";

function optionLabel(name: string, depth: number) {
  return `${"  ".repeat(depth)}${name}`;
}

function contextValue(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return value == null ? "Not recorded" : JSON.stringify(value);
}

const auditTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function instanceTree(instances: ComponentInstance[]) {
  const byParent = new Map<string | null, ComponentInstance[]>();
  for (const instance of instances) {
    const children = byParent.get(instance.parentInstanceId) ?? [];
    children.push(instance);
    byParent.set(instance.parentInstanceId, children);
  }
  const ordered: Array<ComponentInstance & { depth: number }> = [];
  const seen = new Set<string>();
  function visit(parentId: string | null, depth: number) {
    for (const instance of byParent.get(parentId) ?? []) {
      if (seen.has(instance.id)) continue;
      seen.add(instance.id);
      ordered.push({ ...instance, depth });
      visit(instance.id, depth + 1);
    }
  }
  visit(null, 0);
  for (const instance of instances) {
    if (!seen.has(instance.id)) ordered.push({ ...instance, depth: 0 });
  }
  return ordered;
}

function MutationForm({
  title,
  children,
  onSubmit,
  disabled,
  submitLabel,
}: {
  title: string;
  children: React.ReactNode;
  onSubmit: (form: HTMLFormElement, data: FormData) => Promise<void>;
  disabled: boolean;
  submitLabel: string;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    await onSubmit(form, new FormData(form));
  }

  return (
    <details className="systems-editor">
      <summary>{title}</summary>
      <form onSubmit={submit}>
        {children}
        <button className="btn btn-primary btn-sm" type="submit" disabled={disabled}>
          {submitLabel}
        </button>
      </form>
    </details>
  );
}

export function SystemModelWorkspace({ initialWorkspace }: { initialWorkspace: WorkspaceData }) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [activeAssetId, setActiveAssetId] = useState(initialWorkspace.assets[0]?.id ?? "");
  const [cascadeStartId, setCascadeStartId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activeAsset = workspace.assets.find((asset) => asset.id === activeAssetId) ?? null;
  const instances = useMemo(
    () => workspace.instances.filter((instance) => instance.assetId === activeAssetId),
    [workspace.instances, activeAssetId],
  );
  const dependencies = useMemo(
    () => workspace.dependencies.filter((edge) => edge.assetId === activeAssetId),
    [workspace.dependencies, activeAssetId],
  );
  const propagations = useMemo(
    () => workspace.propagations.filter((edge) => edge.assetId === activeAssetId),
    [workspace.propagations, activeAssetId],
  );
  const auditEvents = useMemo(
    () => workspace.auditEvents.filter((event) => event.assetId === activeAssetId).slice(0, 20),
    [workspace.auditEvents, activeAssetId],
  );
  const orderedInstances = useMemo(() => instanceTree(instances), [instances]);
  const cascades = useMemo(
    () => cascadeStartId ? analyzeCascade(instances, propagations, cascadeStartId) : [],
    [instances, propagations, cascadeStartId],
  );
  const instanceById = useMemo(() => new Map(instances.map((item) => [item.id, item])), [instances]);
  const canWrite = workspace.role !== "viewer";

  async function mutate(payload: SystemMutationPayload, successMessage: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/systems", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as WorkspaceData & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not update the system model.");
      setWorkspace(data);
      if (payload.action === "create_asset") {
        setActiveAssetId(data.assets[0]?.id ?? "");
      }
      setNotice(successMessage);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Could not update the system model.");
      throw mutationError;
    } finally {
      setBusy(false);
    }
  }

  async function handleForm(
    form: HTMLFormElement,
    payload: SystemMutationPayload,
    message: string,
  ) {
    try {
      await mutate(payload, message);
      form.reset();
    } catch {
      // The inline error state is the actionable feedback for failed mutations.
    }
  }

  async function remove(payload: SystemMutationPayload, description: string) {
    if (!window.confirm(`Delete ${description}? Related child records and edges will also be removed.`)) return;
    try {
      await mutate(payload, `${description} deleted.`);
      if (payload.action === "delete_asset") {
        setActiveAssetId(workspace.assets.find((asset) => asset.id !== payload.id)?.id ?? "");
      }
    } catch {
      // The inline error state is the actionable feedback for failed mutations.
    }
  }

  async function reviewPropagation(
    edge: FailurePropagation,
    reviewStatus: "accepted" | "rejected",
  ) {
    try {
      await mutate(
        {
          action: "review_propagation",
          assetId: edge.assetId,
          id: edge.id,
          reviewStatus,
        },
        `Failure propagation ${reviewStatus}.`,
      );
    } catch {
      // The inline error state is the actionable feedback for failed mutations.
    }
  }

  return (
    <div className="systems-workspace">
      <section className="dashboard-panel systems-toolbar" aria-label="System selection">
        <label>
          <span>Asset</span>
          <select
            value={activeAssetId}
            onChange={(event) => {
              setActiveAssetId(event.target.value);
              setCascadeStartId("");
            }}
          >
            {!workspace.assets.length && <option value="">No system assets</option>}
            {workspace.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
          </select>
        </label>

        {canWrite && (
          <form
            className="systems-new-asset"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              void handleForm(form, {
                action: "create_asset",
                name: String(data.get("name") ?? ""),
                assetType: String(data.get("assetType") ?? "engineering_system"),
              }, "System asset created.");
            }}
          >
            <input name="name" required maxLength={160} placeholder="Asset name" aria-label="New asset name" />
            <input name="assetType" maxLength={80} placeholder="Asset type" aria-label="New asset type" />
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>Create asset</button>
          </form>
        )}
        {activeAsset && canWrite && (
          <button
            type="button"
            className="btn btn-secondary btn-sm systems-delete-asset"
            disabled={busy}
            onClick={() => void remove({ action: "delete_asset", assetId: activeAsset.id, id: activeAsset.id }, activeAsset.name)}
          >
            Delete asset
          </button>
        )}
      </section>

      {error && <p className="notice standalone error" role="alert">{error}</p>}
      {notice && <p className="notice standalone" role="status">{notice}</p>}
      {!canWrite && <p className="notice standalone">Viewer access is read-only.</p>}

      {activeAsset ? (
        <>
          <section className="dashboard-panel systems-graph-panel">
            <div className="section-heading systems-section-heading">
              <div>
                <span className="metric-label">System graph</span>
                <h2>{activeAsset.name}</h2>
              </div>
              <div className="systems-legend" aria-label="Graph legend">
                <span className="hierarchy">Hierarchy</span>
                <span className="dependency">Interface</span>
                <span className="propagation">Propagation</span>
              </div>
            </div>
            {Object.keys(activeAsset.operatingContext).length ? (
              <dl className="systems-operating-context" aria-label="Asset operating context">
                {Object.entries(activeAsset.operatingContext).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label.replaceAll("_", " ")}</dt>
                    <dd>{contextValue(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="systems-context-empty">Operating context has not been recorded for this asset.</p>
            )}
            <SystemGraph instances={instances} dependencies={dependencies} propagations={propagations} />
          </section>

          <div className="systems-layout">
            <section className="dashboard-panel systems-structure-panel">
              <div className="section-heading">
                <span className="metric-label">Asset breakdown</span>
                <h2>Component instances</h2>
              </div>

              {orderedInstances.length ? (
                <ol className="systems-instance-tree">
                  {orderedInstances.map((instance) => (
                    <li key={instance.id} style={{ "--tree-depth": instance.depth } as React.CSSProperties}>
                      <div>
                        <strong>{instance.name}</strong>
                        <small>{instance.taxonomyName ?? instance.nodeKind} · {instance.criticality.replace("_", " ")}</small>
                        {instance.functionText && <p>{instance.functionText}</p>}
                      </div>
                      {canWrite && (
                        <button
                          type="button"
                          className="systems-row-action"
                          disabled={busy}
                          onClick={() => void remove({ action: "delete_instance", assetId: activeAsset.id, id: instance.id }, instance.name)}
                        >
                          Delete
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              ) : <p className="systems-empty">No component instances.</p>}

              {canWrite && (
                <MutationForm
                  title="Add component instance"
                  submitLabel="Add component"
                  disabled={busy}
                  onSubmit={(form, data) => handleForm(form, {
                    action: "create_instance",
                    assetId: activeAsset.id,
                    name: String(data.get("name") ?? ""),
                    instanceKey: String(data.get("instanceKey") ?? "") || null,
                    parentInstanceId: String(data.get("parentInstanceId") ?? "") || null,
                    componentId: String(data.get("componentId") ?? ""),
                    nodeKind: String(data.get("nodeKind") ?? "component") as ComponentInstance["nodeKind"],
                    functionText: String(data.get("functionText") ?? "") || null,
                    criticality: String(data.get("criticality") ?? "unrated") as ComponentInstance["criticality"],
                  }, "Component instance added.")}
                >
                  <label><span>Instance name</span><input name="name" required maxLength={160} /></label>
                  <label><span>Instance key</span><input name="instanceKey" maxLength={80} placeholder="e.g. BRG-DE-01" /></label>
                  <label><span>Parent</span><select name="parentInstanceId"><option value="">Asset root</option>{orderedInstances.map((item) => <option key={item.id} value={item.id}>{optionLabel(item.name, item.depth)}</option>)}</select></label>
                  <label><span>Taxonomy component</span><select name="componentId" required><option value="">Select component</option>{workspace.componentTaxonomy.map((item) => <option key={item.id} value={item.id}>{optionLabel(item.name, item.depth)}</option>)}</select></label>
                  <label><span>Structure level</span><select name="nodeKind" defaultValue="component"><option value="system">System</option><option value="subsystem">Subsystem</option><option value="assembly">Assembly</option><option value="component">Component</option></select></label>
                  <label><span>Criticality</span><select name="criticality" defaultValue="unrated"><option value="unrated">Unrated</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="safety_critical">Safety critical</option></select></label>
                  <label className="systems-editor-wide"><span>Function</span><textarea name="functionText" maxLength={1000} rows={2} /></label>
                </MutationForm>
              )}
            </section>

            <section className="dashboard-panel systems-links-panel">
              <div className="section-heading">
                <span className="metric-label">Cross-component behavior</span>
                <h2>Interfaces and dependencies</h2>
              </div>
              <EdgeList
                dependencies={dependencies}
                instances={instances}
                busy={busy}
                canWrite={canWrite}
                onDelete={(edge) => remove({ action: "delete_dependency", assetId: activeAsset.id, id: edge.id }, `${edge.dependencyType} dependency`)}
              />
              {canWrite && instances.length >= 2 && (
                <MutationForm
                  title="Add interface or dependency"
                  submitLabel="Add dependency"
                  disabled={busy}
                  onSubmit={(form, data) => handleForm(form, {
                    action: "create_dependency",
                    assetId: activeAsset.id,
                    sourceInstanceId: String(data.get("sourceInstanceId") ?? ""),
                    targetInstanceId: String(data.get("targetInstanceId") ?? ""),
                    dependencyType: String(data.get("dependencyType") ?? "mechanical") as AssetDependency["dependencyType"],
                    direction: data.get("direction") === "bidirectional" ? "bidirectional" : "directed",
                    name: String(data.get("name") ?? "") || null,
                    description: String(data.get("description") ?? "") || null,
                  }, "Dependency added.")}
                >
                  <InstanceSelect name="sourceInstanceId" label="Source" instances={instances} />
                  <InstanceSelect name="targetInstanceId" label="Target" instances={instances} />
                  <label><span>Interface type</span><select name="dependencyType"><option value="mechanical">Mechanical</option><option value="electrical">Electrical</option><option value="fluid">Fluid</option><option value="thermal">Thermal</option><option value="control">Control</option><option value="structural">Structural</option><option value="data">Data</option><option value="other">Other</option></select></label>
                  <label><span>Direction</span><select name="direction"><option value="directed">Directed</option><option value="bidirectional">Bidirectional</option></select></label>
                  <label><span>Name</span><input name="name" maxLength={160} /></label>
                  <label className="systems-editor-wide"><span>Description</span><textarea name="description" maxLength={2000} rows={2} /></label>
                </MutationForm>
              )}
            </section>
          </div>

          <section className="dashboard-panel systems-cascade-panel">
            <div className="section-heading systems-section-heading">
              <div>
                <span className="metric-label">Cascade analysis</span>
                <h2>Failure propagation paths</h2>
              </div>
              <label className="systems-cascade-origin">
                <span>Starting component</span>
                <select value={cascadeStartId} onChange={(event) => setCascadeStartId(event.target.value)}>
                  <option value="">Select component</option>
                  {instances.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            </div>

            <PropagationList
              propagations={propagations}
              instanceById={instanceById}
              busy={busy}
              canWrite={canWrite}
              onReview={reviewPropagation}
              onDelete={(edge) => remove({ action: "delete_propagation", assetId: activeAsset.id, id: edge.id }, `${edge.failureModeName} propagation`)}
            />

            {cascadeStartId && (
              <div className="systems-cascade-results">
                <h3>Downstream paths</h3>
                {cascades.length ? cascades.map((path) => (
                  <article key={path.id}>
                    <p>{path.instanceIds.map((id) => instanceById.get(id)?.name ?? "Unknown component").join(" -> ")}</p>
                    <small>{path.effects.join("; ")} · {path.likelihood} likelihood · {path.confidence === null ? "confidence unknown" : `${Math.round(path.confidence * 100)}% minimum edge confidence`}{path.cycleDetected ? " · cycle detected" : ""}</small>
                  </article>
                )) : <p className="systems-empty">No accepted downstream path starts here.</p>}
              </div>
            )}

            {canWrite && instances.length >= 2 && (
              <MutationForm
                title="Add failure propagation"
                submitLabel="Add propagation"
                disabled={busy}
                onSubmit={(form, data) => handleForm(form, {
                  action: "create_propagation",
                  assetId: activeAsset.id,
                  sourceInstanceId: String(data.get("sourceInstanceId") ?? ""),
                  targetInstanceId: String(data.get("targetInstanceId") ?? ""),
                  sourceFailureModeId: String(data.get("sourceFailureModeId") ?? ""),
                  targetEffect: String(data.get("targetEffect") ?? ""),
                  triggerCondition: String(data.get("triggerCondition") ?? "") || null,
                  likelihood: String(data.get("likelihood") ?? "unknown") as FailurePropagation["likelihood"],
                  confidence: data.get("confidence") ? Number(data.get("confidence")) : null,
                  rationale: String(data.get("rationale") ?? ""),
                  evidenceClaimId: String(data.get("evidenceClaimId") ?? "") || null,
                }, "Failure propagation added.")}
              >
                <InstanceSelect name="sourceInstanceId" label="Source component" instances={instances} />
                <InstanceSelect name="targetInstanceId" label="Affected component" instances={instances} />
                <label><span>Source failure mode</span><select name="sourceFailureModeId" required><option value="">Select failure mode</option>{workspace.failureModeTaxonomy.map((item) => <option key={item.id} value={item.id}>{optionLabel(item.name, item.depth)}</option>)}</select></label>
                <label><span>Likelihood</span><select name="likelihood"><option value="unknown">Unknown</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
                <label className="systems-editor-wide"><span>Downstream effect</span><textarea name="targetEffect" required maxLength={1000} rows={2} /></label>
                <label className="systems-editor-wide"><span>Trigger condition</span><textarea name="triggerCondition" maxLength={1000} rows={2} /></label>
                <label className="systems-editor-wide"><span>Engineering rationale</span><textarea name="rationale" required maxLength={3000} rows={3} /></label>
                <label><span>Confidence (0-1)</span><input name="confidence" type="number" min="0" max="1" step="0.01" /></label>
              </MutationForm>
            )}

            <details className="systems-audit">
              <summary>Model change history</summary>
              {auditEvents.length ? (
                <ol>
                  {auditEvents.map((event) => (
                    <li key={event.id}>
                      <span>{event.action} {event.entityType.replaceAll("_", " ")}</span>
                      <time dateTime={event.createdAt}>{auditTimestampFormatter.format(new Date(event.createdAt))} UTC</time>
                    </li>
                  ))}
                </ol>
              ) : <p className="systems-empty">No recorded changes.</p>}
            </details>
          </section>
        </>
      ) : (
        <section className="dashboard-panel systems-empty-panel">
          <h2>No system assets</h2>
        </section>
      )}
    </div>
  );
}

function InstanceSelect({ name, label, instances }: { name: string; label: string; instances: ComponentInstance[] }) {
  return <label><span>{label}</span><select name={name} required><option value="">Select component</option>{instances.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
}

function EdgeList({ dependencies, instances, busy, canWrite, onDelete }: {
  dependencies: AssetDependency[];
  instances: ComponentInstance[];
  busy: boolean;
  canWrite: boolean;
  onDelete: (edge: AssetDependency) => Promise<void>;
}) {
  const names = new Map(instances.map((item) => [item.id, item.name]));
  if (!dependencies.length) return <p className="systems-empty">No interfaces or dependencies.</p>;
  return <ul className="systems-edge-list">{dependencies.map((edge) => <li key={edge.id}><div><strong>{names.get(edge.sourceInstanceId)} {edge.direction === "bidirectional" ? "<->" : "->"} {names.get(edge.targetInstanceId)}</strong><small>{edge.dependencyType}{edge.name ? ` · ${edge.name}` : ""}</small>{edge.description && <p>{edge.description}</p>}</div>{canWrite && <button type="button" className="systems-row-action" disabled={busy} onClick={() => void onDelete(edge)}>Delete</button>}</li>)}</ul>;
}

function PropagationList({ propagations, instanceById, busy, canWrite, onReview, onDelete }: {
  propagations: FailurePropagation[];
  instanceById: Map<string, ComponentInstance>;
  busy: boolean;
  canWrite: boolean;
  onReview: (edge: FailurePropagation, status: "accepted" | "rejected") => Promise<void>;
  onDelete: (edge: FailurePropagation) => Promise<void>;
}) {
  if (!propagations.length) return <p className="systems-empty">No failure-propagation edges.</p>;
  return (
    <ul className="systems-propagation-list">
      {propagations.map((edge) => {
        const edgeLabel = `${instanceById.get(edge.sourceInstanceId)?.name ?? "Source component"} ${edge.failureModeName}`;
        return (
          <li key={edge.id}>
            <div>
              <strong>{instanceById.get(edge.sourceInstanceId)?.name} / {edge.failureModeName}</strong>
              <span aria-hidden="true">&rarr;</span>
              <strong>{instanceById.get(edge.targetInstanceId)?.name}</strong>
              <p>{edge.targetEffect}</p>
              <small>{edge.likelihood} likelihood · {edge.reviewStatus.replace("_", " ")} · {edge.confidence === null ? "confidence unknown" : `${Math.round(edge.confidence * 100)}% confidence`}</small>
              <dl className="systems-propagation-evidence">
                <div>
                  <dt>Trigger condition</dt>
                  <dd>{edge.triggerCondition || "Not specified"}</dd>
                </div>
                <div>
                  <dt>Engineering rationale</dt>
                  <dd>{edge.rationale}</dd>
                </div>
                <div>
                  <dt>Evidence claim</dt>
                  <dd>{edge.evidenceClaimId ? <code>{edge.evidenceClaimId}</code> : "No evidence claim linked"}</dd>
                </div>
              </dl>
            </div>
            {canWrite && (
              <div className="systems-review-actions" aria-label={`Review propagation from ${edgeLabel}`}>
                {edge.reviewStatus !== "accepted" && <button type="button" className="systems-accept-action" disabled={busy} onClick={() => void onReview(edge, "accepted")}>Accept</button>}
                {edge.reviewStatus !== "rejected" && <button type="button" className="systems-reject-action" disabled={busy} onClick={() => void onReview(edge, "rejected")}>Reject</button>}
                <button type="button" className="systems-row-action" disabled={busy} onClick={() => void onDelete(edge)}>Delete</button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
