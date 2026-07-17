import {
  deleteFmeaAnalysis,
  getFmeaAnalysis,
  renameFmeaAnalysis,
} from "@/lib/fmea/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const result = await getFmeaAnalysis(request, id);
    if (!result) {
      return Response.json({ error: "Sign in to view this analysis." }, { status: 401 });
    }
    if ("notFound" in result) {
      return Response.json({ error: "Analysis not found." }, { status: 404 });
    }
    if ("forbidden" in result) {
      return Response.json({ error: "You do not have permission to view this analysis." }, { status: 403 });
    }

    return Response.json(result);
  } catch (error) {
    console.error("FMEA analysis get route failed:", error);
    return Response.json({ error: "Could not load analysis." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const payload = await request.json().catch(() => ({}));
    const result = await renameFmeaAnalysis(request, id, String(payload.name ?? ""));
    if (!result) {
      return Response.json({ error: "Sign in to rename this analysis." }, { status: 401 });
    }
    if ("notFound" in result) {
      return Response.json({ error: "Analysis not found." }, { status: 404 });
    }
    if ("forbidden" in result) {
      return Response.json({ error: "You do not have permission to rename this analysis." }, { status: 403 });
    }

    return Response.json(result);
  } catch (error) {
    console.error("FMEA analysis rename route failed:", error);
    return Response.json({ error: "Could not rename analysis." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const result = await deleteFmeaAnalysis(request, id);
    if (!result) {
      return Response.json({ error: "Sign in to delete this analysis." }, { status: 401 });
    }
    if ("notFound" in result) {
      return Response.json({ error: "Analysis not found." }, { status: 404 });
    }
    if ("forbidden" in result) {
      return Response.json({ error: "You do not have permission to delete this analysis." }, { status: 403 });
    }

    return Response.json(result);
  } catch (error) {
    console.error("FMEA analysis delete route failed:", error);
    return Response.json({ error: "Could not delete analysis." }, { status: 500 });
  }
}
