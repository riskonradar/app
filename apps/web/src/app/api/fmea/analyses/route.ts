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
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 2_000_000) {
      return Response.json({ error: "Analysis payload is too large." }, { status: 413 });
    }
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
    if ("forbidden" in result) {
      return Response.json({ error: "You do not have permission to save analyses." }, { status: 403 });
    }
    if ("invalid" in result) {
      return Response.json({ error: result.message }, { status: 400 });
    }
    if ("conflict" in result) {
      return Response.json({ error: result.message }, { status: 409 });
    }

    return Response.json(result);
  } catch (error) {
    console.error("FMEA analysis save route failed:", error);
    return Response.json({ error: "Could not save analysis." }, { status: 500 });
  }
}
