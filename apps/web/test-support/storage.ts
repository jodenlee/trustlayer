import type { PrivateStorage } from "../src/lib/server/storage";
/** Isolated byte store only; production always uses the private Supabase adapter. */
export function testStorage() {
  const objects = new Map<string, Uint8Array>();
  let unavailable = false;
  const storage: PrivateStorage = {
    bucket: "trustlayer-private",
    maxBytes: 1024 * 1024,
    async get(path) {
      if (unavailable) throw new Error("Storage unavailable");
      return objects.get(path) ?? null;
    },
    async put(path, bytes) {
      if (unavailable) throw new Error("Storage unavailable");
      if (objects.has(path)) throw new Error("Overwrite forbidden");
      objects.set(path, Uint8Array.from(bytes));
    },
    async remove(path) {
      if (unavailable) throw new Error("Storage unavailable");
      objects.delete(path);
    },
  };
  return {
    storage,
    objects,
    fail: (value = true) => {
      unavailable = value;
    },
  };
}
