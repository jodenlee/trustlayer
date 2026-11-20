import { handleApi } from "@/lib/server/runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => handleApi("files", request);
export const POST = (request: Request) => handleApi("files", request);
