import { it } from "node:test";
import assert from "node:assert/strict";
import {
  createFileDraftStore,
  settledFileIdentity,
} from "../src/lib/file-drafts";

it("keeps exact selected bytes and the same idempotency key across refresh subscriptions", async () => {
  const store = createFileDraftStore(),
    file = new File(["private bytes"], "file.txt");
  store.select("wallet/deployment/project/0", file);
  const selected = store.get("wallet/deployment/project/0")!;
  const unsubscribe = store.subscribe(() => {});
  unsubscribe();
  assert.equal(store.get("wallet/deployment/project/0")!.file, file);
  assert.equal(store.get("wallet/deployment/project/0")!.key, selected.key);
  assert.equal(await file.text(), "private bytes");
});
it("prevents duplicate pending starts and releases failures for same-key retry", () => {
  const store = createFileDraftStore();
  store.select("case", new File(["a"], "a.txt"));
  const first = store.start("case")!;
  assert.equal(store.start("case"), undefined);
  store.update("case", first.request, { phase: "failed", progress: undefined });
  const next = store.start("case")!;
  assert.equal(first.key, next.key);
  assert.notEqual(first.request, next.request);
});
it("clears private selections and ignores old completions after actual identity loss", () => {
  const store = createFileDraftStore();
  store.select("case", new File(["a"], "a.txt"));
  const attempt = store.start("case")!;
  store.clear();
  store.update("case", attempt.request, { phase: "success" });
  assert.equal(store.get("case"), undefined);
});
it("distinguishes temporary wallet reconnection from disconnect/account/network changes", () => {
  const actor = "0x1111111111111111111111111111111111111111";
  const settled = settledFileIdentity("connected", actor, 31337);
  assert.equal(settledFileIdentity("reconnecting", actor, 31337), null);
  assert.equal(settledFileIdentity("connecting", actor, 31337), null);
  assert.equal(settledFileIdentity("connected", actor, 31337), settled);
  assert.equal(settledFileIdentity("disconnected"), undefined);
  assert.notEqual(settledFileIdentity("connected", actor, 1), settled);
  assert.notEqual(
    settledFileIdentity(
      "connected",
      "0x2222222222222222222222222222222222222222",
      31337,
    ),
    settled,
  );
});
