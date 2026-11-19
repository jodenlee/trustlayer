import { handleApi } from "@/lib/server/runtime";
export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string }> };
export const GET = async (request: Request, context: Context) =>
  handleApi("project", request, (await context.params).projectId);
export const PUT = async (request: Request, context: Context) =>
  handleApi("project", request, (await context.params).projectId);
