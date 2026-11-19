import { ZodError } from "zod";
import type { BackendService } from "./service";
import { NONCE_SECONDS, SESSION_SECONDS } from "./service";
import { ApiError } from "./errors";
import {
  nonceSchema,
  profileSchema,
  projectSchema,
  scopeSchema,
  uint256Schema,
  verifySchema,
} from "./validation";

export type Endpoint =
  "nonce" | "verify" | "session" | "logout" | "profile" | "project";
function cookieValue(request: Request, name: string) {
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}
export function cookieNames(secure: boolean) {
  return {
    session: secure ? "__Host-tl_session" : "tl_session",
    challenge: secure ? "__Host-tl_challenge" : "tl_challenge",
  };
}
function cookie(name: string, value: string, seconds: number, secure: boolean) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? "; Secure" : ""}`;
}
async function body(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new ApiError(415, "json_required", "Use application/json.");
  const reader = request.body?.getReader();
  if (!reader)
    throw new ApiError(400, "invalid_json", "A JSON object is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > 40_000) {
      await reader.cancel();
      throw new ApiError(413, "body_too_large", "Request exceeds 40 KB.");
    }
    chunks.push(next.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "invalid_json", "Malformed JSON.");
  }
}
export function createApi(options: {
  service: () => BackendService;
  origin: () => string;
  secure: boolean;
  configured?: () => boolean;
}) {
  return async (endpoint: Endpoint, request: Request, projectId?: string) => {
    const headers = new Headers({
      "Cache-Control": "no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    });
    const names = cookieNames(options.secure);
    const reply = (data: unknown, status = 200) =>
      Response.json(data, { status, headers });
    try {
      const method = request.method;
      const allowed =
        endpoint === "profile"
          ? ["GET", "PATCH"]
          : endpoint === "project"
            ? ["GET", "PUT"]
            : endpoint === "session"
              ? ["GET"]
              : ["POST"];
      if (!allowed.includes(method)) {
        headers.set("Allow", allowed.join(", "));
        throw new ApiError(405, "method_not_allowed", "Method not allowed.");
      }
      // No CORS. Never derive the expected origin from Host/forwarded headers.
      if (
        method !== "GET" &&
        (request.headers.get("origin") !== options.origin() ||
          request.headers.get("sec-fetch-site") === "cross-site")
      )
        throw new ApiError(
          403,
          "origin_rejected",
          "Request origin is not allowed.",
        );
      if (endpoint === "session" && options.configured && !options.configured())
        return reply({ configured: false, session: null });
      const service = options.service();
      const sessionToken = cookieValue(request, names.session);
      const challenge = cookieValue(request, names.challenge);
      if (endpoint === "nonce") {
        await service.rate("request:nonce", 400);
        const input = nonceSchema.parse(await body(request));
        const result = await service.nonce(input.address, challenge);
        headers.append(
          "Set-Cookie",
          cookie(
            names.challenge,
            result.challenge,
            NONCE_SECONDS,
            options.secure,
          ),
        );
        return reply({ message: result.message, expiresAt: result.expiresAt });
      }
      if (endpoint === "verify") {
        await service.rate("request:verify", 800);
        const input = verifySchema.parse(await body(request));
        const result = await service.verify(
          input.message,
          input.signature as `0x${string}`,
          challenge,
          sessionToken,
        );
        headers.append(
          "Set-Cookie",
          cookie(names.session, result.token, SESSION_SECONDS, options.secure),
        );
        headers.append(
          "Set-Cookie",
          cookie(names.challenge, "", 0, options.secure),
        );
        return reply({ session: result.session });
      }
      if (endpoint === "logout") {
        await service.logout(sessionToken, challenge);
        headers.append(
          "Set-Cookie",
          cookie(names.session, "", 0, options.secure),
        );
        headers.append(
          "Set-Cookie",
          cookie(names.challenge, "", 0, options.secure),
        );
        return reply({ loggedOut: true });
      }
      const session = await service.session(sessionToken);
      if (endpoint === "session") {
        if (!session && sessionToken)
          headers.append(
            "Set-Cookie",
            cookie(names.session, "", 0, options.secure),
          );
        return reply({ configured: true, session });
      }
      if (!session)
        throw new ApiError(
          401,
          "unauthenticated",
          "Sign in with your connected wallet first.",
        );
      if (endpoint === "profile")
        return reply({
          profile:
            method === "GET"
              ? await service.profile(session.address)
              : await service.updateProfile(
                  session.address,
                  profileSchema.parse(await body(request)),
                ),
        });
      const params = new URL(request.url).searchParams;
      const scope = scopeSchema.parse(Object.fromEntries(params));
      const id = uint256Schema.parse(projectId);
      return reply({
        project:
          method === "GET"
            ? await service.project(session.address, scope, id)
            : await service.saveProject(
                session.address,
                scope,
                id,
                projectSchema.parse(await body(request)),
              ),
      });
    } catch (error) {
      if (error instanceof ZodError)
        return reply(
          {
            error: {
              code: "invalid_input",
              message: "Invalid input.",
              fields: error.issues.map((i) => ({
                path: i.path.join("."),
                message: i.message,
              })),
            },
          },
          400,
        );
      if (error instanceof ApiError)
        return reply(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      // Never echo DB connection errors, query details, signatures or credentials.
      console.error("TrustLayer backend request failed", {
        endpoint,
        category: "dependency_or_database",
      });
      return reply(
        {
          error: {
            code: "backend_unavailable",
            message:
              "Backend database or verified blockchain is unavailable. Check server setup and retry.",
          },
        },
        503,
      );
    }
  };
}
