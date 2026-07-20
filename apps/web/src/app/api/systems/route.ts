import { getSystemModelWorkspace, mutateSystemModel } from "@/lib/systems/server";
import type { SystemMutationPayload } from "@/lib/systems/types";

export async function GET(request: Request) {
  try {
    const workspace = await getSystemModelWorkspace(request);
    if (!workspace) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json(workspace);
  } catch (error) {
    console.error("System model load route failed:", error);
    return Response.json({ error: "Could not load system models." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as SystemMutationPayload | null;
    if (!payload || typeof payload.action !== "string") {
      return Response.json({ error: "A system-model action is required." }, { status: 400 });
    }

    const result = await mutateSystemModel(request, payload);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    const workspace = await getSystemModelWorkspace(request);
    if (!workspace) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json(workspace);
  } catch (error) {
    console.error("System model mutation route failed:", error);
    const message = error instanceof Error ? error.message : "Could not update the system model.";
    const isInputError = /required|invalid|must be|does not support|not found in this workspace|between 0 and 1/i.test(message);
    return Response.json(
      { error: isInputError ? message : "Could not update the system model." },
      { status: isInputError ? 400 : 500 },
    );
  }
}
