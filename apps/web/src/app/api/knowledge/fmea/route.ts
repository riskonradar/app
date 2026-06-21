import { getSupabaseAnonClient } from "@/lib/supabase/server";

type SupabaseFmeaRow = {
  component: string;
  failure_mode: string;
  effect: string | null;
  cause: string | null;
  severity: string | null;
  occurrence: string | null;
  detection: string | null;
  corrective_action: string | null;
  rpn: string | null;
  evidence_count: number;
  sources: unknown[];
  component_order: number;
  source_record_count?: number;
  relevant_record_count?: number;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "500", 10), 1000);

  const supabase = getSupabaseAnonClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_turbofan_fmea", { p_limit: limit });

  if (error) {
    console.error("get_turbofan_fmea error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const typedRows = (data ?? []) as SupabaseFmeaRow[];
  const components = [
    ...new Set(
      typedRows
        .sort((a, b) => a.component_order - b.component_order)
        .map((row) => row.component),
    ),
  ];

  return Response.json({
    system: "Turbofan engine",
    sourceType: "Supabase journal papers and EASA AD reports",
    recordCount: Number(typedRows[0]?.source_record_count ?? 0),
    relevantRecordCount: Number(typedRows[0]?.relevant_record_count ?? 0),
    rowCount: typedRows.length,
    components,
    rows: typedRows.map((row) => ({
      component: row.component,
      failureMode: row.failure_mode,
      effect: row.effect ?? "",
      cause: row.cause ?? "",
      severity: row.severity ?? "",
      occurrence: row.occurrence ?? "",
      detection: row.detection ?? "",
      correctiveAction: row.corrective_action ?? "",
      rpn: row.rpn ?? "",
      evidenceCount: Number(row.evidence_count || 0),
      sources: Array.isArray(row.sources) ? row.sources : [],
    })),
  });
}
