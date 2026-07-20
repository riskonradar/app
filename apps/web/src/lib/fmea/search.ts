import type { TaxonomySearchType } from "@/lib/fmea/types";

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (value == null || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

export function parseKnowledgeSearchParams(url: string) {
  const { searchParams } = new URL(url);
  const requestedType = searchParams.get("type");
  const type: TaxonomySearchType = requestedType === "failure_mode" ? "failure_mode" : "component";

  return {
    query: searchParams.get("q")?.trim() || null,
    type,
    domain: searchParams.get("domain")?.trim() || null,
    limit: boundedInteger(searchParams.get("limit"), 100, 1, 500),
    offset: boundedInteger(searchParams.get("offset"), 0, 0, 100_000),
  };
}
