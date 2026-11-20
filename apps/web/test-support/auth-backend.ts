import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { BackendService } from "../src/lib/server/service";
import { createApi, type Endpoint } from "../src/lib/server/api";
import { FileService } from "../src/lib/server/file-service";
import type { PrivateStorage } from "../src/lib/server/storage";
import type { ChainAuthority } from "../src/lib/server/chain";
import { testDatabase } from "./database";

/** Test-only HTTP bridge: actual production SIWE/cookies/SQL, never hosted data. */
export async function authBackend(
  origin: string,
  options: { chain?: ChainAuthority; storage?: PrivateStorage } = {},
) {
  const database = await testDatabase();
  let offset = 0;
  let failure = false;
  let expectedOrigin = origin;
  let sessionReads = 0;
  let logouts = 0;
  let metadataFailure = false;
  const chain: ChainAuthority = {
    project: async () => {
      throw new Error("Unused by auth tests");
    },
    milestone: async () => {
      throw new Error("Unused by auth tests");
    },
    dispute: async () => {
      throw new Error("Unused by auth tests");
    },
  };
  const service = new BackendService(
    database.db,
    origin,
    options.chain ?? chain,
    () => new Date(Date.now() + offset),
  );
  const api = createApi({
    service: () => {
      if (failure) throw new Error("Test backend unavailable");
      return service;
    },
    origin: () => expectedOrigin,
    secure: false,
    files: options.storage
      ? () => new FileService(service, options.storage!)
      : undefined,
  });
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url!, origin).pathname;
    const parts = pathname.split("/");
    const endpoint =
      parts[2] === "projects"
        ? parts[4] === "milestones"
          ? "milestone"
          : "project"
        : parts[2] === "files"
          ? parts[4] === "associate"
            ? "fileAssociate"
            : parts[4] === "verify"
              ? "fileVerify"
              : parts[3]
                ? "file"
                : "files"
          : parts[parts.length - 1];
    if (
      ![
        "profile",
        "nonce",
        "verify",
        "session",
        "logout",
        "project",
        "milestone",
        "files",
        "file",
        "fileAssociate",
        "fileVerify",
      ].includes(endpoint ?? "")
    ) {
      res.writeHead(404).end();
      return;
    }
    if (metadataFailure && endpoint === "project" && req.method === "PUT") {
      res.writeHead(503, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          error: {
            code: "backend_unavailable",
            message: "Isolated metadata database unavailable",
          },
        }),
      );
      return;
    }
    if (endpoint === "session") sessionReads++;
    if (endpoint === "logout") logouts++;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (value !== undefined)
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    const request = new Request(`${origin}${req.url}`, {
      method: req.method,
      headers,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    });
    const response = await api(
      endpoint as Endpoint,
      request,
      parts[3],
      parts[5],
    );
    res.statusCode = response.status;
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") res.setHeader(name, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("Set-Cookie", cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    service,
    failMetadata: (value = true) => {
      metadataFailure = value;
    },
    reads: () => sessionReads,
    logouts: () => logouts,
    expire: () => {
      offset = 9 * 3600_000;
    },
    fail: (value = true) => {
      failure = value;
    },
    wrongOrigin: () => {
      expectedOrigin = origin.replace("127.0.0.1", "localhost");
    },
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await database.pg.close();
    },
  };
}
