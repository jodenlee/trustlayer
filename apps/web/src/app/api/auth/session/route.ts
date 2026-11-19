import { handleApi } from "@/lib/server/runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => handleApi("session", request);
