import { listFmeaAnalyses, saveFmeaAnalysis } from "@/lib/fmea/server";

export async function GET(request: Request) {
  try {
    const result = await listFmeaAnalyses(request);
    if (!result) {
      return Response.json({ error: "Sign in to view saved analyses." }, { status: 401 });
    }

    return Response.json(result);
  } catch (error) {
    console.error("FMEA analysis list route failed:", error);
    return Response.json({ error: "Could not load saved analyses." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const result = await saveFmeaAnalysis(request, payload);
    if (!result) {
      return Response.json({ error: "Sign in to save analyses." }, { status: 401 });
    }
    if ("limitExceeded" in result) {
      return Response.json({ error: result.message }, { status: 402 });
    }
    if ("notFound" in result) {
      return Response.json({ error: "Analysis not found." }, { status: 404 });
    }

    return Response.json(result);
  } catch (error) {
    console.error("FMEA analysis save route failed:", error);
    return Response.json({ error: "Could not save analysis." }, { status: 500 });
  }
}
