import { handleApi } from "@/lib/server/runtime";
export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string; index: string }> };
export const GET = async (request: Request, context: Context) => {
  const p = await context.params;
  return handleApi("milestone", request, p.projectId, p.index);
};
