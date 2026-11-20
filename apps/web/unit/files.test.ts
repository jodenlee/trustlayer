import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { testDatabase } from "../test-support/database";
import { testStorage } from "../test-support/storage";
import { fixtureManifest } from "../test-support/protocol";
import { BackendService } from "../src/lib/server/service";
import { FileService, type FileTarget } from "../src/lib/server/file-service";
import type {
  AttachmentContext,
  ChainAuthority,
} from "../src/lib/server/chain";
import {
  sha256,
  safeFilename,
  validateFile,
  supabaseStorage,
  storageConfig,
} from "../src/lib/server/storage";
import { createApi } from "../src/lib/server/api";
import { syncConfirmedProject } from "../src/lib/metadata-client";

const client = privateKeyToAccount(generatePrivateKey()),
  worker = privateKeyToAccount(generatePrivateKey()),
  juror = privateKeyToAccount(generatePrivateKey());
const a = client.address.toLowerCase(),
  b = worker.address.toLowerCase(),
  j = juror.address.toLowerCase(),
  other = `0x${"f".repeat(40)}`;
const manifest = fixtureManifest(),
  scope = {
    chainId: "31337" as const,
    escrowAddress: manifest.contracts.TrustEscrow.address.toLowerCase(),
    deploymentHash: manifest.verifiedBlock.hash.toLowerCase(),
  };
const target: FileTarget = { ...scope, projectId: "0", milestoneIndex: 0 };
const text = new TextEncoder().encode("Exact private file bytes\n");
const tx = `0x${"a".repeat(64)}` as const,
  zero = `0x${"0".repeat(64)}`;
describe("Phase 4B private files and metadata", { concurrency: false }, () => {
  let fixture: Awaited<ReturnType<typeof testDatabase>>,
    store: ReturnType<typeof testStorage>,
    backend: BackendService,
    files: FileService,
    c: AttachmentContext,
    proofValid: boolean;
  before(async () => {
    fixture = await testDatabase();
  });
  after(async () => {
    await fixture?.pg.close();
  });
  beforeEach(async () => {
    await fixture.pg.exec(
      "RESET ROLE; TRUNCATE trustlayer.profiles,trustlayer.deployments,trustlayer.auth_nonces,trustlayer.auth_sessions,trustlayer.auth_rate_limits CASCADE; SET ROLE trustlayer_server",
    );
    store = testStorage();
    proofValid = true;
    c = {
      manifest,
      now: 1000n,
      projectId: "0",
      index: 0,
      client: a,
      freelancer: b,
      projectState: 2,
      currentIndex: 0,
      milestone: { state: 0, hash: zero, dueAt: 2000n, reviewEnd: 3000n },
    };
    const authority: ChainAuthority = {
      async project(s, id, wallet) {
        if (s.deploymentHash !== scope.deploymentHash)
          throw new Error("Deployment changed");
        if (id !== "0") throw new Error("Project missing");
        if (![a, b].includes(wallet)) throw new Error("Not a participant");
        return { manifest, client: a, freelancer: b, milestoneCount: 1 };
      },
      async milestone() {
        return { manifest, client: a, freelancer: b, milestoneCount: 1 };
      },
      async dispute() {
        return { projectId: "0", milestoneIndex: 0 };
      },
      async filesContext(s, id, index, caseId) {
        if (
          s.deploymentHash !== scope.deploymentHash ||
          s.escrowAddress !== scope.escrowAddress
        )
          throw new Error("Deployment changed");
        if (
          id !== "0" ||
          index !== 0 ||
          (caseId !== undefined && caseId !== c.dispute?.id)
        )
          throw new Error("Context mismatch");
        return structuredClone(c);
      },
      async fileProof() {
        if (!proofValid) throw new Error("Invalid receipt");
        return 10n;
      },
    };
    backend = new BackendService(
      fixture.db,
      "http://127.0.0.1:3001",
      authority,
    );
    files = new FileService(backend, store.storage);
  });
  function dispute() {
    c.milestone.state = 2;
    c.dispute = {
      id: "0",
      opener: a,
      jurors: [j],
      state: 1,
      responseDeadline: 2000n,
      openingHash: zero,
      responseHash: zero,
    };
    return { ...target, disputeId: "0" };
  }
  async function upload(
    category:
      "deliverable" | "opening" | "response" | "evidence" = "deliverable",
    wallet = b,
    t: FileTarget = target,
    key = randomUUID(),
    bytes = text,
  ) {
    return files.upload(
      wallet,
      t,
      category,
      key,
      "notes.txt",
      "text/plain",
      bytes,
      sha256(bytes),
    );
  }
  async function linkedDeliverable() {
    const f = await upload();
    c.milestone.hash = f.content_hash;
    c.milestone.state = 1;
    await files.associate(b, scope, f.id, tx);
    return f;
  }
  it("hashes exact bytes reproducibly as Solidity-compatible SHA-256", () => {
    assert.equal(
      sha256(new Uint8Array()),
      "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    assert.equal(sha256(text), sha256(Uint8Array.from(text)));
    assert.notEqual(
      sha256(text),
      sha256(new TextEncoder().encode("notes.txt")),
    );
    assert.match(sha256(text), /^0x[a-f0-9]{64}$/);
  });
  it("sanitizes malicious filenames without using names in object paths", async () => {
    const f = await files.upload(
      b,
      target,
      "deliverable",
      randomUUID(),
      "../../bad\\<script>.txt",
      "text/plain",
      text,
      sha256(text),
    );
    assert.equal(f.filename, "_script_.txt");
    assert.equal(safeFilename("\0../.."), "attachment");
    assert.equal(
      [...store.objects.keys()].some((p) => p.includes("script")),
      false,
    );
    assert.equal("object_path" in f, false);
    assert.equal("bucket" in f, false);
  });
  it("uploads privately and distinguishes upload from chain submission", async () => {
    const f = await upload();
    assert.equal(f.status, "ready");
    assert.equal(f.transaction_hash, null);
    assert.equal(c.milestone.hash, zero);
    assert.equal((await files.list(b, target)).length, 1);
    await assert.rejects(files.download(a, scope, f.id), /cannot retrieve/);
  });
  it("rejects unrelated uploads and client deliverable uploads", async () => {
    await assert.rejects(upload("deliverable", other), /participants/);
    await assert.rejects(upload("deliverable", a), /freelancer/);
    assert.equal(store.objects.size, 0);
  });
  for (const type of ["text/html", "image/svg+xml", "application/zip"])
    it(`rejects ${type}`, async () => {
      await assert.rejects(
        files.upload(
          b,
          target,
          "deliverable",
          randomUUID(),
          "bad.txt",
          type,
          text,
          sha256(text),
        ),
        /Supported files/,
      );
    });
  it("rejects empty, oversized, binary text and mismatched magic bytes", () => {
    assert.throws(() => validateFile(new Uint8Array(), "text/plain", 100));
    assert.throws(() => validateFile(text, "text/plain", 1));
    assert.throws(() => validateFile(text, "image/png", 1000));
    assert.throws(() =>
      validateFile(Uint8Array.from([255, 0]), "text/plain", 100),
    );
    assert.throws(() =>
      validateFile(
        new TextEncoder().encode("<script>x</script>"),
        "text/plain",
        100,
      ),
    );
  });
  it("validates supported PDF/PNG/JPEG file signatures", () => {
    validateFile(
      new TextEncoder().encode("%PDF-1.7\n"),
      "application/pdf",
      100,
    );
    validateFile(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/png",
      100,
    );
    validateFile(Uint8Array.from([255, 216, 255, 224]), "image/jpeg", 100);
  });
  it("rejects a client hash that differs from exact uploaded bytes", async () => {
    await assert.rejects(
      files.upload(
        b,
        target,
        "deliverable",
        randomUUID(),
        "notes.txt",
        "text/plain",
        text,
        zero,
      ),
      /do not match/,
    );
    assert.equal(store.objects.size, 0);
  });
  it("makes duplicate upload requests idempotent without overwriting bytes", async () => {
    const key = randomUUID();
    const first = await upload("deliverable", b, target, key),
      second = await upload("deliverable", b, target, key);
    assert.equal(first.id, second.id);
    assert.equal(store.objects.size, 1);
    await assert.rejects(
      upload(
        "deliverable",
        b,
        target,
        key,
        new TextEncoder().encode("changed"),
      ),
      /already bound/,
    );
  });
  it("reserves one writer for concurrent identical upload keys", async () => {
    const key = randomUUID();
    const outcomes = await Promise.allSettled([
      upload("deliverable", b, target, key),
      upload("deliverable", b, target, key),
    ]);
    const values = outcomes
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value.id);
    assert.equal(new Set(values).size, 1);
    assert.equal(store.objects.size, 1);
  });
  it("tracks storage failures and safely retries the same key", async () => {
    const key = randomUUID();
    store.fail();
    await assert.rejects(upload("deliverable", b, target, key));
    assert.equal(
      (await fixture.db.query("SELECT status FROM trustlayer.files")).rows[0]
        .status,
      "failed",
    );
    store.fail(false);
    const f = await upload("deliverable", b, target, key);
    assert.equal(f.status, "ready");
    assert.equal(store.objects.size, 1);
  });
  it("recovers stored bytes after metadata synchronization fails without uploading twice", async () => {
    const key = randomUUID(),
      query = fixture.db.query;
    let fail = true,
      puts = 0;
    const put = store.storage.put;
    store.storage.put = async (...args) => {
      puts++;
      await put(...args);
    };
    fixture.db.query = async <T extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) => {
      if (fail && sql.includes("SET status=$2,accepted_chain_time")) {
        fail = false;
        throw new Error("Isolated database failure");
      }
      return query<T>(sql, values);
    };
    try {
      await assert.rejects(
        upload("deliverable", b, target, key),
        /Isolated database failure/,
      );
      assert.equal(store.objects.size, 1);
      assert.equal(
        (await fixture.db.query("SELECT status FROM trustlayer.files")).rows[0]
          .status,
        "failed",
      );
      assert.equal(
        (await upload("deliverable", b, target, key)).status,
        "ready",
      );
      assert.equal(store.objects.size, 1);
      assert.equal(puts, 1);
    } finally {
      fixture.db.query = query;
    }
  });
  it("associates only the uploader and actual matching chain hash/receipt", async () => {
    const f = await upload();
    await assert.rejects(files.associate(a, scope, f.id, tx), /uploader/);
    await assert.rejects(
      files.associate(b, scope, f.id, tx),
      /on-chain reference/,
    );
    c.milestone.hash = f.content_hash;
    proofValid = false;
    await assert.rejects(
      files.associate(b, scope, f.id, tx),
      /Invalid receipt/,
    );
    proofValid = true;
    assert.equal((await files.associate(b, scope, f.id, tx)).status, "linked");
    assert.equal((await files.associate(b, scope, f.id, tx)).id, f.id);
  });
  it("rejects duplicate reference associations for different file records", async () => {
    const first = await linkedDeliverable();
    c.milestone.state = 0;
    c.milestone.hash = zero;
    const second = await upload();
    c.milestone.hash = first.content_hash;
    await assert.rejects(
      files.associate(b, scope, second.id, tx),
      /already associated/,
    );
  });
  it("permits the client to download a verified confirmed deliverable", async () => {
    const f = await linkedDeliverable();
    const result = await files.download(a, scope, f.id);
    assert.deepEqual(result.bytes, Uint8Array.from(text));
    assert.equal(
      (
        await fixture.db.query(
          "SELECT integrity_verified FROM trustlayer.file_access",
        )
      ).rows[0].integrity_verified,
      true,
    );
    await assert.rejects(files.download(other, scope, f.id), /cannot retrieve/);
  });
  it("detects retrieved content tampering and returns no bytes", async () => {
    const f = await linkedDeliverable();
    store.objects.set(
      [...store.objects.keys()][0],
      new TextEncoder().encode("tampered"),
    );
    await assert.rejects(
      files.download(a, scope, f.id),
      /SHA-256 verification/,
    );
    assert.equal(
      (
        await fixture.db.query(
          "SELECT integrity_verified FROM trustlayer.file_access",
        )
      ).rows[0].integrity_verified,
      false,
    );
  });
  it("prevents cross-project and cross-deployment access", async () => {
    const f = await upload();
    await assert.rejects(
      files.download(
        b,
        { ...scope, deploymentHash: `0x${"f".repeat(64)}` },
        f.id,
      ),
      /different deployment/,
    );
    await assert.rejects(
      files.list(b, { ...target, projectId: "1" }),
      /Context mismatch/,
    );
  });
  it("retains chain-referenced drafts even if association synchronization failed", async () => {
    const f = await upload();
    c.milestone.hash = f.content_hash;
    await assert.rejects(files.remove(b, scope, f.id), /cannot be deleted/);
    assert.equal(store.objects.size, 1);
  });
  it("retains uploaded drafts to avoid racing pending on-chain submissions", async () => {
    const f = await upload();
    await assert.rejects(files.remove(b, scope, f.id), /retained/);
    assert.equal(store.objects.size, 1);
  });
  it("allows removal of an empty failed reservation while retaining its audit record", async () => {
    store.fail();
    await assert.rejects(upload());
    store.fail(false);
    const f = (await files.list(b, target))[0];
    await files.remove(b, scope, f.id);
    assert.equal(
      (await fixture.db.query("SELECT status FROM trustlayer.files")).rows[0]
        .status,
      "deleted",
    );
    await assert.rejects(files.download(b, scope, f.id), /not found/);
  });
  it("rejects SQL edits/deletion of linked evidence", async () => {
    const f = await linkedDeliverable();
    await assert.rejects(
      fixture.db.query(
        "UPDATE trustlayer.files SET filename='changed' WHERE id=$1",
        [f.id],
      ),
      /Immutable/,
    );
    await assert.rejects(
      fixture.db.query("DELETE FROM trustlayer.files WHERE id=$1", [f.id]),
    );
  });
  it("checks upload deadlines again after storage completes", async () => {
    const t = dispute();
    const put = store.storage.put;
    store.storage.put = async (...args) => {
      await put(...args);
      c.now = c.dispute!.responseDeadline;
    };
    await assert.rejects(upload("evidence", a, t), /response deadline/);
    assert.equal(
      (await fixture.db.query("SELECT status FROM trustlayer.files")).rows[0]
        .status,
      "failed",
    );
  });
  it("reserves a separate file quota for each participant", async () => {
    const t = dispute();
    for (let i = 0; i < 20; i++) await upload("evidence", a, t);
    await assert.rejects(upload("evidence", a, t), /20-file limit/);
    assert.equal((await upload("evidence", b, t)).status, "linked");
  });
  it("rejects response/evidence uploads exactly at and after the response deadline", async () => {
    const t = dispute();
    for (const delta of [0n, 1n]) {
      c.now = 2000n + delta;
      await assert.rejects(upload("evidence", a, t), /response deadline/);
      await assert.rejects(upload("response", b, t), /response deadline/);
    }
  });
  it("permits response uploads only from the counterparty before its single hash is recorded", async () => {
    const t = dispute();
    await assert.rejects(upload("response", a, t), /counterparty/);
    await upload("response", b, t);
    c.dispute!.responseHash = tx;
    await assert.rejects(upload("response", b, t), /counterparty/);
  });
  it("exposes linked case evidence and deliverables only to relevant jurors and parties, including after closure", async () => {
    const deliverable = await linkedDeliverable(),
      t = dispute();
    const f = await upload("evidence", a, t);
    assert.equal(f.status, "linked");
    assert.equal((await files.list(j, t)).length, 2);
    await files.download(j, scope, f.id);
    await files.download(j, scope, deliverable.id);
    c.dispute!.state = 2;
    await files.download(j, scope, f.id);
    await assert.rejects(upload("evidence", a, t), /response deadline/);
    await assert.rejects(files.download(other, scope, f.id), /cannot retrieve/);
  });
  it("synchronizes opening and response references without inventing an evidence-update transaction", async () => {
    c.milestone.state = 1;
    const opening = await upload("opening", a);
    const t = dispute();
    c.dispute!.openingHash = opening.content_hash;
    assert.equal(
      (await files.associate(a, scope, opening.id, tx, "0")).dispute_id,
      "0",
    );
    const response = await upload("response", b, t);
    c.dispute!.responseHash = response.content_hash;
    assert.equal(
      (await files.associate(b, scope, response.id, tx, "0")).status,
      "linked",
    );
  });
  it("uses optimistic metadata revisions and stable identical upserts", async () => {
    const data = {
      title: "Title",
      description: "Description",
      milestones: [
        { index: 0, name: "Name", description: "Milestone details" },
      ],
    };
    const first = await backend.saveProject(a, scope, "0", data);
    const same = await backend.saveProject(a, scope, "0", data);
    assert.equal(first.id, same.id);
    assert.equal(first.revision, same.revision);
    await backend.saveProject(b, scope, "0", {
      ...data,
      title: "Changed",
      expectedRevision: Number(first.revision),
    });
    await assert.rejects(
      backend.saveProject(a, scope, "0", {
        ...data,
        title: "Stale",
        expectedRevision: Number(first.revision),
      }),
      /Metadata changed/,
    );
  });
  it("requires SIWE for file APIs and rejects path-manipulation input", async () => {
    const api = createApi({
      service: () => backend,
      origin: () => backend.origin,
      secure: false,
      files: () => files,
    });
    const request = new Request(
      `${backend.origin}/api/files?${new URLSearchParams({ ...scope, projectId: "0", milestoneIndex: "0" })}`,
    );
    assert.equal((await api("files", request)).status, 401);
    const nonce = await backend.nonce(b),
      login = await backend.verify(
        nonce.message,
        await worker.signMessage({ message: nonce.message }),
        nonce.challenge,
      );
    const bad = new Request(`${request.url}&object_path=../../other`, {
      headers: { cookie: `tl_session=${login.token}` },
    });
    assert.equal((await api("files", bad)).status, 400);
  });
  it("does not confuse a successful chain creation with metadata failure", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json(
        { error: { message: "Database unavailable" } },
        { status: 503 },
      );
    };
    try {
      const result = await syncConfirmedProject(manifest, 0n, {
        title: "Created",
        description: "Scope",
        milestones: [{ index: 0, description: "Delivery" }],
      });
      assert.equal(result.synced, false);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = original;
    }
  });
  it("verifies integrity through the authenticated API and rejects expired sessions", async () => {
    const f = await linkedDeliverable();
    const nonce = await backend.nonce(a),
      login = await backend.verify(
        nonce.message,
        await client.signMessage({ message: nonce.message }),
        nonce.challenge,
      );
    const api = createApi({
      service: () => backend,
      origin: () => backend.origin,
      secure: false,
      files: () => files,
    });
    const request = () =>
      new Request(
        `${backend.origin}/api/files/${f.id}/verify?${new URLSearchParams(scope)}`,
        { headers: { cookie: `tl_session=${login.token}` } },
      );
    const response = await api("fileVerify", request(), f.id);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).integrityVerified, true);
    await fixture.db.query(
      "UPDATE trustlayer.auth_sessions SET created_at=now()-interval '9 hours', expires_at=now()-interval '1 second'",
    );
    assert.equal((await api("fileVerify", request(), f.id)).status, 401);
  });
});

describe("Supabase private REST adapter", () => {
  const config = {
    url: "https://project.supabase.co",
    key: "TEST_SERVER_ONLY",
    bucket: "trustlayer-private",
    maxBytes: 1000,
  };
  const path = `v1/${randomUUID()}/${randomUUID()}`;
  it("recognizes the real hosted HTTP 400 / embedded 404 object-not-found envelope", async () => {
    const storage = supabaseStorage(config, async (input) =>
      String(input).includes("/bucket/")
        ? Response.json({ id: config.bucket, public: false })
        : Response.json(
            {
              statusCode: "404",
              error: "not_found",
              message: "Object not found",
            },
            { status: 400 },
          ),
    );
    assert.equal(await storage.get(path), null);
  });
  for (const status of [400, 401, 403, 500])
    it(`does not hide Storage HTTP ${status} authorization or invalid-request failures as absent objects`, async () => {
      const storage = supabaseStorage(config, async (input) =>
        String(input).includes("/bucket/")
          ? Response.json({ id: config.bucket, public: false })
          : Response.json(
              {
                statusCode: "403",
                error: "AccessDenied",
                message: "Access denied",
              },
              { status },
            ),
      );
      await assert.rejects(
        storage.get(path),
        /Private storage retrieval failed/,
      );
    });
  for (const status of [401, 403, 404])
    it(`fails closed before object access when the private bucket returns HTTP ${status}`, async () => {
      let calls = 0;
      const storage = supabaseStorage(config, async () => {
        calls++;
        return Response.json({}, { status });
      });
      await assert.rejects(
        storage.get(path),
        /Private bucket configuration could not be verified/,
      );
      assert.equal(calls, 1);
    });
  it("refuses public buckets before sending object requests", async () => {
    let requests = 0;
    const storage = supabaseStorage(config, async () => {
      requests++;
      return Response.json({ id: config.bucket, public: true });
    });
    await assert.rejects(
      storage.put(path, text, "text/plain"),
      /private bucket/,
    );
    assert.equal(requests, 1);
  });
  it("uses private authenticated paths, server-only credentials and no upsert", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const objects = new Map<string, Uint8Array>();
    const storage = supabaseStorage(config, async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/bucket/"))
        return Response.json({ id: config.bucket, public: false });
      if (init?.method === "POST") {
        objects.set(path, new Uint8Array(init.body as Buffer));
        return Response.json({});
      }
      if (init?.method === "DELETE") {
        objects.delete(path);
        return Response.json({});
      }
      return objects.has(path)
        ? new Response(Buffer.from(objects.get(path)!))
        : new Response(null, { status: 404 });
    });
    await storage.put(path, text, "text/plain");
    assert.deepEqual(await storage.get(path), Buffer.from(text));
    const post = calls.find((c) => c.init?.method === "POST")!;
    assert.equal(
      (post.init!.headers as Record<string, string>)["x-upsert"],
      "false",
    );
    assert.equal(
      (post.init!.headers as Record<string, string>).Authorization,
      `Bearer ${config.key}`,
    );
    assert.equal(
      calls.some((c) => c.url.includes("/object/public/")),
      false,
    );
    await storage.remove(path);
    assert.equal(await storage.get(path), null);
  });
  it("rejects traversal and invalid public/service configuration", async () => {
    const storage = supabaseStorage(config, async () => {
      throw new Error("must not call");
    });
    await assert.rejects(storage.get("../../secret"), /storage path/);
    assert.throws(() =>
      storageConfig({
        SUPABASE_URL: "http://example.com",
        SUPABASE_SERVICE_ROLE_KEY: "anon",
      }),
    );
  });
});
