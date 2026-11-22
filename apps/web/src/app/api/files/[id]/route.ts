import { handleApi } from "@/lib/server/runtime";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: Request, context: Context) =>
  handleApi("file", request, (await context.params).id);
export const DELETE = async (request: Request, context: Context) =>
  handleApi("file", request, (await context.params).id);
