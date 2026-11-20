import { ZodError } from "zod";
import type { BackendService } from "./service";
import { NONCE_SECONDS, SESSION_SECONDS } from "./service";
import { ApiError } from "./errors";
import { z } from "zod";
import type { FileService } from "./file-service";
import { limitedBytes } from "./storage";
import {
  nonceSchema,
  profileSchema,
  projectSchema,
  scopeSchema,
  uint256Schema,
  verifySchema,
} from "./validation";

export type Endpoint =
  | "nonce"
  | "verify"
  | "session"
  | "logout"
  | "profile"
  | "project"
  | "files"
  | "file"
  | "fileAssociate"
  | "fileVerify"
  | "milestone";
const targetSchema = scopeSchema.extend({
  projectId: uint256Schema,
  milestoneIndex: z.coerce.number().int().min(0).max(4),
  disputeId: uint256Schema.optional(),
});
const uploadSchema = targetSchema.extend({
  category: z.enum(["deliverable", "opening", "response", "evidence"]),
});
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
  files?: () => FileService;
}) {
  return async (
    endpoint: Endpoint,
    request: Request,
    projectId?: string,
    milestoneIndex?: string,
  ) => {
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
        endpoint === "files"
          ? ["GET", "POST"]
          : endpoint === "file"
            ? ["GET", "DELETE"]
            : endpoint === "fileAssociate"
              ? ["POST"]
              : endpoint === "milestone" || endpoint === "fileVerify"
                ? ["GET"]
                : endpoint === "profile"
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
      if (["files", "file", "fileAssociate", "fileVerify"].includes(endpoint)) {
        if (!options.files)
          throw new ApiError(
            503,
            "storage_setup",
            "Private storage is not configured.",
          );
        const files = options.files();
        const params = Object.fromEntries(new URL(request.url).searchParams);
        if (endpoint === "files") {
          if (method === "GET")
            return reply({
              maxBytes: files.storage.maxBytes,
              files: await files.list(
                session.address,
                targetSchema.parse(params),
              ),
            });
          const input = uploadSchema.parse(params);
          const key = z
            .string()
            .uuid()
            .parse(request.headers.get("idempotency-key"));
          const hash = z
            .string()
            .regex(/^0x[0-9a-f]{64}$/)
            .parse(request.headers.get("x-content-sha256"));
          let filename = "";
          try {
            filename = decodeURIComponent(
              request.headers.get("x-file-name") ?? "",
            );
          } catch {
            throw new ApiError(400, "filename", "Invalid filename encoding.");
          }
          if (!filename || filename.length > 500)
            throw new ApiError(
              400,
              "filename",
              "A bounded filename is required.",
            );
          // Validate session, identifiers, and role before accepting a body.
          const authority = await files.context(input);
          if (
            session.address !== authority.client &&
            session.address !== authority.freelancer
          )
            throw new ApiError(
              403,
              "file_role",
              "Only project participants may upload.",
            );
          const bytes = await limitedBytes(
            request.body,
            files.storage.maxBytes,
          );
          return reply({
            file: await files.upload(
              session.address,
              input,
              input.category,
              key,
              filename,
              request.headers.get("content-type") ?? "",
              bytes,
              hash,
            ),
          });
        }
        const id = z.string().uuid().parse(projectId);
        const scope = scopeSchema.parse(params);
        if (endpoint === "fileVerify") {
          const result = await files.download(session.address, scope, id, true);
          return reply({
            file: result.file,
            integrityVerified: true,
            algorithm: "SHA-256",
          });
        }
        if (endpoint === "fileAssociate") {
          const input = z
            .object({
              transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
              disputeId: uint256Schema.optional(),
            })
            .strict()
            .parse(await body(request));
          return reply({
            file: await files.associate(
              session.address,
              scope,
              id,
              input.transactionHash.toLowerCase() as `0x${string}`,
              input.disputeId,
            ),
          });
        }
        if (method === "DELETE")
          return reply(await files.remove(session.address, scope, id));
        const result = await files.download(session.address, scope, id);
        headers.set("Content-Type", "application/octet-stream");
        headers.set(
          "Content-Disposition",
          `attachment; filename="${result.file.filename.replace(/"/g, "_")}"`,
        );
        headers.set("Content-Length", String(result.bytes!.length));
        headers.set("X-Content-SHA256", result.file.content_hash);
        headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
        return new Response(Buffer.from(result.bytes!), { headers });
      }
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
      if (endpoint === "milestone") {
        const index = z.coerce
          .number()
          .int()
          .min(0)
          .max(4)
          .parse(milestoneIndex);
        await service.chain.milestone(scope, id, index, session.address);
        const project = await service.project(session.address, scope, id);
        const milestone = project.milestones.find(
          (m) => m.onchain_index === index,
        );
        if (!milestone)
          throw new ApiError(
            404,
            "metadata_missing",
            "Milestone metadata has not been saved.",
          );
        return reply({ milestone });
      }
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
