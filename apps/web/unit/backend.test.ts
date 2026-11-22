import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PublicClient } from "viem";
import { testDatabase } from "../test-support/database";
import { fixtureManifest } from "../test-support/protocol";
import { chainAuthority } from "../src/lib/server/chain";
import { BackendService, digest } from "../src/lib/server/service";
import { createApi } from "../src/lib/server/api";
import { ApiError } from "../src/lib/server/errors";
import { databaseConfig, authOrigin } from "../src/lib/server/config";
import { nonceSchema, scopeSchema } from "../src/lib/server/validation";
import { sessionMatches } from "../src/lib/auth-client";

const a = privateKeyToAccount(generatePrivateKey());
const b = privateKeyToAccount(generatePrivateKey());
const outsider = privateKeyToAccount(generatePrivateKey());
const juror = privateKeyToAccount(generatePrivateKey());
const walletA = a.address.toLowerCase(),
  walletB = b.address.toLowerCase();
const manifest = fixtureManifest();
const scope = {
  chainId: "31337" as const,
  escrowAddress: manifest.contracts.TrustEscrow.address.toLowerCase(),
  deploymentHash: manifest.verifiedBlock.hash.toLowerCase(),
};
const origin = "http://127.0.0.1:3000";
const metadata = {
  title: "Test project",
  description: "Public scope",
  milestones: [{ index: 0, description: "First deliverable" }],
};
describe("Phase 4A PostgreSQL, SIWE and API", { concurrency: false }, () => {
  let fixture: Awaited<ReturnType<typeof testDatabase>>;
  let service: BackendService;
  let now: Date;
  let chainAvailable: boolean;
  let activeManifest = manifest;
  let api: ReturnType<typeof createApi>;
  const mockClient = {
    async getBlockNumber() {
      return 10n;
    },
    async readContract(input: { functionName: string; args?: bigint[] }) {
      if (
        input.functionName === "nextProjectId" ||
        input.functionName === "nextDisputeId"
      )
        return 2n;
      if (input.functionName === "projects")
        return [
          a.address,
          b.address,
          `0x${"1".repeat(64)}`,
          100n,
          100n,
          0n,
          100,
          0,
          2,
          2,
        ];
      if (input.functionName === "getDispute")
        return {
          projectId: 0n,
          milestoneIndex: 0n,
          client: a.address,
          freelancer: b.address,
          jurors: [juror.address],
        };
      throw new Error("Unexpected test read");
    },
  } as unknown as PublicClient;
  const authority = chainAuthority(async () => {
    if (!chainAvailable) throw new Error("RPC unavailable");
    return { manifest: activeManifest, client: mockClient };
  });
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
    now = new Date("2026-11-19T00:00:00.000Z");
    chainAvailable = true;
    activeManifest = manifest;
    service = new BackendService(fixture.db, origin, authority, () => now);
    api = createApi({
      service: () => service,
      origin: () => origin,
      secure: false,
    });
  });
  async function signIn(account = a) {
    const challenge = await service.nonce(account.address.toLowerCase());
    const signature = await account.signMessage({ message: challenge.message });
    return {
      challenge,
      signature,
      ...(await service.verify(
        challenge.message,
        signature,
        challenge.challenge,
      )),
    };
  }
  function request(
    method = "GET",
    body?: unknown,
    token?: string,
    path = "/api/profile",
    requestOrigin = origin,
  ) {
    return new Request(`${origin}${path}`, {
      method,
      headers: {
        origin: requestOrigin,
        "content-type": "application/json",
        ...(token ? { cookie: `tl_session=${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  it("accepts a valid signature and stores only hashed bearer tokens", async () => {
    const login = await signIn();
    assert.equal((await service.session(login.token))?.address, walletA);
    const { rows } = await fixture.db.query(
      "SELECT token_hash FROM trustlayer.auth_sessions",
    );
    assert.equal(rows[0].token_hash, digest(login.token));
    assert.notEqual(rows[0].token_hash, login.token);
  });
  it("uses durable nonces and sessions across independent service instances", async () => {
    const c = await service.nonce(walletA);
    const other = new BackendService(fixture.db, origin, authority, () => now);
    const login = await other.verify(
      c.message,
      await a.signMessage({ message: c.message }),
      c.challenge,
    );
    assert.equal((await service.session(login.token))?.address, walletA);
  });
  it("rejects invalid signatures without consuming the valid challenge", async () => {
    const c = await service.nonce(walletA);
    await assert.rejects(
      service.verify(
        c.message,
        await b.signMessage({ message: c.message }),
        c.challenge,
      ),
      /signature is invalid/,
    );
    await service.verify(
      c.message,
      await a.signMessage({ message: c.message }),
      c.challenge,
    );
  });
  it("rejects expired nonce exactly at its expiration", async () => {
    const c = await service.nonce(walletA);
    now = new Date(c.expiresAt);
    await assert.rejects(
      service.verify(
        c.message,
        await a.signMessage({ message: c.message }),
        c.challenge,
      ),
      /expired/,
    );
  });
  it("rejects replayed nonces", async () => {
    const login = await signIn();
    await assert.rejects(
      service.verify(
        login.challenge.message,
        login.signature,
        login.challenge.challenge,
      ),
      /already used/,
    );
  });
  it("permits only one concurrent verification of a challenge", async () => {
    const c = await service.nonce(walletA),
      sig = await a.signMessage({ message: c.message });
    const outcomes = await Promise.allSettled([
      service.verify(c.message, sig, c.challenge),
      service.verify(c.message, sig, c.challenge),
    ]);
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  });
  for (const [name, alter] of [
    [
      "domain",
      (m: string) => m.replace("127.0.0.1:3000 wants", "evil.example wants"),
    ],
    [
      "URI",
      (m: string) => m.replace(`URI: ${origin}`, "URI: https://evil.example"),
    ],
    ["chain", (m: string) => m.replace("Chain ID: 31337", "Chain ID: 1")],
    ["wallet", (m: string) => m.replace(a.address, b.address)],
    [
      "issued-at",
      (m: string) =>
        m.replace("2026-11-19T00:00:00.000Z", "2026-11-20T00:00:00.000Z"),
    ],
    ["expiration", (m: string) => m.replace("00:05:00", "00:06:00")],
    [
      "nonce",
      (m: string) => m.replace(/Nonce: [a-f0-9]+/, "Nonce: abcdef1234567890"),
    ],
  ] as const)
    it(`rejects changed SIWE ${name}`, async () => {
      const c = await service.nonce(walletA),
        message = alter(c.message);
      await assert.rejects(
        service.verify(message, await a.signMessage({ message }), c.challenge),
        /does not match/,
      );
    });
  it("requires the browser challenge cookie", async () => {
    const c = await service.nonce(walletA);
    await assert.rejects(
      service.verify(
        c.message,
        await a.signMessage({ message: c.message }),
        undefined,
      ),
      /new sign-in/,
    );
  });
  it("expires sessions and supports explicit logout", async () => {
    const login = await signIn();
    now = new Date(login.session.expiresAt);
    assert.equal(await service.session(login.token), null);
    now = new Date("2026-11-19T00:00:00Z");
    await service.logout(login.token);
    assert.equal(await service.session(login.token), null);
  });
  it("rotates an existing session when switching authenticated accounts", async () => {
    const first = await signIn();
    const c = await service.nonce(walletB);
    const second = await service.verify(
      c.message,
      await b.signMessage({ message: c.message }),
      c.challenge,
      first.token,
    );
    assert.equal(await service.session(first.token), null);
    assert.equal((await service.session(second.token))?.address, walletB);
  });
  it("rate limits authentication durably and resets the five-minute window", async () => {
    for (let i = 0; i < 10; i++) await service.nonce(walletA);
    await assert.rejects(service.nonce(walletA), /Too many/);
    now = new Date(now.getTime() + 300_000);
    await service.nonce(walletA);
  });
  it("rejects unauthenticated profile and metadata requests", async () => {
    assert.equal((await api("profile", request())).status, 401);
    assert.equal((await api("project", request(), "0")).status, 401);
  });
  it("updates only the session wallet's profile and rejects submitted ownership", async () => {
    const login = await signIn();
    await signIn(b);
    assert.equal(
      (
        await api(
          "profile",
          request(
            "PATCH",
            { displayName: "Alice", biography: "Developer" },
            login.token,
          ),
        )
      ).status,
      200,
    );
    assert.equal((await service.profile(walletA)).display_name, "Alice");
    assert.equal((await service.profile(walletB)).display_name, "");
    assert.equal(
      (
        await api(
          "profile",
          request(
            "PATCH",
            { displayName: "Hijack", wallet: walletB },
            login.token,
          ),
        )
      ).status,
      400,
    );
  });
  it("rejects bad JSON, unknown properties, invalid addresses and unsupported chain", async () => {
    assert.equal(
      (
        await api(
          "nonce",
          request("POST", { address: "garbage", chainId: 31337 }),
        )
      ).status,
      400,
    );
    assert.equal(
      (await api("nonce", request("POST", { address: walletA, chainId: 1 })))
        .status,
      400,
    );
    assert.equal(
      (
        await api(
          "nonce",
          new Request(origin, {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: "{",
          }),
        )
      ).status,
      400,
    );
  });
  it("rejects cross-origin writes and oversized bodies", async () => {
    assert.equal(
      (
        await api(
          "nonce",
          request(
            "POST",
            { address: walletA, chainId: 31337 },
            undefined,
            "/api/auth/nonce",
            "https://evil.example",
          ),
        )
      ).status,
      403,
    );
    assert.equal(
      (await api("nonce", request("POST", { text: "a".repeat(40_001) })))
        .status,
      413,
    );
  });
  it("sets hardened production cookies and no-store headers", async () => {
    const secureApi = createApi({
      service: () => service,
      origin: () => origin,
      secure: true,
    });
    const nonce = await secureApi(
      "nonce",
      request("POST", { address: walletA, chainId: 31337 }),
    );
    const payload = await nonce.json();
    const challengeCookie = nonce.headers.getSetCookie()[0].split(";")[0];
    assert.match(challengeCookie, /^__Host-tl_challenge=/);
    const verify = await secureApi(
      "verify",
      new Request(origin, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          cookie: challengeCookie,
        },
        body: JSON.stringify({
          message: payload.message,
          signature: await a.signMessage({ message: payload.message }),
        }),
      }),
    );
    assert.equal(verify.status, 200);
    assert.match(
      verify.headers.getSetCookie()[0],
      /__Host-tl_session=.*HttpOnly; SameSite=Strict; Max-Age=28800; Secure/,
    );
    assert.equal(verify.headers.get("cache-control"), "no-store");
  });
  it("logs out through the API and clears both cookies", async () => {
    const login = await signIn();
    const r = await api("logout", request("POST", undefined, login.token));
    assert.equal(r.status, 200);
    assert.equal(r.headers.getSetCookie().length, 2);
    assert.equal(await service.session(login.token), null);
  });
  for (const secure of [false, true])
    it(`restores a database-backed session with ${secure ? "production HTTPS" : "local HTTP"} cookies`, async () => {
      const configuredOrigin = secure ? "https://trustlayer.example" : origin;
      const configuredService = new BackendService(
        fixture.db,
        configuredOrigin,
        authority,
        () => now,
      );
      const configuredApi = createApi({
        service: () => configuredService,
        origin: () => configuredOrigin,
        secure,
      });
      const send = (method: string, cookie?: string, body?: unknown) =>
        new Request(`${configuredOrigin}/api/auth/session`, {
          method,
          headers: {
            origin: configuredOrigin,
            "content-type": "application/json",
            ...(cookie ? { cookie } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      const nonce = await configuredApi(
        "nonce",
        send("POST", undefined, { address: walletA, chainId: 31337 }),
      );
      const { message } = await nonce.json();
      const verify = await configuredApi(
        "verify",
        send("POST", nonce.headers.getSetCookie()[0].split(";")[0], {
          message,
          signature: await a.signMessage({ message }),
        }),
      );
      assert.equal(verify.status, 200);
      const sessionCookie = verify.headers.getSetCookie()[0];
      assert.match(
        sessionCookie,
        /Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800/,
      );
      assert.equal(sessionCookie.includes("; Secure"), secure);
      assert.equal(sessionCookie.startsWith("__Host-"), secure);
      assert.equal(sessionCookie.includes("Domain="), false);
      const verification = await verify.json();
      assert.equal(
        Date.parse(verification.session.expiresAt) - now.getTime(),
        28_800_000,
      );
      const restored = await configuredApi(
        "session",
        send("GET", sessionCookie.split(";")[0]),
      );
      assert.deepEqual((await restored.json()).session, verification.session);
      now = new Date(verification.session.expiresAt);
      const expired = await configuredApi(
        "session",
        send("GET", sessionCookie.split(";")[0]),
      );
      assert.equal((await expired.json()).session, null);
      assert.match(expired.headers.getSetCookie()[0], /Max-Age=0/);
    });
  it("returns missing metadata and nonexistent on-chain resources as 404", async () => {
    await assert.rejects(
      service.project(walletA, scope, "0"),
      (e: unknown) => e instanceof ApiError && e.status === 404,
    );
    await assert.rejects(
      service.project(walletA, scope, "2"),
      /On-chain project not found/,
    );
  });
  it("writes and reads metadata for both verified participants without storing money", async () => {
    const p = await service.saveProject(walletA, scope, "0", metadata);
    assert.equal(p.title, metadata.title);
    assert.equal(p.milestones.length, 1);
    assert.equal(
      (
        await service.saveProject(walletB, scope, "0", {
          ...metadata,
          title: "Updated",
        })
      ).title,
      "Updated",
    );
    assert.equal(
      (
        await fixture.db.query(
          "SELECT count(*)::int AS n FROM trustlayer.projects",
        )
      ).rows[0].n,
      1,
    );
    assert.equal("balance" in p, false);
  });
  it("rejects cross-wallet metadata reads and writes using live participants", async () => {
    await service.saveProject(walletA, scope, "0", metadata);
    await assert.rejects(
      service.saveProject(outsider.address.toLowerCase(), scope, "0", metadata),
      /Only project participants/,
    );
    await assert.rejects(
      service.project(outsider.address.toLowerCase(), scope, "0"),
      /Only project participants/,
    );
  });
  it("validates milestone indices against the actual project", async () => {
    await assert.rejects(
      service.saveProject(walletA, scope, "0", {
        ...metadata,
        milestones: [{ index: 3, description: "No such milestone" }],
      }),
      /does not exist/,
    );
    await assert.rejects(
      authority.milestone(scope, "0", 2, walletA),
      /not found/,
    );
    await authority.milestone(scope, "0", 1, walletB);
  });
  it("permits dispute metadata authority only for participants and assigned jurors", async () => {
    await authority.dispute(scope, "0", walletA);
    await authority.dispute(scope, "0", juror.address.toLowerCase());
    await assert.rejects(
      authority.dispute(scope, "0", outsider.address.toLowerCase()),
      /Only participants/,
    );
  });
  it("rejects stale deployment identities and fails closed when RPC is unavailable", async () => {
    await assert.rejects(
      service.saveProject(
        walletA,
        { ...scope, deploymentHash: `0x${"f".repeat(64)}` },
        "0",
        metadata,
      ),
      /verified active deployment/,
    );
    chainAvailable = false;
    await assert.rejects(
      service.saveProject(walletA, scope, "0", metadata),
      /RPC unavailable/,
    );
    assert.equal(
      (
        await fixture.db.query(
          "SELECT count(*)::int n FROM trustlayer.projects",
        )
      ).rows[0].n,
      0,
    );
  });
  it("normalizes valid checksummed wallets and rejects mixed-case database storage", async () => {
    assert.equal(
      nonceSchema.parse({ address: a.address, chainId: 31337 }).address,
      walletA,
    );
    await assert.rejects(
      fixture.db.query(
        "INSERT INTO trustlayer.profiles(wallet_address) VALUES ($1)",
        [`0x${"A".repeat(40)}`],
      ),
    );
    assert.throws(() =>
      scopeSchema.parse({ ...scope, escrowAddress: "invalid" }),
    );
  });
  it("enforces duplicate project identifiers and foreign-key integrity", async () => {
    const p = await service.saveProject(walletA, scope, "0", metadata);
    await assert.rejects(
      fixture.db.query(
        "INSERT INTO trustlayer.projects(deployment_id,onchain_project_id,title,description,client_wallet,freelancer_wallet) VALUES ($1,0,'Duplicate','Scope',$2,$3)",
        [p.deployment_id, walletA, walletB],
      ),
    );
    await assert.rejects(
      fixture.db.query(
        "INSERT INTO trustlayer.milestones(project_id,onchain_index,description) VALUES (gen_random_uuid(),0,'Orphan')",
      ),
    );
    await assert.rejects(
      fixture.db.query(
        "INSERT INTO trustlayer.submissions(milestone_id,content_reference) VALUES (gen_random_uuid(),'hash')",
      ),
    );
    await assert.rejects(
      fixture.db.query("DELETE FROM trustlayer.projects WHERE id=$1", [p.id]),
    );
  });
  it("prevents disputes from referencing milestones belonging to another project", async () => {
    const p = await service.saveProject(walletA, scope, "0", metadata),
      q = await service.saveProject(walletA, scope, "1", metadata);
    await assert.rejects(
      fixture.db.query(
        "INSERT INTO trustlayer.disputes(deployment_id,chain_id,arbitration_address,onchain_dispute_id,project_id,milestone_id) VALUES ($1,31337,$2,0,$3,$4)",
        [
          p.deployment_id,
          manifest.contracts.DisputeArbitration.address.toLowerCase(),
          p.id,
          q.milestones[0].id,
        ],
      ),
    );
  });
  it("denies direct database access for browser roles despite any claimed wallet", async () => {
    await signIn();
    assert.equal(
      (
        await fixture.db.query(
          "SELECT count(*)::int n FROM trustlayer.profiles",
        )
      ).rows[0].n,
      1,
    );
    await fixture.pg.exec(
      "RESET ROLE; CREATE ROLE untrusted_browser; SET ROLE untrusted_browser",
    );
    await assert.rejects(
      fixture.db.query("SELECT * FROM trustlayer.profiles"),
      /permission denied/,
    );
    await fixture.pg.exec(
      "RESET ROLE; GRANT USAGE ON SCHEMA trustlayer TO untrusted_browser; GRANT SELECT ON trustlayer.profiles TO untrusted_browser; SET ROLE untrusted_browser",
    );
    // Even accidentally granting SELECT does not grant a wallet session policy.
    assert.equal(
      (await fixture.db.query("SELECT * FROM trustlayer.profiles")).rows.length,
      0,
    );
    await fixture.pg.exec(
      "RESET ROLE; DROP OWNED BY untrusted_browser; DROP ROLE untrusted_browser; SET ROLE trustlayer_server",
    );
  });
  it("returns sanitized database failures rather than credential details", async () => {
    const broken = createApi({
      service: () => {
        throw new Error("postgres://SECRET_PASSWORD@host");
      },
      origin: () => origin,
      secure: false,
    });
    const r = await broken("profile", request());
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /SECRET_PASSWORD/);
  });
  it("validates deployment query and metadata payloads at the API boundary", async () => {
    const login = await signIn();
    const path = `/api/projects/0?${new URLSearchParams(scope)}`;
    assert.equal(
      (await api("project", request("PUT", metadata, login.token, path), "0"))
        .status,
      200,
    );
    assert.equal(
      (
        await api(
          "project",
          request("PUT", { ...metadata, balance: "10000" }, login.token, path),
          "0",
        )
      ).status,
      400,
    );
    assert.equal(
      (await api("project", request("GET", undefined, login.token, path), "00"))
        .status,
      400,
    );
    assert.equal(
      (
        await api(
          "project",
          request("GET", undefined, login.token, path.replace("31337", "1")),
          "0",
        )
      ).status,
      400,
    );
  });
  it("keeps reused chain/address/project IDs separate after a new deployment anchor", async () => {
    const first = await service.saveProject(walletA, scope, "0", metadata);
    activeManifest = {
      ...manifest,
      verifiedBlock: { ...manifest.verifiedBlock, hash: `0x${"e".repeat(64)}` },
    };
    const nextScope = {
      ...scope,
      deploymentHash: activeManifest.verifiedBlock.hash,
    };
    const next = await service.saveProject(walletA, nextScope, "0", {
      ...metadata,
      title: "New chain",
    });
    assert.notEqual(first.id, next.id);
    assert.equal(
      (
        await fixture.db.query(
          "SELECT count(*)::int n FROM trustlayer.projects",
        )
      ).rows[0].n,
      2,
    );
    await assert.rejects(
      service.project(walletA, scope, "0"),
      /verified active deployment/,
    );
  });
  it("rejects cross-wallet API access even with a valid outsider session", async () => {
    await service.saveProject(walletA, scope, "0", metadata);
    const login = await signIn(outsider);
    const path = `/api/projects/0?${new URLSearchParams(scope)}`;
    assert.equal(
      (await api("project", request("GET", undefined, login.token, path), "0"))
        .status,
      403,
    );
    assert.equal(
      (await api("project", request("PUT", metadata, login.token, path), "0"))
        .status,
      403,
    );
  });
  it("enforces exact uint256 values, milestone uniqueness and bounded metadata in SQL", async () => {
    const p = await service.saveProject(walletA, scope, "0", metadata);
    for (const id of ["-1", "0.5", String(1n << 256n)]) {
      await assert.rejects(
        fixture.db.query(
          "INSERT INTO trustlayer.projects(deployment_id,onchain_project_id,title,description,client_wallet,freelancer_wallet) VALUES ($1,$2,'Bad','Bad',$3,$4)",
          [p.deployment_id, id, walletA, walletB],
        ),
      );
    }
    await assert.rejects(
      fixture.db.query(
        "INSERT INTO trustlayer.milestones(project_id,onchain_index,description) VALUES ($1,0,'Duplicate')",
        [p.id],
      ),
    );
    await assert.rejects(
      fixture.db.query(
        "UPDATE trustlayer.milestones SET metadata=$2 WHERE project_id=$1",
        [p.id, JSON.stringify({ text: "x".repeat(5000) })],
      ),
    );
  });
  it("sanitizes a real database constraint failure and preserves the prior profile", async () => {
    const login = await signIn();
    await fixture.pg.exec(
      "RESET ROLE; ALTER TABLE trustlayer.profiles ADD CONSTRAINT test_db_failure CHECK (display_name <> 'RejectedByDatabase'); SET ROLE trustlayer_server",
    );
    try {
      const response = await api(
        "profile",
        request("PATCH", { displayName: "RejectedByDatabase" }, login.token),
      );
      assert.equal(response.status, 503);
      assert.doesNotMatch(
        await response.text(),
        /test_db_failure|postgres|constraint/,
      );
      assert.equal((await service.profile(walletA)).display_name, "");
    } finally {
      await fixture.pg.exec(
        "RESET ROLE; ALTER TABLE trustlayer.profiles DROP CONSTRAINT test_db_failure; SET ROLE trustlayer_server",
      );
    }
  });
  it("enforces production origins, certificate validation and wallet-scoped client sessions", () => {
    assert.throws(() =>
      authOrigin({ NODE_ENV: "production", AUTH_ORIGIN: origin }),
    );
    assert.equal(
      authOrigin({
        NODE_ENV: "production",
        AUTH_ORIGIN: "https://trustlayer.example",
      }),
      "https://trustlayer.example",
    );
    assert.throws(() =>
      databaseConfig({
        DATABASE_URL: "postgres://u:p@db.example/app?sslmode=disable",
      }),
    );
    assert.deepEqual(
      databaseConfig({ DATABASE_URL: "postgres://u:p@db.example/app" }).ssl,
      { rejectUnauthorized: true },
    );
    const s = {
      address: walletA,
      chainId: 31337,
      expiresAt: "2030-01-01T00:00:00Z",
    };
    assert.equal(sessionMatches(s, a.address, 31337), true);
    assert.equal(sessionMatches(s, b.address, 31337), false);
    assert.equal(sessionMatches(s, a.address, 1), false);
    assert.equal(
      sessionMatches(s, a.address, 31337, Date.parse(s.expiresAt)),
      false,
    );
  });
});
