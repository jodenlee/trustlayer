import { createHash, randomBytes } from "node:crypto";
import { getAddress, verifyMessage, type Hex } from "viem";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";
import type { Database } from "./db";
import type { ChainAuthority } from "./chain";
import { ApiError } from "./errors";
import type { MetadataScope, ProjectMetadataInput } from "./validation";

export const NONCE_SECONDS = 300;
export const SESSION_SECONDS = 8 * 3600;
export const digest = (v: string) =>
  createHash("sha256").update(v).digest("hex");
const token = () => randomBytes(32).toString("hex");
export interface AuthSession {
  address: string;
  chainId: 31337;
  expiresAt: string;
}
export interface Profile {
  wallet_address: string;
  display_name: string;
  biography: string;
  created_at: Date;
  updated_at: Date;
}
export interface ProjectRecord extends Record<string, unknown> {
  id: string;
  deployment_id: string;
  title: string;
  description: string;
  onchain_project_id: string;
  client_wallet: string;
  freelancer_wallet: string;
  revision: number;
}
export interface MilestoneRecord extends Record<string, unknown> {
  id: string;
  onchain_index: number;
  description: string;
  name: string;
}
export class BackendService {
  constructor(
    readonly db: Database,
    readonly origin: string,
    readonly chain: ChainAuthority,
    readonly now: () => Date = () => new Date(),
  ) {}

  async rate(key: string, limit: number) {
    const now = this.now();
    const since = new Date(now.getTime() - 5 * 60_000);
    const result = await this.db.query<{ hits: number }>(
      `INSERT INTO trustlayer.auth_rate_limits (bucket,window_start,hits) VALUES ($1,$2,1)
      ON CONFLICT (bucket) DO UPDATE SET hits = CASE WHEN auth_rate_limits.window_start <= $3 THEN 1 ELSE auth_rate_limits.hits+1 END,
      window_start = CASE WHEN auth_rate_limits.window_start <= $3 THEN $2 ELSE auth_rate_limits.window_start END RETURNING hits`,
      [digest(key), now, since],
    );
    if (result.rows[0].hits > limit)
      throw new ApiError(
        429,
        "rate_limited",
        "Too many authentication requests. Retry in five minutes.",
      );
  }
  async nonce(address: string, previousChallenge?: string) {
    await this.rate("nonce:global", 300);
    await this.rate(`nonce:${address}`, 10);
    const challenge = token();
    const nonce = token();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + NONCE_SECONDS * 1000);
    const message = createSiweMessage({
      address: getAddress(address),
      chainId: 31337,
      domain: new URL(this.origin).host,
      uri: this.origin,
      version: "1",
      nonce,
      issuedAt: now,
      expirationTime: expiresAt,
      statement:
        "Sign in to TrustLayer. This does not authorize a blockchain transaction.",
    });
    await this.db.transaction(async (sql) => {
      if (previousChallenge)
        await sql.query(
          "DELETE FROM trustlayer.auth_nonces WHERE challenge_hash=$1",
          [digest(previousChallenge)],
        );
      await sql.query(
        "INSERT INTO trustlayer.auth_nonces (challenge_hash,nonce_hash,wallet_address,message,issued_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [digest(challenge), digest(nonce), address, message, now, expiresAt],
      );
    });
    return { challenge, message, expiresAt: expiresAt.toISOString() };
  }
  async verify(
    message: string,
    signature: Hex,
    challenge: string | undefined,
    previousSession?: string,
  ) {
    await this.rate("verify:global", 600);
    if (!challenge || !/^[0-9a-f]{64}$/.test(challenge))
      throw new ApiError(
        401,
        "invalid_challenge",
        "Request a new sign-in message.",
      );
    await this.rate(`verify:${challenge}`, 10);
    const result = await this.db.query<{
      wallet_address: string;
      message: string;
      issued_at: Date;
      expires_at: Date;
      consumed_at: Date | null;
    }>(
      "SELECT wallet_address,message,issued_at,expires_at,consumed_at FROM trustlayer.auth_nonces WHERE challenge_hash=$1",
      [digest(challenge)],
    );
    const row = result.rows[0];
    const now = this.now();
    if (!row || row.consumed_at || new Date(row.expires_at) <= now)
      throw new ApiError(
        401,
        "expired_nonce",
        "Sign-in message expired or already used. Request a new one.",
      );
    // Compare the exact server-generated message as well as all SIWE fields.
    const fields = parseSiweMessage(message);
    if (
      message !== row.message ||
      fields.version !== "1" ||
      fields.domain !== new URL(this.origin).host ||
      fields.uri !== this.origin ||
      fields.chainId !== 31337 ||
      fields.address?.toLowerCase() !== row.wallet_address ||
      !fields.nonce ||
      !fields.issuedAt ||
      !fields.expirationTime ||
      fields.issuedAt.getTime() !== new Date(row.issued_at).getTime() ||
      fields.expirationTime.getTime() !== new Date(row.expires_at).getTime() ||
      fields.issuedAt > now ||
      fields.expirationTime <= now
    )
      throw new ApiError(
        401,
        "invalid_message",
        "The sign-in message does not match this wallet, origin, chain or challenge.",
      );
    let valid = false;
    try {
      valid = await verifyMessage({
        address: getAddress(row.wallet_address),
        message,
        signature,
      });
    } catch {
      /* Invalid signatures are deliberately reported without internals. */
    }
    if (!valid)
      throw new ApiError(
        401,
        "invalid_signature",
        "The wallet signature is invalid.",
      );
    const sessionToken = token();
    const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000);
    await this.db.transaction(async (sql) => {
      const used = await sql.query(
        "UPDATE trustlayer.auth_nonces SET consumed_at=$2 WHERE challenge_hash=$1 AND nonce_hash=$3 AND consumed_at IS NULL AND expires_at>$2 RETURNING challenge_hash",
        [digest(challenge), now, digest(fields.nonce!)],
      );
      if (used.rows.length !== 1)
        throw new ApiError(
          401,
          "replayed_nonce",
          "This sign-in message has already been used.",
        );
      await sql.query(
        "INSERT INTO trustlayer.profiles (wallet_address) VALUES ($1) ON CONFLICT DO NOTHING",
        [row.wallet_address],
      );
      if (previousSession)
        await sql.query(
          "DELETE FROM trustlayer.auth_sessions WHERE token_hash=$1",
          [digest(previousSession)],
        );
      await sql.query(
        "INSERT INTO trustlayer.auth_sessions (token_hash,wallet_address,chain_id,created_at,expires_at) VALUES ($1,$2,31337,$3,$4)",
        [digest(sessionToken), row.wallet_address, now, expiresAt],
      );
    });
    return {
      token: sessionToken,
      session: {
        address: row.wallet_address,
        chainId: 31337 as const,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }
  async session(sessionToken?: string): Promise<AuthSession | null> {
    if (!sessionToken || !/^[0-9a-f]{64}$/.test(sessionToken)) return null;
    const result = await this.db.query<{
      wallet_address: string;
      chain_id: number | string;
      expires_at: Date;
    }>(
      "SELECT wallet_address,chain_id,expires_at FROM trustlayer.auth_sessions WHERE token_hash=$1 AND expires_at>$2",
      [digest(sessionToken), this.now()],
    );
    const row = result.rows[0];
    return row && Number(row.chain_id) === 31337
      ? {
          address: row.wallet_address,
          chainId: 31337,
          expiresAt: new Date(row.expires_at).toISOString(),
        }
      : null;
  }
  async logout(sessionToken?: string, challenge?: string) {
    await this.db.transaction(async (sql) => {
      if (sessionToken)
        await sql.query(
          "DELETE FROM trustlayer.auth_sessions WHERE token_hash=$1",
          [digest(sessionToken)],
        );
      if (challenge)
        await sql.query(
          "DELETE FROM trustlayer.auth_nonces WHERE challenge_hash=$1",
          [digest(challenge)],
        );
    });
  }
  async profile(wallet: string) {
    const { rows } = await this.db.query<Profile & Record<string, unknown>>(
      "SELECT * FROM trustlayer.profiles WHERE wallet_address=$1",
      [wallet],
    );
    if (!rows[0])
      throw new ApiError(404, "profile_missing", "Profile not found.");
    return rows[0];
  }
  async updateProfile(
    wallet: string,
    data: { displayName: string; biography: string },
  ) {
    await this.db.query(
      "UPDATE trustlayer.profiles SET display_name=$2,biography=$3 WHERE wallet_address=$1",
      [wallet, data.displayName, data.biography],
    );
    return this.profile(wallet);
  }
  async project(wallet: string, scope: MetadataScope, id: string) {
    await this.chain.project(scope, id, wallet);
    const { rows } = await this.db.query<ProjectRecord>(
      "SELECT p.* FROM trustlayer.projects p JOIN trustlayer.deployments d ON d.id=p.deployment_id WHERE d.chain_id=$1 AND d.escrow_address=$2 AND d.anchor_hash=$3 AND p.onchain_project_id=$4",
      [scope.chainId, scope.escrowAddress, scope.deploymentHash, id],
    );
    if (!rows[0])
      throw new ApiError(
        404,
        "metadata_missing",
        "No persistent metadata has been saved for this project.",
      );
    const milestones = await this.db.query<MilestoneRecord>(
      "SELECT id,onchain_index,name,description,metadata,created_at,updated_at FROM trustlayer.milestones WHERE project_id=$1 ORDER BY onchain_index",
      [rows[0].id],
    );
    return { ...rows[0], milestones: milestones.rows };
  }
  async saveProject(
    wallet: string,
    scope: MetadataScope,
    id: string,
    data: ProjectMetadataInput,
  ) {
    const authority = await this.chain.project(scope, id, wallet);
    if (data.milestones.some((m) => m.index >= authority.milestoneCount))
      throw new ApiError(
        400,
        "invalid_milestone",
        "Milestone index does not exist on-chain.",
      );
    const m = authority.manifest;
    const syncHash = `0x${digest(JSON.stringify({ title: data.title, description: data.description, milestones: [...data.milestones].sort((a, b) => a.index - b.index) }))}`;
    await this.db.transaction(async (sql) => {
      const deployment = await sql.query(
        "INSERT INTO trustlayer.deployments (chain_id,escrow_address,arbitration_address,anchor_hash,anchor_number) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (chain_id,escrow_address,anchor_hash) DO UPDATE SET anchor_number=EXCLUDED.anchor_number RETURNING id",
        [
          m.chainId,
          scope.escrowAddress,
          m.contracts.DisputeArbitration.address.toLowerCase(),
          scope.deploymentHash,
          m.verifiedBlock.number,
        ],
      );
      await sql.query(
        "SELECT id FROM trustlayer.deployments WHERE id=$1 FOR UPDATE",
        [deployment.rows[0].id],
      );
      const existing = await sql.query(
        "SELECT sync_hash FROM trustlayer.projects WHERE deployment_id=$1 AND onchain_project_id=$2 FOR UPDATE",
        [deployment.rows[0].id, id],
      );
      if (existing.rows[0]?.sync_hash === syncHash) return;
      const project = await sql.query(
        "INSERT INTO trustlayer.projects (deployment_id,onchain_project_id,title,description,client_wallet,freelancer_wallet,sync_hash) VALUES ($1,$2,$3,$4,$5,$6,$8) ON CONFLICT (deployment_id,onchain_project_id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,client_wallet=EXCLUDED.client_wallet,freelancer_wallet=EXCLUDED.freelancer_wallet,sync_hash=EXCLUDED.sync_hash,revision=projects.revision+1 WHERE $7::integer IS NULL OR projects.revision=$7 RETURNING id",
        [
          deployment.rows[0].id,
          id,
          data.title,
          data.description,
          authority.client,
          authority.freelancer,
          data.expectedRevision ?? null,
          syncHash,
        ],
      );
      if (!project.rows[0])
        throw new ApiError(
          409,
          "metadata_changed",
          "Metadata changed since it was loaded. Refresh before saving.",
        );
      for (const milestone of data.milestones)
        await sql.query(
          "INSERT INTO trustlayer.milestones (project_id,onchain_index,description,name) VALUES ($1,$2,$3,COALESCE($4,'')) ON CONFLICT (project_id,onchain_index) DO UPDATE SET description=EXCLUDED.description,name=COALESCE($4,milestones.name)",
          [
            project.rows[0].id,
            milestone.index,
            milestone.description,
            milestone.name ?? null,
          ],
        );
    });
    return this.project(wallet, scope, id);
  }
}
