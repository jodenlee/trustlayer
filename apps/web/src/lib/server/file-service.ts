import { randomUUID } from "node:crypto";
import type { Hash } from "viem";
import type { BackendService } from "./service";
import type { MetadataScope } from "./validation";
import type { AttachmentContext } from "./chain";
import { ApiError } from "./errors";
import {
  sha256,
  safeFilename,
  validateFile,
  type PrivateStorage,
} from "./storage";
import type { FileCategory, FileRecord } from "../files";

export interface FileTarget extends MetadataScope {
  projectId: string;
  milestoneIndex: number;
  disputeId?: string;
}
interface StoredFile
  extends Record<string, unknown>, Omit<FileRecord, "created_at"> {
  deployment_id: string;
  bucket: string;
  object_path: string;
  idempotency_key: string;
  created_at: Date;
  updated_at: Date;
  anchor_hash: string;
  escrow_address: string;
  chain_id: string;
}
const publicFile = (r: StoredFile): FileRecord => ({
  id: r.id,
  category: r.category,
  filename: r.filename,
  media_type: r.media_type,
  byte_size: r.byte_size,
  content_hash: r.content_hash,
  status: r.status,
  uploader: r.uploader,
  project_id: String(r.project_id),
  milestone_index: r.milestone_index,
  dispute_id: r.dispute_id === null ? null : String(r.dispute_id),
  transaction_hash: r.transaction_hash,
  created_at: new Date(r.created_at).toISOString(),
});
const participant = (c: AttachmentContext, wallet: string) =>
  wallet === c.client || wallet === c.freelancer;
function mayUpload(
  c: AttachmentContext,
  wallet: string,
  category: FileCategory,
) {
  if (!participant(c, wallet))
    throw new ApiError(
      403,
      "file_role",
      "Only the project participants may upload files.",
    );
  if (category === "deliverable") {
    if (wallet !== c.freelancer)
      throw new ApiError(
        403,
        "file_role",
        "Only the freelancer may upload deliverables.",
      );
    if (
      c.projectState !== 2 ||
      c.currentIndex !== c.index ||
      c.milestone.state !== 0 ||
      c.now > c.milestone.dueAt + 48n * 3600n
    )
      throw new ApiError(
        409,
        "submission_window",
        "This milestone is not accepting a new deliverable.",
      );
  } else if (category === "opening") {
    if (
      c.dispute ||
      c.projectState !== 2 ||
      c.currentIndex !== c.index ||
      c.milestone.state !== 1 ||
      c.now > c.milestone.reviewEnd
    )
      throw new ApiError(
        409,
        "opening_window",
        "This milestone is not accepting opening evidence.",
      );
  } else {
    if (
      !c.dispute ||
      c.dispute.state !== 1 ||
      c.now >= c.dispute.responseDeadline
    )
      throw new ApiError(
        409,
        "evidence_deadline",
        "Case uploads close strictly at the on-chain response deadline.",
      );
    if (
      category === "response" &&
      (wallet === c.dispute.opener || !/^0x0{64}$/.test(c.dispute.responseHash))
    )
      throw new ApiError(
        403,
        "response_role",
        "Only the counterparty may prepare the single unrecorded response.",
      );
  }
}
function chainReferenced(row: StoredFile, c: AttachmentContext) {
  return row.category === "deliverable"
    ? c.milestone.hash === row.content_hash
    : row.category === "opening"
      ? c.dispute?.openingHash === row.content_hash
      : row.category === "response"
        ? c.dispute?.responseHash === row.content_hash
        : false;
}
export class FileService {
  constructor(
    readonly backend: BackendService,
    readonly storage: PrivateStorage,
  ) {}
  async context(target: FileTarget) {
    if (!this.backend.chain.filesContext)
      throw new ApiError(
        503,
        "file_authority",
        "File authority is unavailable.",
      );
    return this.backend.chain.filesContext(
      target,
      target.projectId,
      target.milestoneIndex,
      target.disputeId,
    );
  }
  async deployment(c: AttachmentContext) {
    const m = c.manifest;
    const { rows } = await this.backend.db.query<{ id: string }>(
      `INSERT INTO trustlayer.deployments(chain_id,escrow_address,arbitration_address,anchor_hash,anchor_number) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(chain_id,escrow_address,anchor_hash) DO UPDATE SET anchor_number=EXCLUDED.anchor_number RETURNING id`,
      [
        m.chainId,
        m.contracts.TrustEscrow.address.toLowerCase(),
        m.contracts.DisputeArbitration.address.toLowerCase(),
        m.verifiedBlock.hash.toLowerCase(),
        m.verifiedBlock.number,
      ],
    );
    return rows[0].id;
  }
  async row(id: string, scope: MetadataScope) {
    const { rows } = await this.backend.db.query<StoredFile>(
      "SELECT f.*,d.anchor_hash,d.escrow_address,d.chain_id FROM trustlayer.files f JOIN trustlayer.deployments d ON d.id=f.deployment_id WHERE f.id=$1",
      [id],
    );
    const r = rows[0];
    if (!r || r.status === "deleted")
      throw new ApiError(404, "file_missing", "File not found.");
    if (
      String(r.chain_id) !== scope.chainId ||
      r.escrow_address !== scope.escrowAddress ||
      r.anchor_hash !== scope.deploymentHash
    )
      throw new ApiError(
        409,
        "file_deployment",
        "File belongs to a different deployment.",
      );
    if (r.bucket !== this.storage.bucket)
      throw new ApiError(
        503,
        "storage_bucket",
        "File storage configuration changed; restore the configured private bucket.",
      );
    return r;
  }
  target(r: StoredFile, scope: MetadataScope): FileTarget {
    return {
      ...scope,
      projectId: String(r.project_id),
      milestoneIndex: r.milestone_index,
      ...(r.dispute_id !== null ? { disputeId: String(r.dispute_id) } : {}),
    };
  }
  canRead(r: StoredFile, c: AttachmentContext, wallet: string) {
    if (r.status === "ready" && r.uploader === wallet) return true;
    if (r.status !== "linked") return false;
    if (participant(c, wallet)) return true;
    return (
      !!c.dispute &&
      c.dispute.jurors.includes(wallet) &&
      (r.category === "deliverable" || String(r.dispute_id) === c.dispute.id)
    );
  }
  async upload(
    wallet: string,
    target: FileTarget,
    category: FileCategory,
    key: string,
    name: string,
    type: string,
    bytes: Uint8Array,
    expectedHash: string,
  ) {
    if (
      category === "deliverable" || category === "opening"
        ? target.disputeId !== undefined
        : target.disputeId === undefined
    )
      throw new ApiError(
        400,
        "file_target",
        "This file category requires the corresponding milestone or dispute target.",
      );
    validateFile(bytes, type, this.storage.maxBytes);
    const hash = sha256(bytes);
    if (hash !== expectedHash)
      throw new ApiError(
        422,
        "hash_mismatch",
        "The uploaded bytes do not match the reviewed SHA-256 hash.",
      );
    await this.backend.rate(`upload:${wallet}`, 40);
    const c = await this.context(target);
    if (!participant(c, wallet))
      throw new ApiError(
        403,
        "file_role",
        "Only project participants may upload.",
      );
    const deployment = await this.deployment(c);
    const id = randomUUID(),
      filename = safeFilename(name);
    const result = await this.backend.db.transaction(async (sql) => {
      // Serialize reservations briefly; never hold a DB lock during storage I/O.
      await sql.query(
        "SELECT id FROM trustlayer.deployments WHERE id=$1 FOR UPDATE",
        [deployment],
      );
      const existing = (
        await sql.query<StoredFile>(
          "SELECT * FROM trustlayer.files WHERE uploader=$1 AND idempotency_key=$2 FOR UPDATE",
          [wallet, key],
        )
      ).rows[0];
      if (existing) {
        if (
          existing.deployment_id !== deployment ||
          String(existing.project_id) !== target.projectId ||
          existing.milestone_index !== target.milestoneIndex ||
          existing.category !== category ||
          (String(existing.dispute_id ?? "") !==
            String(target.disputeId ?? "") &&
            !(
              category === "opening" &&
              existing.status === "linked" &&
              target.disputeId === undefined
            )) ||
          existing.content_hash !== hash ||
          existing.filename !== filename ||
          existing.media_type !== type
        )
          throw new ApiError(
            409,
            "upload_key",
            "This upload key is already bound to different bytes or identifiers.",
          );
        if (existing.status === "ready" || existing.status === "linked")
          return { row: existing, done: true };
        mayUpload(c, wallet, category);
        const claimed = await sql.query<StoredFile>(
          "UPDATE trustlayer.files SET status='uploading' WHERE id=$1 AND (status='failed' OR (status='uploading' AND updated_at<now()-interval '5 minutes')) RETURNING *",
          [existing.id],
        );
        if (!claimed.rows[0])
          throw new ApiError(
            409,
            "upload_in_progress",
            "This upload is in progress or unavailable. Reuse the same key after checking its status.",
          );
        return { row: claimed.rows[0], done: false };
      }
      mayUpload(c, wallet, category);
      const count = (
        await sql.query<{ n: number }>(
          "SELECT count(*)::int n FROM trustlayer.files WHERE deployment_id=$1 AND project_id=$2 AND milestone_index=$3 AND uploader=$4 AND status<>'deleted'",
          [deployment, target.projectId, target.milestoneIndex, wallet],
        )
      ).rows[0].n;
      if (count >= 20)
        throw new ApiError(
          429,
          "file_limit",
          "Your wallet has reached its 20-file limit for this milestone. The counterparty has a separate allowance; uploaded bytes are retained.",
        );
      const inserted = await sql.query<StoredFile>(
        `INSERT INTO trustlayer.files(id,deployment_id,project_id,milestone_index,dispute_id,category,uploader,idempotency_key,filename,media_type,byte_size,content_hash,bucket,object_path,status,accepted_chain_time)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'uploading',$15) RETURNING *`,
        [
          id,
          deployment,
          target.projectId,
          target.milestoneIndex,
          target.disputeId ?? null,
          category,
          wallet,
          key,
          filename,
          type,
          bytes.length,
          hash,
          this.storage.bucket,
          `v1/${deployment}/${id}`,
          String(c.now),
        ],
      );
      return { row: inserted.rows[0], done: false };
    });
    if (result.done) return publicFile(result.row);
    const r = result.row;
    try {
      const found = await this.storage.get(r.object_path);
      if (found) {
        if (sha256(found) !== hash || found.length !== bytes.length)
          throw new ApiError(
            422,
            "stored_hash_mismatch",
            "An existing immutable storage object failed integrity verification.",
          );
      } else await this.storage.put(r.object_path, bytes, type);
      // Storage acknowledgement is followed by a fresh role/deadline check.
      const fresh = await this.context(target);
      mayUpload(fresh, wallet, category);
      const saved = await this.backend.db.query<StoredFile>(
        "UPDATE trustlayer.files SET status=$2,accepted_chain_time=$3 WHERE id=$1 AND status='uploading' RETURNING *",
        [r.id, category === "evidence" ? "linked" : "ready", String(fresh.now)],
      );
      if (!saved.rows[0])
        throw new ApiError(
          409,
          "upload_state",
          "Upload state changed; inspect the saved file before retrying.",
        );
      return publicFile(saved.rows[0]);
    } catch (error) {
      // The object remains tracked, including after an uncertain storage response.
      // Never delete bytes automatically: their hash may already be on-chain.
      try {
        await this.backend.db.query(
          "UPDATE trustlayer.files SET status='failed' WHERE id=$1 AND status='uploading'",
          [r.id],
        );
      } catch {
        /* Preserve original error. */
      }
      throw error;
    }
  }
  async list(wallet: string, target: FileTarget) {
    const c = await this.context(target);
    if (!participant(c, wallet) && !c.dispute?.jurors.includes(wallet))
      throw new ApiError(
        403,
        "file_access",
        "This wallet cannot access these files.",
      );
    const m = c.manifest;
    const { rows } = await this.backend.db.query<StoredFile>(
      `SELECT f.* FROM trustlayer.files f JOIN trustlayer.deployments d ON d.id=f.deployment_id
      WHERE d.chain_id=$1 AND d.escrow_address=$2 AND d.anchor_hash=$3 AND f.project_id=$4 AND f.milestone_index=$5 AND f.status<>'deleted' ORDER BY f.created_at DESC LIMIT 50`,
      [
        m.chainId,
        m.contracts.TrustEscrow.address.toLowerCase(),
        m.verifiedBlock.hash.toLowerCase(),
        target.projectId,
        target.milestoneIndex,
      ],
    );
    return rows
      .filter((r) => r.uploader === wallet || this.canRead(r, c, wallet))
      .map(publicFile);
  }
  async download(
    wallet: string,
    scope: MetadataScope,
    id: string,
    verifyOnly = false,
  ) {
    const r = await this.row(id, scope),
      c = await this.context(this.target(r, scope));
    if (!this.canRead(r, c, wallet))
      throw new ApiError(
        403,
        "file_access",
        "This wallet cannot retrieve the file.",
      );
    const bytes = await this.storage.get(r.object_path);
    const ok =
      !!bytes &&
      bytes.length === r.byte_size &&
      sha256(bytes) === r.content_hash;
    await this.backend.db.query(
      "INSERT INTO trustlayer.file_access(file_id,wallet_address,integrity_verified) VALUES($1,$2,$3)",
      [id, wallet, ok],
    );
    if (!ok)
      throw new ApiError(
        422,
        "integrity_mismatch",
        "Private file bytes failed SHA-256 verification. No file was returned.",
      );
    return { file: publicFile(r), bytes: verifyOnly ? undefined : bytes! };
  }
  async associate(
    wallet: string,
    scope: MetadataScope,
    id: string,
    transaction: Hash,
    disputeId?: string,
  ) {
    const r = await this.row(id, scope);
    if (r.uploader !== wallet)
      throw new ApiError(
        403,
        "file_owner",
        "Only the uploader may synchronize this file.",
      );
    if (r.status === "linked") {
      if (r.transaction_hash === transaction) {
        await this.context(this.target(r, scope));
        return publicFile(r);
      }
      throw new ApiError(
        409,
        "already_linked",
        "This file is already linked and immutable.",
      );
    }
    if (
      r.category === "evidence" ||
      !["ready", "failed", "uploading"].includes(r.status)
    )
      throw new ApiError(
        409,
        "link_state",
        "This file cannot be linked to a blockchain reference.",
      );
    const target = {
      ...this.target(r, scope),
      ...(disputeId !== undefined ? { disputeId } : {}),
    };
    const c = await this.context(target);
    if (!chainReferenced(r, c))
      throw new ApiError(
        409,
        "chain_hash",
        "The on-chain reference does not match this file.",
      );
    if (
      (r.category === "deliverable" && wallet !== c.freelancer) ||
      (r.category === "opening" && wallet !== c.dispute?.opener) ||
      (r.category === "response" &&
        (!participant(c, wallet) || wallet === c.dispute?.opener))
    )
      throw new ApiError(
        403,
        "link_actor",
        "The on-chain reference belongs to another actor.",
      );
    if (!this.backend.chain.fileProof)
      throw new ApiError(
        503,
        "file_proof",
        "Receipt validation is unavailable.",
      );
    const block = await this.backend.chain.fileProof(
      scope,
      c,
      r.category,
      r.content_hash,
      wallet,
      transaction,
    );
    const stored = await this.storage.get(r.object_path);
    if (
      !stored ||
      sha256(stored) !== r.content_hash ||
      stored.length !== r.byte_size
    )
      throw new ApiError(
        422,
        "integrity_mismatch",
        "The uploaded file must pass integrity verification before association.",
      );
    return this.backend.db.transaction(async (sql) => {
      const old = (
        await sql.query<StoredFile>(
          "SELECT * FROM trustlayer.files WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (old.status === "linked") {
        if (old.transaction_hash === transaction) return publicFile(old);
        throw new ApiError(409, "already_linked", "File already linked.");
      }
      if (!["ready", "failed", "uploading"].includes(old.status))
        throw new ApiError(
          409,
          "link_state",
          "The file reservation is unavailable for association.",
        );
      const other = await sql.query(
        "SELECT id FROM trustlayer.files WHERE deployment_id=$1 AND project_id=$2 AND milestone_index=$3 AND category=$4 AND status='linked' AND COALESCE(dispute_id,-1)=COALESCE($5::numeric,-1)",
        [
          r.deployment_id,
          String(r.project_id),
          r.milestone_index,
          r.category,
          r.category === "deliverable" ? null : c.dispute?.id,
        ],
      );
      if (other.rows.length)
        throw new ApiError(
          409,
          "duplicate_reference",
          "Another file is already associated with this on-chain reference.",
        );
      try {
        const saved = await sql.query<StoredFile>(
          "UPDATE trustlayer.files SET status='linked',transaction_hash=$2,confirmed_block=$3,dispute_id=$4 WHERE id=$1 RETURNING *",
          [
            id,
            transaction,
            String(block),
            r.category === "deliverable" ? null : c.dispute!.id,
          ],
        );
        return publicFile(saved.rows[0]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505")
          throw new ApiError(
            409,
            "duplicate_reference",
            "Another file is already associated.",
          );
        throw error;
      }
    });
  }
  async remove(wallet: string, scope: MetadataScope, id: string) {
    const r = await this.row(id, scope),
      c = await this.context(this.target(r, scope));
    if (r.uploader !== wallet)
      throw new ApiError(
        403,
        "file_owner",
        "Only the uploader may remove an unlinked draft.",
      );
    if (r.status === "linked" || chainReferenced(r, c))
      throw new ApiError(
        409,
        "evidence_retained",
        "Confirmed or chain-referenced evidence is retained and cannot be deleted.",
      );
    // A ready hash may be in a pending wallet transaction that the server cannot
    // observe. Retain all actual objects rather than racing an association or
    // removing bytes that may become an immutable on-chain reference.
    if (r.status !== "failed")
      throw new ApiError(
        409,
        "draft_retained",
        "Uploaded bytes are retained, including unlinked drafts. Only failed reservations with no stored object can be removed.",
      );
    const claimed = await this.backend.db.query(
      "UPDATE trustlayer.files SET status='deleting' WHERE id=$1 AND status='failed' RETURNING id",
      [id],
    );
    if (!claimed.rows[0])
      throw new ApiError(
        409,
        "delete_state",
        "The file is unavailable for deletion.",
      );
    try {
      if (await this.storage.get(r.object_path))
        throw new ApiError(
          409,
          "draft_retained",
          "Uploaded bytes are retained, including unlinked drafts.",
        );
    } catch (error) {
      await this.backend.db.query(
        "UPDATE trustlayer.files SET status='failed' WHERE id=$1 AND status='deleting'",
        [id],
      );
      throw error;
    }
    await this.backend.db.query(
      "UPDATE trustlayer.files SET status='deleted' WHERE id=$1 AND status='deleting'",
      [id],
    );
    return { deleted: true };
  }
}
