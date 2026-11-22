/**
 * Read-only startup check used by `npm run dev` after a chain restore:
 * PostgreSQL must not reference projects, disputes or receipts that the
 * restored chain does not contain. Prints exactly one JSON line on stdout.
 * Never writes to the database and never prints connection values.
 */
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { createPublicClient, http, type Hex } from "viem";
import { abis, parseLocalDeployment } from "@trustlayer/contracts";
import { databaseConfig } from "../src/lib/server/config";

type Result =
  | { status: "unconfigured" }
  | { status: "unreachable"; message: string }
  | { status: "no-records" }
  | {
      status: "checked";
      maxProjectId?: string;
      maxDisputeId?: string;
      maxConfirmedBlock?: string;
      receipts: {
        hash: string;
        block?: string;
        found: boolean;
        foundBlock?: string;
      }[];
      chain: { nextProjectId: string; nextDisputeId: string; head: string };
      rows: { projects: number; files: number };
    };
function finish(result: Result) {
  console.log(JSON.stringify(result));
}
const manifest = parseLocalDeployment(
  JSON.parse(await readFile(process.argv[2], "utf8")),
);
if (!process.env.DATABASE_URL) {
  finish({ status: "unconfigured" });
} else {
  const pool = new Pool({ ...databaseConfig(), max: 1 });
  pool.on("error", () => undefined);
  try {
    const db = await pool.connect();
    try {
      await db.query("BEGIN READ ONLY");
      const deployment = await db.query<{ id: string }>(
        `SELECT id FROM trustlayer.deployments
          WHERE chain_id = $1 AND lower(escrow_address) = lower($2) AND lower(anchor_hash) = lower($3)`,
        [
          manifest.chainId,
          manifest.contracts.TrustEscrow.address,
          manifest.verifiedBlock.hash,
        ],
      );
      if (!deployment.rows.length) {
        await db.query("ROLLBACK");
        finish({ status: "no-records" });
      } else {
        const id = deployment.rows[0].id;
        const scalar = async (sql: string) =>
          (await db.query<{ v: string | null }>(sql, [id])).rows[0]?.v ??
          undefined;
        const maxProject = [
          await scalar(
            "SELECT max(onchain_project_id)::text AS v FROM trustlayer.projects WHERE deployment_id = $1",
          ),
          await scalar(
            "SELECT max(project_id)::text AS v FROM trustlayer.files WHERE deployment_id = $1",
          ),
        ].filter((v): v is string => v !== undefined);
        const maxDispute = [
          await scalar(
            "SELECT max(onchain_dispute_id)::text AS v FROM trustlayer.disputes WHERE deployment_id = $1",
          ),
          await scalar(
            "SELECT max(dispute_id)::text AS v FROM trustlayer.files WHERE deployment_id = $1",
          ),
        ].filter((v): v is string => v !== undefined);
        const maxConfirmedBlock = await scalar(
          "SELECT max(confirmed_block)::text AS v FROM trustlayer.files WHERE deployment_id = $1",
        );
        const receipts = (
          await db.query<{ hash: string; block: string | null }>(
            `SELECT transaction_hash AS hash, confirmed_block::text AS block
               FROM trustlayer.files
              WHERE deployment_id = $1 AND transaction_hash IS NOT NULL
              ORDER BY confirmed_block DESC NULLS LAST
              LIMIT 50`,
            [id],
          )
        ).rows;
        const counts = (
          await db.query<{ projects: number; files: number }>(
            `SELECT (SELECT count(*)::int FROM trustlayer.projects WHERE deployment_id = $1) AS projects,
                    (SELECT count(*)::int FROM trustlayer.files WHERE deployment_id = $1) AS files`,
            [id],
          )
        ).rows[0];
        await db.query("ROLLBACK");
        const client = createPublicClient({
          transport: http("http://127.0.0.1:8545", {
            retryCount: 0,
            timeout: 10_000,
          }),
        });
        const [nextProjectId, nextDisputeId, head] = await Promise.all([
          client.readContract({
            address: manifest.contracts.TrustEscrow.address,
            abi: abis.TrustEscrow,
            functionName: "nextProjectId",
          }),
          client.readContract({
            address: manifest.contracts.DisputeArbitration.address,
            abi: abis.DisputeArbitration,
            functionName: "nextDisputeId",
          }),
          client.getBlockNumber({ cacheTime: 0 }),
        ]);
        const max = (values: string[]) =>
          values.length
            ? values
                .map(BigInt)
                .reduce((a, b) => (a > b ? a : b))
                .toString()
            : undefined;
        finish({
          status: "checked",
          maxProjectId: max(maxProject),
          maxDisputeId: max(maxDispute),
          maxConfirmedBlock: maxConfirmedBlock,
          receipts: await Promise.all(
            receipts.map(async (r) => {
              try {
                const receipt = await client.getTransactionReceipt({
                  hash: r.hash as Hex,
                });
                return {
                  hash: r.hash,
                  block: r.block ?? undefined,
                  found: true,
                  foundBlock: receipt.blockNumber.toString(),
                };
              } catch {
                return {
                  hash: r.hash,
                  block: r.block ?? undefined,
                  found: false,
                };
              }
            }),
          ),
          chain: {
            nextProjectId: nextProjectId.toString(),
            nextDisputeId: nextDisputeId.toString(),
            head: head.toString(),
          },
          rows: counts,
        });
      }
    } finally {
      db.release();
    }
  } catch (error) {
    finish({
      status: "unreachable",
      // Category only: driver messages can include host names.
      message:
        error instanceof Error && "code" in error
          ? `database error ${String((error as { code?: string }).code)}`
          : "database or chain read failed",
    });
  } finally {
    await pool.end();
  }
}
