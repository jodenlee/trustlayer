"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LocalDeployment } from "@trustlayer/contracts";
import { useBackendAuth } from "./auth-provider";
import { backendRequest } from "@/lib/auth-client";
import { metadataScope } from "@/lib/metadata-client";
import { FILE_TYPES, type FileCategory, type FileRecord } from "@/lib/files";
import { Button, Disclosure, Field, Hash, Input } from "./ui";
import { useFileDraft } from "./file-draft-provider";

export async function browserFileHash(bytes: ArrayBuffer) {
  return `0x${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
export function fileAssociationUrl(manifest: LocalDeployment, id: string) {
  return `/api/files/${id}/associate?${metadataScope(manifest)}`;
}
export function PrivateFiles({
  manifest,
  projectId,
  index,
  disputeId,
  category,
  canUpload,
  onSelected,
}: {
  manifest: LocalDeployment;
  projectId: bigint;
  index: number;
  disputeId?: bigint;
  category: FileCategory;
  canUpload: boolean;
  onSelected?: (file: FileRecord) => void;
}) {
  const auth = useBackendAuth();
  const query = metadataScope(manifest);
  query.set("projectId", String(projectId));
  query.set("milestoneIndex", String(index));
  if (disputeId !== undefined) query.set("disputeId", String(disputeId));
  const target = query.toString();
  const files = useQuery({
    queryKey: ["private-files", auth.session?.address, target],
    enabled: !!auth.session,
    gcTime: 0,
    queryFn: () =>
      backendRequest<{ files: FileRecord[]; maxBytes?: number }>(
        `/api/files?${target}`,
      ),
  });
  const draftScope = `${auth.session?.address ?? "signed-out"}:${target}:${category}`;
  const { store, draft, authorized } = useFileDraft(draftScope);
  const queries = useQueryClient();
  const selection = draft?.file;
  const progress = draft?.phase === "uploading" ? draft.progress : undefined;
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState("");
  const live = useRef(true);
  const identity = auth.session
    ? `${auth.session.address}:${auth.session.expiresAt}`
    : undefined;
  const currentIdentity = useRef(identity);
  useLayoutEffect(() => {
    currentIdentity.current = identity;
    return () => {
      currentIdentity.current = undefined;
    };
  }, [identity]);
  const active = () =>
    live.current && !!identity && currentIdentity.current === identity;
  const visibleFiles = files.data?.files.filter(
    (file) => disputeId !== undefined || file.category === category,
  );
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function upload() {
    if (!identity || !auth.session) return;
    const attempt = store.start(draftScope);
    if (!attempt) return;
    const { file: selected, key, request } = attempt;
    const actor = auth.session.address;
    const permitted = () =>
      store.get(draftScope)?.request === request && authorized(identity, actor);
    const expired =
      "Authentication expired or changed. Sign in and retry the same selected file; do not resend a blockchain transaction.";
    setMessage("");
    try {
      if (
        !selected.size ||
        selected.size > (files.data?.maxBytes ?? 10 * 1024 * 1024)
      )
        throw new Error(
          "Select a nonempty file within the configured upload limit.",
        );
      const bytes = await selected.arrayBuffer(),
        hash = await browserFileHash(bytes);
      if (!permitted()) return;
      const result = await new Promise<{ file: FileRecord }>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", `/api/files?${target}&category=${category}`);
          xhr.withCredentials = true;
          xhr.timeout = 120_000;
          xhr.ontimeout = () =>
            reject(
              new Error(
                "Upload confirmation timed out. Retry the same file/key; do not resend a blockchain transaction.",
              ),
            );
          xhr.onabort = () =>
            reject(
              new Error(
                "Upload interrupted. Reuse the same file/key to recover its status.",
              ),
            );
          xhr.setRequestHeader("Content-Type", selected.type || "text/plain");
          xhr.setRequestHeader(
            "X-File-Name",
            encodeURIComponent(selected.name),
          );
          xhr.setRequestHeader("X-Content-SHA256", hash);
          xhr.setRequestHeader("Idempotency-Key", key);
          xhr.upload.onprogress = (e) => {
            if (permitted() && e.lengthComputable)
              store.update(draftScope, request, {
                progress: Math.round((e.loaded / e.total) * 100),
              });
          };
          xhr.onload = () => {
            try {
              const data = JSON.parse(xhr.responseText);
              if (xhr.status >= 200 && xhr.status < 300) resolve(data);
              else
                reject(
                  new Error(
                    xhr.status === 401
                      ? "Authentication expired. Sign in and retry the same selected file."
                      : (data.error?.message ?? "Upload failed."),
                  ),
                );
            } catch {
              reject(
                new Error(
                  "Upload response was unreadable. Retry the same file.",
                ),
              );
            }
          };
          xhr.onerror = () =>
            reject(
              new Error(
                "Upload status is uncertain. Retry the same file/key; do not resend a blockchain transaction.",
              ),
            );
          xhr.send(bytes);
        },
      );
      if (!permitted()) return;
      store.update(draftScope, request, {
        phase: "success",
        progress: undefined,
        result: result.file,
        message: `Uploaded privately. SHA-256 ${result.file.content_hash}. ${category === "evidence" ? "Off-chain evidence only." : "Not yet submitted on-chain."}`,
      });
      if (active()) onSelected?.(result.file);
    } catch (e) {
      store.update(draftScope, request, {
        phase: "failed",
        progress: undefined,
        result: undefined,
        message: permitted()
          ? e instanceof Error
            ? e.message
            : "Retry the same selected file."
          : expired,
      });
    } finally {
      if (
        store.get(draftScope)?.request === request &&
        store.get(draftScope)?.phase === "uploading"
      )
        store.update(draftScope, request, {
          phase: "failed",
          progress: undefined,
          result: undefined,
          message: expired,
        });
      if (authorized(identity, actor))
        await queries.invalidateQueries({
          queryKey: ["private-files", actor, target],
        });
    }
  }
  async function download(file: FileRecord) {
    setMessage("Verifying private file…");
    try {
      const response = await fetch(
        `/api/files/${file.id}?${metadataScope(manifest)}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message ?? "Download failed.");
      }
      const bytes = await response.arrayBuffer();
      if ((await browserFileHash(bytes)) !== file.content_hash)
        throw new Error("Downloaded file failed SHA-256 verification.");
      if (!active()) return;
      const url = URL.createObjectURL(
          new Blob([bytes], { type: "application/octet-stream" }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        "SHA-256 verified against the recorded file bytes. This does not prove authorship or quality.",
      );
    } catch (e) {
      if (active())
        setMessage(e instanceof Error ? e.message : "Private download failed.");
    }
  }
  async function link(file: FileRecord) {
    setMessage("");
    try {
      await backendRequest(fileAssociationUrl(manifest, file.id), "POST", {
        transactionHash: receipt,
        ...(disputeId !== undefined ? { disputeId: String(disputeId) } : {}),
      });
      if (!active()) return;
      setMessage(
        "Confirmed reference synchronized. No new blockchain transaction was sent.",
      );
      await files.refetch();
    } catch (e) {
      if (active())
        setMessage(e instanceof Error ? e.message : "Association failed.");
    }
  }
  if (!auth.session)
    return (
      <p className="small text-muted">
        Authentication required or expired. Sign in as a relevant participant or
        assigned juror to access private files.
      </p>
    );
  const heading =
    category === "deliverable"
      ? "Delivered files"
      : category === "opening"
        ? "Evidence for the dispute"
        : category === "response"
          ? "Response evidence"
          : "Case files";
  return (
    <div className="files" aria-label="Private files">
      <div>
        <h3 className="small">{heading}</h3>
        <p className="field-hint">
          Private to the parties{disputeId !== undefined ? " and jurors" : ""}.
          PDF, PNG, JPEG or text, up to{" "}
          {Math.round((files.data?.maxBytes ?? 10 * 1024 * 1024) / 1024 / 1024)}{" "}
          MiB. Downloads are checked against their SHA-256 fingerprint.
        </p>
      </div>
      {canUpload && (
        <div className="stack-sm">
          <Field
            id={`private-file-${category}-${index}`}
            label={`Select ${category} file`}
          >
            <Input
              type="file"
              id={`private-file-${category}-${index}`}
              accept={FILE_TYPES.join(",")}
              disabled={draft?.phase === "uploading"}
              onChange={(e) => {
                store.select(draftScope, e.target.files?.[0]);
                setMessage("");
              }}
            />
          </Field>
          {selection && (
            <p className="small text-muted">
              File selected: {selection.name} · {selection.size} bytes ·{" "}
              {selection.type || "text/plain"}
            </p>
          )}
          <div className="button-row">
            <Button
              variant="secondary"
              size="sm"
              disabled={!selection || progress !== undefined}
              onClick={() => void upload()}
            >
              {progress === undefined
                ? "Upload privately"
                : `Uploading ${progress}%`}
            </Button>
          </div>
          {progress !== undefined && (
            <progress
              aria-label="Private upload progress"
              max={100}
              value={progress}
            />
          )}
        </div>
      )}
      {files.error && (
        <div className="stack-sm">
          <p role="alert" className="form-error">
            File listing unavailable. {files.error.message}
          </p>
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void files.refetch()}
            >
              Retry file listing
            </Button>
          </div>
        </div>
      )}
      {files.isPending && (
        <p className="small text-muted">Loading private files…</p>
      )}
      {files.isSuccess && !files.isFetching && visibleFiles?.length === 0 && (
        <p className="small text-muted">No accessible files are recorded.</p>
      )}
      {visibleFiles?.map((file) => (
        <div key={file.id} className="file-row">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="file-name">{file.filename}</span>
            <span className="small text-faint">
              {(file.byte_size / 1024).toFixed(1)} KB · {file.status}
            </span>
          </div>
          <p className="small text-muted">
            {file.category === "evidence"
              ? "Off-chain case attachment"
              : file.transaction_hash
                ? "Confirmed on-chain reference"
                : "Awaiting blockchain reference/association"}
            {" · "}
            {file.created_at}
          </p>
          <p className="small text-muted">
            SHA-256 <Hash value={file.content_hash} />
          </p>
          <div className="button-row">
            {["ready", "linked"].includes(file.status) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void download(file)}
              >
                Download & verify
              </Button>
            )}
            {file.uploader === auth.session!.address &&
              file.status === "ready" &&
              file.category === category &&
              onSelected && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSelected(file)}
                >
                  Use this hash
                </Button>
              )}
            {file.uploader === auth.session!.address &&
              file.status === "failed" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      await backendRequest(
                        `/api/files/${file.id}?${metadataScope(manifest)}`,
                        "DELETE",
                      );
                      await files.refetch();
                    } catch (e) {
                      setMessage(
                        e instanceof Error
                          ? e.message
                          : "Draft removal failed.",
                      );
                    }
                  }}
                >
                  Remove empty failed reservation
                </Button>
              )}
          </div>
          {file.uploader === auth.session!.address &&
            file.status !== "linked" &&
            file.category !== "evidence" && (
              <Disclosure plain summary="Link to a confirmed transaction">
                <div className="stack-sm">
                  <Field
                    id={`receipt-${file.id}`}
                    label="Confirmed transaction hash for association"
                    hint="Only needed if linking failed after a confirmed submission. This never sends a new transaction."
                  >
                    <Input
                      id={`receipt-${file.id}`}
                      spellCheck={false}
                      value={receipt}
                      onChange={(e) => setReceipt(e.target.value.trim())}
                    />
                  </Field>
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!/^0x[0-9a-fA-F]{64}$/.test(receipt)}
                      onClick={() => void link(file)}
                    >
                      Retry confirmed association
                    </Button>
                  </div>
                </div>
              </Disclosure>
            )}
        </div>
      ))}
      {draft?.message && (
        <p aria-live="polite" className="small break-words">
          {draft.phase === "failed" && <span>Upload failed. </span>}
          <span>{draft.message}</span>
        </p>
      )}
      {message && (
        <p aria-live="polite" className="small break-words">
          {message}
        </p>
      )}
    </div>
  );
}
