import { handleApi } from "@/lib/server/runtime";
export const runtime = "nodejs";
export const POST = (request: Request) => handleApi("nonce", request);
