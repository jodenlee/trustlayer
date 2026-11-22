import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { createPublicClient, http } from "viem";
import {
  validateManifest,
  verifyManifest,
  LOCAL_RPC_URL,
} from "../blockchain/deployment";
import { postgresDatabase } from "./db";
import { authOrigin, databaseConfig } from "./config";
import { chainAuthority } from "./chain";
import { BackendService } from "./service";
import { createApi } from "./api";
import { FileService } from "./file-service";
import { storageConfig, supabaseStorage } from "./storage";

let service: BackendService | undefined;
let files: FileService | undefined;
function backend() {
  if (!service) {
    const origin = authOrigin();
    const pool = new Pool(databaseConfig());
    pool.on("error", () =>
      console.error("TrustLayer idle database connection failed"),
    );
    const db = postgresDatabase(pool);
    const chain = chainAuthority(async () => {
      const manifest = validateManifest(
        JSON.parse(
          await readFile(
            path.join(process.cwd(), "public/deployments/31337.json"),
            "utf8",
          ),
        ),
      );
      const client = createPublicClient({
        transport: http(LOCAL_RPC_URL, { timeout: 5000, retryCount: 0 }),
      });
      await verifyManifest(client, manifest);
      return { manifest, client };
    });
    service = new BackendService(db, origin, chain);
  }
  return service;
}
export const handleApi = createApi({
  service: backend,
  origin: () => authOrigin(),
  secure: process.env.NODE_ENV === "production",
  configured: () => !!process.env.DATABASE_URL,
  files: () =>
    (files ??= new FileService(backend(), supabaseStorage(storageConfig()))),
});
