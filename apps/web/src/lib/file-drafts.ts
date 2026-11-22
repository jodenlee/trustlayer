import type { FileRecord } from "./files";

export interface FileDraft {
  file: File;
  key: string;
  phase: "selected" | "uploading" | "success" | "failed";
  progress?: number;
  message: string;
  request?: string;
  result?: FileRecord;
}
export function settledFileIdentity(
  status: string,
  address?: string,
  chainId?: number,
) {
  if (status === "connecting" || status === "reconnecting") return null;
  return status === "connected" && address
    ? `${chainId}:${address.toLowerCase()}`
    : undefined;
}
/** File objects stay in app memory only, never browser storage or query caches. */
export function createFileDraftStore() {
  const drafts = new Map<string, FileDraft>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: (scope: string) => drafts.get(scope),
    select(scope: string, file?: File) {
      if (file)
        drafts.set(scope, {
          file,
          key: crypto.randomUUID(),
          phase: "selected",
          message: "File selected. Upload has not started.",
        });
      else drafts.delete(scope);
      emit();
    },
    start(scope: string) {
      const draft = drafts.get(scope);
      if (!draft || draft.phase === "uploading") return undefined;
      const request = crypto.randomUUID();
      drafts.set(scope, {
        ...draft,
        request,
        phase: "uploading",
        progress: 0,
        message: "Uploading privately…",
      });
      emit();
      return { ...draft, request };
    },
    update(scope: string, request: string, change: Partial<FileDraft>) {
      const draft = drafts.get(scope);
      if (!draft || draft.request !== request) return;
      drafts.set(scope, { ...draft, ...change });
      emit();
    },
    clear() {
      drafts.clear();
      emit();
    },
  };
}
