import { handleApi } from "@/lib/server/runtime";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export const POST = async (request: Request, context: Context) =>
  handleApi("fileAssociate", request, (await context.params).id);
