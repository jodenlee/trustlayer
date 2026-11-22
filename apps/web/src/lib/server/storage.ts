import { createHash } from "node:crypto";
import { ApiError } from "./errors";
import { FILE_TYPES } from "../files";

export const sha256 = (bytes: Uint8Array) =>
  `0x${createHash("sha256").update(bytes).digest("hex")}`;
export function safeFilename(name: string) {
  return (
    Array.from(name.normalize("NFKC"))
      .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
      .join("")
      .split(/[/\\]/)
      .pop()!
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 120)
      .trim() || "attachment"
  );
}
export function validateFile(
  bytes: Uint8Array,
  mediaType: string,
  max: number,
) {
  if (!bytes.length || bytes.length > max)
    throw new ApiError(
      413,
      "file_size",
      "The file is empty or exceeds the configured upload limit.",
    );
  if (!FILE_TYPES.includes(mediaType as (typeof FILE_TYPES)[number]))
    throw new ApiError(
      415,
      "file_type",
      "Supported files: PDF, PNG, JPEG and UTF-8 plain text.",
    );
  const b = Buffer.from(bytes);
  const match =
    mediaType === "application/pdf"
      ? b.subarray(0, 5).toString() === "%PDF-"
      : mediaType === "image/png"
        ? b
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mediaType === "image/jpeg"
          ? b[0] === 255 && b[1] === 216 && b[2] === 255
          : (() => {
              try {
                const text = new TextDecoder("utf-8", { fatal: true }).decode(
                  bytes,
                );
                return (
                  !text.includes("\0") &&
                  !/<\s*(?:html|script|svg|iframe|!doctype)/i.test(text)
                );
              } catch {
                return false;
              }
            })();
  if (!match)
    throw new ApiError(
      415,
      "file_signature",
      "File bytes do not match the supported content type.",
    );
}
export async function limitedBytes(
  body: ReadableStream<Uint8Array> | null,
  max: number,
) {
  if (!body)
    throw new ApiError(400, "missing_file", "File bytes are required.");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new ApiError(
          413,
          "file_size",
          "File exceeds the configured limit.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export interface PrivateStorage {
  bucket: string;
  maxBytes: number;
  put(path: string, bytes: Uint8Array, type: string): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
  remove(path: string): Promise<void>;
}
export function storageConfig(
  env: Record<string, string | undefined> = process.env,
) {
  try {
    const url = new URL(env.SUPABASE_URL ?? "");
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".supabase.co") ||
      url.origin !== env.SUPABASE_URL ||
      url.username ||
      url.password
    )
      throw new Error();
    const key = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    // This adapter deliberately uses the documented legacy service_role JWT.
    if (
      JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString())
        .role !== "service_role"
    )
      throw new Error();
    const bucket = env.SUPABASE_STORAGE_BUCKET ?? "trustlayer-private";
    if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket)) throw new Error();
    const maxBytes = Number(env.UPLOAD_MAX_BYTES ?? 10 * 1024 * 1024);
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > 20 * 1024 * 1024
    )
      throw new Error();
    return { url: url.origin, key, bucket, maxBytes };
  } catch {
    throw new ApiError(
      503,
      "storage_setup",
      "Configure server-only SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, a private bucket and upload limits. See docs/PHASE4B.md.",
    );
  }
}
export function supabaseStorage(
  config: ReturnType<typeof storageConfig>,
  request: typeof fetch = fetch,
): PrivateStorage {
  const call = async (path: string, init: RequestInit = {}) => {
    try {
      return await request(`${config.url}/storage/v1/${path}`, {
        ...init,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${config.key}`,
          ...init.headers,
        },
      });
    } catch {
      throw new ApiError(
        503,
        "storage_unavailable",
        "Private storage is unavailable. Retry without resubmitting a blockchain transaction.",
      );
    }
  };
  const checked = async (path: string) => {
    if (!/^v1\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(path))
      throw new ApiError(400, "storage_path", "Invalid server storage path.");
    const response = await call(`bucket/${config.bucket}`);
    if (!response.ok)
      throw new ApiError(
        503,
        response.status === 401 || response.status === 403
          ? "storage_auth"
          : "storage_setup",
        `Private bucket configuration could not be verified (Storage HTTP ${response.status}). Check the server credentials and private bucket configuration.`,
      );
    const bucket = await response.json();
    if (bucket.id !== config.bucket || bucket.public !== false)
      throw new ApiError(
        503,
        "private_bucket_required",
        "Uploads and downloads require a verified private bucket.",
      );
  };
  return {
    bucket: config.bucket,
    maxBytes: config.maxBytes,
    async put(path, bytes, type) {
      await checked(path);
      const r = await call(`object/${config.bucket}/${path}`, {
        method: "POST",
        headers: { "Content-Type": type, "x-upsert": "false" },
        body: Buffer.from(bytes),
      });
      if (!r.ok)
        throw new ApiError(
          r.status === 409 ? 409 : 503,
          "storage_upload",
          "Storage did not confirm a new immutable upload. Retry using the same upload key.",
        );
    },
    async get(path) {
      await checked(path);
      const r = await call(`object/authenticated/${config.bucket}/${path}`);
      if (r.status === 404) return null;
      if (r.status === 400) {
        // Hosted Storage's legacy object-not-found envelope uses HTTP 400.
        // Do not treat arbitrary 400s or authorization errors as missing bytes.
        const body = await limitedBytes(r.body, 4096)
          .then((b) => JSON.parse(Buffer.from(b).toString()))
          .catch(() => null);
        if (
          String(body?.statusCode) === "404" &&
          body?.error === "not_found" &&
          body?.message === "Object not found"
        )
          return null;
      }
      if (!r.ok)
        throw new ApiError(
          503,
          "storage_download",
          "Private storage retrieval failed.",
        );
      return limitedBytes(r.body, 20 * 1024 * 1024);
    },
    async remove(path) {
      await checked(path);
      const r = await call(`object/${config.bucket}/${path}`, {
        method: "DELETE",
      });
      if (!r.ok && r.status !== 404)
        throw new ApiError(
          503,
          "storage_delete",
          "Storage deletion is unconfirmed; retry the same file.",
        );
    },
  };
}
