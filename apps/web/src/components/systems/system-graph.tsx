import type {
  AssetDependency,
  ComponentInstance,
  FailurePropagation,
} from "@/lib/systems/types";

type GraphNode = ComponentInstance & { x: number; y: number };

function hierarchyDepth(instance: ComponentInstance, byId: Map<string, ComponentInstance>) {
  let depth = 0;
  let current = instance;
  const seen = new Set([instance.id]);
  while (current.parentInstanceId && depth < 8) {
    const parent = byId.get(current.parentInstanceId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
    depth += 1;
  }
  return depth;
}

function shortenedLabel(label: string) {
  return label.length > 22 ? `${label.slice(0, 20)}...` : label;
}

export function SystemGraph({
  instances,
  dependencies,
  propagations,
}: {
  instances: ComponentInstance[];
  dependencies: AssetDependency[];
  propagations: FailurePropagation[];
}) {
  if (!instances.length) {
    return <p className="systems-empty">No component instances in this asset.</p>;
  }

  const byId = new Map(instances.map((instance) => [instance.id, instance]));
  const columns = new Map<number, ComponentInstance[]>();
  for (const instance of instances) {
    const depth = hierarchyDepth(instance, byId);
    columns.set(depth, [...(columns.get(depth) ?? []), instance]);
  }

  const columnCount = Math.max(...columns.keys()) + 1;
  const largestColumn = Math.max(...[...columns.values()].map((items) => items.length));
  const width = Math.max(720, columnCount * 210 + 60);
  const height = Math.max(260, largestColumn * 94 + 60);
  const nodes: GraphNode[] = [];
  for (const [depth, items] of columns.entries()) {
    const columnHeight = items.length * 94;
    const startY = (height - columnHeight) / 2 + 20;
    items.forEach((instance, index) => {
      nodes.push({ ...instance, x: 34 + depth * 210, y: startY + index * 94 });
    });
  }
  const graphNodeById = new Map(nodes.map((node) => [node.id, node]));

  function edgePath(sourceId: string, targetId: string) {
    const source = graphNodeById.get(sourceId);
    const target = graphNodeById.get(targetId);
    if (!source || !target) return null;
    const sourceX = source.x + 156;
    const sourceY = source.y + 29;
    const targetX = target.x;
    const targetY = target.y + 29;
    const midpoint = sourceX + (targetX - sourceX) / 2;
    return `M ${sourceX} ${sourceY} C ${midpoint} ${sourceY}, ${midpoint} ${targetY}, ${targetX} ${targetY}`;
  }

  return (
    <div className="systems-graph-scroll">
      <svg
        className="systems-graph"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Component hierarchy with interface and failure-propagation edges"
      >
        <defs>
          <marker id="system-edge-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
          <marker id="system-risk-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>

        {instances.filter((instance) => instance.parentInstanceId).map((instance) => {
          const path = edgePath(instance.parentInstanceId as string, instance.id);
          return path ? <path key={`hierarchy-${instance.id}`} d={path} className="systems-hierarchy-edge" /> : null;
        })}
        {dependencies.map((edge) => {
          const path = edgePath(edge.sourceInstanceId, edge.targetInstanceId);
          return path ? (
            <path
              key={edge.id}
              d={path}
              className="systems-dependency-edge"
              markerEnd="url(#system-edge-arrow)"
              markerStart={edge.direction === "bidirectional" ? "url(#system-edge-arrow)" : undefined}
            >
              <title>{edge.dependencyType} dependency</title>
            </path>
          ) : null;
        })}
        {propagations.filter((edge) => edge.reviewStatus === "accepted").map((edge) => {
          const path = edgePath(edge.sourceInstanceId, edge.targetInstanceId);
          return path ? (
            <path key={edge.id} d={path} className="systems-propagation-edge" markerEnd="url(#system-risk-arrow)">
              <title>{edge.failureModeName}: {edge.targetEffect}</title>
            </path>
          ) : null;
        })}

        {nodes.map((node) => (
          <g key={node.id} transform={`translate(${node.x} ${node.y})`} className="systems-graph-node">
            <title>{node.name}{node.taxonomyName ? ` (${node.taxonomyName})` : ""}</title>
            <rect width="156" height="58" rx="6" />
            <text x="12" y="24">{shortenedLabel(node.name)}</text>
            <text x="12" y="43" className="systems-graph-node-type">
              {shortenedLabel(node.taxonomyName ?? node.nodeKind)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
