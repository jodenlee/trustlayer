import { handleApi } from "@/lib/server/runtime";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: Request, context: Context) =>
  handleApi("fileVerify", request, (await context.params).id);
