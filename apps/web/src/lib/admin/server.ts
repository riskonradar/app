/* eslint-disable @typescript-eslint/no-explicit-any */

import { getSupabaseServiceClient } from "@/lib/supabase/server";

export const ADMIN_PAGE_SIZE = 50;

export const PAPER_CLASSIFICATION_STATUSES = [
  "pending",
  "classified",
  "failed",
  "skipped",
] as const;

const PAPER_LIFECYCLE_STATUSES = [
  "discovered",
  "pending_classification",
  "classified",
  "stale",
  "removed",
] as const;

const CLASSIFICATION_JOB_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
] as const;

export type AdminPaperStatus = (typeof PAPER_CLASSIFICATION_STATUSES)[number];

export type AdminPaper = {
  id: string;
  title: string;
  doi: string | null;
  journal: string | null;
  classificationStatus: string;
  lifecycleStatus: string;
  updatedAt: string;
  failedJob: {
    attempts: number;
    lastError: string | null;
    classifierVersion: string;
    stuck: boolean;
  } | null;
};

type CountResult = {
  count: number | null;
  error: { message: string } | null;
};

type QueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

function schema(name: "papers_raw" | "knowledge") {
  return (getSupabaseServiceClient() as any).schema(name);
}

function assertQuery(result: { error: { message: string } | null }, label: string) {
  if (result.error) {
    console.error(`Failed to load admin ${label}:`, result.error);
    throw new Error(`Could not load admin ${label}.`);
  }
}

function countMap<T extends readonly string[]>(statuses: T, results: CountResult[]) {
  return Object.fromEntries(
    statuses.map((status, index) => [status, results[index]?.count ?? 0]),
  ) as Record<T[number], number>;
}

export function parseAdminPaperStatus(value: string | undefined): AdminPaperStatus | null {
  return PAPER_CLASSIFICATION_STATUSES.includes(value as AdminPaperStatus)
    ? (value as AdminPaperStatus)
    : null;
}

export async function getAdminDashboard({
  page = 1,
  status = null,
}: {
  page?: number;
  status?: AdminPaperStatus | null;
}) {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const from = (safePage - 1) * ADMIN_PAGE_SIZE;
  const to = from + ADMIN_PAGE_SIZE - 1;
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  let papersPageQuery = schema("papers_raw")
    .from("paper_candidates")
    .select(
      "id, title, doi, journal, classification_status, lifecycle_status, updated_at",
      { count: "exact" },
    )
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (status) {
    papersPageQuery = papersPageQuery.eq("classification_status", status);
  }

  const [
    totalPapersResult,
    papersPageResult,
    latestDiscoveryResult,
    taxonomyInboxResult,
    paperClassificationCountResults,
    paperLifecycleCountResults,
    classificationJobCountResults,
    claimsTotalResult,
    claimsSevenDayResult,
    claimsThirtyDayResult,
    spansTotalResult,
    spansSevenDayResult,
    spansThirtyDayResult,
    relationshipsTotalResult,
    relationshipsSevenDayResult,
    relationshipsThirtyDayResult,
  ] = await Promise.all([
    schema("papers_raw")
      .from("paper_candidates")
      .select("id", { count: "exact", head: true }),
    papersPageQuery,
    schema("papers_raw")
      .from("discovery_runs")
      .select("id, source, query, status, started_at, finished_at, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    (getSupabaseServiceClient().rpc as any)("get_taxonomy_inbox", {
      p_claim_type: null,
      p_limit: 20,
    }),
    Promise.all(
      PAPER_CLASSIFICATION_STATUSES.map((paperStatus) =>
        schema("papers_raw")
          .from("paper_candidates")
          .select("id", { count: "exact", head: true })
          .eq("classification_status", paperStatus),
      ),
    ),
    Promise.all(
      PAPER_LIFECYCLE_STATUSES.map((lifecycleStatus) =>
        schema("papers_raw")
          .from("paper_candidates")
          .select("id", { count: "exact", head: true })
          .eq("lifecycle_status", lifecycleStatus),
      ),
    ),
    Promise.all(
      CLASSIFICATION_JOB_STATUSES.map((jobStatus) =>
        schema("knowledge")
          .from("classification_jobs")
          .select("id", { count: "exact", head: true })
          .eq("status", jobStatus),
      ),
    ),
    schema("knowledge").from("evidence_claims").select("id", { count: "exact", head: true }),
    schema("knowledge")
      .from("evidence_claims")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo),
    schema("knowledge")
      .from("evidence_claims")
      .select("id", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo),
    schema("knowledge").from("evidence_spans").select("id", { count: "exact", head: true }),
    schema("knowledge")
      .from("evidence_spans")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo),
    schema("knowledge")
      .from("evidence_spans")
      .select("id", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo),
    schema("knowledge")
      .from("claim_relationships")
      .select("id", { count: "exact", head: true }),
    schema("knowledge")
      .from("claim_relationships")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo),
    schema("knowledge")
      .from("claim_relationships")
      .select("id", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo),
  ]);

  const namedResults = [
    [totalPapersResult, "paper total"],
    [papersPageResult, "paper list"],
    [latestDiscoveryResult, "latest discovery run"],
    [taxonomyInboxResult, "taxonomy inbox"],
    [claimsTotalResult, "claim total"],
    [claimsSevenDayResult, "7-day claim growth"],
    [claimsThirtyDayResult, "30-day claim growth"],
    [spansTotalResult, "span total"],
    [spansSevenDayResult, "7-day span growth"],
    [spansThirtyDayResult, "30-day span growth"],
    [relationshipsTotalResult, "relationship total"],
    [relationshipsSevenDayResult, "7-day relationship growth"],
    [relationshipsThirtyDayResult, "30-day relationship growth"],
  ] as const;

  for (const [result, label] of namedResults) {
    assertQuery(result, label);
  }

  paperClassificationCountResults.forEach((result, index) =>
    assertQuery(result, `${PAPER_CLASSIFICATION_STATUSES[index]} paper count`),
  );
  paperLifecycleCountResults.forEach((result, index) =>
    assertQuery(result, `${PAPER_LIFECYCLE_STATUSES[index]} lifecycle count`),
  );
  classificationJobCountResults.forEach((result, index) =>
    assertQuery(result, `${CLASSIFICATION_JOB_STATUSES[index]} job count`),
  );

  const paperRows = (papersPageResult.data ?? []) as Array<{
    id: string;
    title: string;
    doi: string | null;
    journal: string | null;
    classification_status: string;
    lifecycle_status: string;
    updated_at: string;
  }>;
  // A failed LLM attempt can be followed by a successful keyword fallback,
  // which returns the candidate to `classified`. Inspect every visible paper
  // so that the failed provider attempt remains operationally visible.
  const visiblePaperIds = paperRows.map((paper) => paper.id);
  const failedJobsByPaper = new Map<
    string,
    { attempts: number; last_error: string | null; classifier_version: string }
  >();

  if (visiblePaperIds.length) {
    const failedJobsResult = (await schema("knowledge")
      .from("classification_jobs")
      .select("paper_candidate_id, attempts, last_error, classifier_version, updated_at")
      .in("paper_candidate_id", visiblePaperIds)
      .eq("status", "failed")
      .order("updated_at", { ascending: false })) as QueryResult<
      Array<{
        paper_candidate_id: string;
        attempts: number;
        last_error: string | null;
        classifier_version: string;
      }>
    >;

    assertQuery(failedJobsResult, "failed classifier jobs");
    for (const job of failedJobsResult.data ?? []) {
      if (!failedJobsByPaper.has(job.paper_candidate_id)) {
        failedJobsByPaper.set(job.paper_candidate_id, job);
      }
    }
  }

  const papers: AdminPaper[] = paperRows.map((paper) => {
    const failedJob = failedJobsByPaper.get(paper.id);
    return {
      id: paper.id,
      title: paper.title,
      doi: paper.doi,
      journal: paper.journal,
      classificationStatus: paper.classification_status,
      lifecycleStatus: paper.lifecycle_status,
      updatedAt: paper.updated_at,
      failedJob: failedJob
        ? {
            attempts: failedJob.attempts,
            lastError: failedJob.last_error,
            classifierVersion: failedJob.classifier_version,
            stuck: failedJob.attempts >= 3,
          }
        : null,
    };
  });
  const filteredPaperCount = papersPageResult.count ?? 0;

  return {
    papers: {
      total: totalPapersResult.count ?? 0,
      classificationCounts: countMap(
        PAPER_CLASSIFICATION_STATUSES,
        paperClassificationCountResults,
      ),
      lifecycleCounts: countMap(PAPER_LIFECYCLE_STATUSES, paperLifecycleCountResults),
      rows: papers,
      page: safePage,
      pageSize: ADMIN_PAGE_SIZE,
      pageCount: Math.max(1, Math.ceil(filteredPaperCount / ADMIN_PAGE_SIZE)),
      filteredCount: filteredPaperCount,
      status,
    },
    latestDiscoveryRun: latestDiscoveryResult.data as {
      id: string;
      source: string;
      query: string;
      status: string;
      started_at: string | null;
      finished_at: string | null;
      metadata: Record<string, unknown>;
      created_at: string;
    } | null,
    classificationJobs: {
      counts: countMap(CLASSIFICATION_JOB_STATUSES, classificationJobCountResults),
    },
    evidence: {
      claims: {
        total: claimsTotalResult.count ?? 0,
        last7Days: claimsSevenDayResult.count ?? 0,
        last30Days: claimsThirtyDayResult.count ?? 0,
      },
      spans: {
        total: spansTotalResult.count ?? 0,
        last7Days: spansSevenDayResult.count ?? 0,
        last30Days: spansThirtyDayResult.count ?? 0,
      },
      relationships: {
        total: relationshipsTotalResult.count ?? 0,
        last7Days: relationshipsSevenDayResult.count ?? 0,
        last30Days: relationshipsThirtyDayResult.count ?? 0,
      },
    },
    taxonomyInbox: (taxonomyInboxResult.data ?? []) as Array<{
      claim_type: string;
      label: string;
      claim_count: number;
      paper_count: number;
      last_seen_at: string;
    }>,
  };
}
