import { handleApi } from "@/lib/server/runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => handleApi("profile", request);
export const PATCH = (request: Request) => handleApi("profile", request);
