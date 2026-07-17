import type { ComponentInstance, FailurePropagation } from "@/lib/systems/types";

export type CascadePath = {
  id: string;
  instanceIds: string[];
  propagationIds: string[];
  effects: string[];
  likelihood: FailurePropagation["likelihood"];
  confidence: number | null;
  cycleDetected: boolean;
};

const likelihoodRank: Record<FailurePropagation["likelihood"], number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function weakestLikelihood(edges: FailurePropagation[]) {
  return edges.reduce<FailurePropagation["likelihood"]>(
    (weakest, edge) =>
      likelihoodRank[edge.likelihood] < likelihoodRank[weakest] ? edge.likelihood : weakest,
    "high",
  );
}

function lowestKnownConfidence(edges: FailurePropagation[]) {
  if (edges.some((edge) => edge.confidence === null)) return null;
  const known = edges
    .map((edge) => edge.confidence)
    .filter((confidence): confidence is number => confidence !== null);
  return known.length ? Math.min(...known) : null;
}

export function analyzeCascade(
  instances: ComponentInstance[],
  propagations: FailurePropagation[],
  startInstanceId: string,
  maxDepth = 8,
): CascadePath[] {
  if (!instances.some((instance) => instance.id === startInstanceId)) return [];

  const usableEdges = propagations.filter(
    (edge) => edge.reviewStatus === "accepted",
  );
  const edgesBySource = new Map<string, FailurePropagation[]>();
  for (const edge of usableEdges) {
    const existing = edgesBySource.get(edge.sourceInstanceId) ?? [];
    existing.push(edge);
    edgesBySource.set(edge.sourceInstanceId, existing);
  }

  const results: CascadePath[] = [];

  function walk(instanceIds: string[], edges: FailurePropagation[]) {
    const currentId = instanceIds.at(-1);
    if (!currentId) return;

    const outgoing = edgesBySource.get(currentId) ?? [];
    if (!outgoing.length || edges.length >= maxDepth) {
      if (edges.length) {
        results.push(toPath(instanceIds, edges, false));
      }
      return;
    }

    for (const edge of outgoing) {
      const cycleDetected = instanceIds.includes(edge.targetInstanceId);
      const nextInstances = [...instanceIds, edge.targetInstanceId];
      const nextEdges = [...edges, edge];
      if (cycleDetected) {
        results.push(toPath(nextInstances, nextEdges, true));
      } else {
        walk(nextInstances, nextEdges);
      }
    }
  }

  function toPath(
    instanceIds: string[],
    edges: FailurePropagation[],
    cycleDetected: boolean,
  ): CascadePath {
    return {
      id: edges.map((edge) => edge.id).join(":"),
      instanceIds,
      propagationIds: edges.map((edge) => edge.id),
      effects: edges.map((edge) => edge.targetEffect),
      likelihood: weakestLikelihood(edges),
      confidence: lowestKnownConfidence(edges),
      cycleDetected,
    };
  }

  walk([startInstanceId], []);
  return results;
}
