"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LocalDeployment } from "@trustlayer/contracts";
import { useBackendAuth } from "./auth-provider";
import { backendRequest } from "@/lib/auth-client";
import { metadataScope } from "@/lib/metadata-client";
import { FILE_TYPES, type FileCategory, type FileRecord } from "@/lib/files";
import { Button, Field, Input } from "./ui";

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
  const [selection, setSelection] = useState<File>();
  const [key, setKey] = useState("");
  const [progress, setProgress] = useState<number>();
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
    if (!selection || progress !== undefined) return;
    setProgress(0);
    setMessage("");
    try {
      if (
        !selection.size ||
        selection.size > (files.data?.maxBytes ?? 10 * 1024 * 1024)
      )
        throw new Error(
          "Select a nonempty file within the configured upload limit.",
        );
      const bytes = await selection.arrayBuffer(),
        hash = await browserFileHash(bytes);
      if (!active()) return;
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
          xhr.setRequestHeader("Content-Type", selection.type || "text/plain");
          xhr.setRequestHeader(
            "X-File-Name",
            encodeURIComponent(selection.name),
          );
          xhr.setRequestHeader("X-Content-SHA256", hash);
          xhr.setRequestHeader("Idempotency-Key", key);
          xhr.upload.onprogress = (e) => {
            if (active() && e.lengthComputable)
              setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            try {
              const data = JSON.parse(xhr.responseText);
              if (xhr.status >= 200 && xhr.status < 300) resolve(data);
              else reject(new Error(data.error?.message ?? "Upload failed."));
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
      if (!active()) return;
      onSelected?.(result.file);
      setMessage(
        `Uploaded privately. SHA-256 ${result.file.content_hash}. ${category === "evidence" ? "Off-chain evidence only." : "Not yet submitted on-chain."}`,
      );
      await files.refetch();
    } catch (e) {
      if (active())
        setMessage(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      // Release the UI lock even when the SIWE session expired mid-request.
      // Private results/callbacks above still require the original identity.
      if (live.current) setProgress(undefined);
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
      <p className="small text-muted mt-3">
        Sign in as a relevant participant or assigned juror to access private
        files.
      </p>
    );
  return (
    <div className="space-y-3 mt-4" aria-label="Private files">
      <h3>
        Private {category === "deliverable" ? "deliverables" : "evidence"}
      </h3>
      <p className="small text-muted">
        PDF, PNG, JPEG or UTF-8 text; private downloads are integrity checked.
        Maximum{" "}
        {Math.round((files.data?.maxBytes ?? 10 * 1024 * 1024) / 1024 / 1024)}{" "}
        MiB. Hashes are public references, not encryption.
      </p>
      {canUpload && (
        <>
          <Field
            id={`private-file-${category}-${index}`}
            label={`Select ${category} file`}
          >
            <Input
              type="file"
              id={`private-file-${category}-${index}`}
              accept={FILE_TYPES.join(",")}
              onChange={(e) => {
                setSelection(e.target.files?.[0]);
                setKey(crypto.randomUUID());
                setMessage("");
              }}
            />
          </Field>
          {selection && (
            <p className="small">
              {selection.name} · {selection.size} bytes ·{" "}
              {selection.type || "text/plain"}
            </p>
          )}
          <Button
            variant="secondary"
            disabled={!selection || progress !== undefined}
            onClick={() => void upload()}
          >
            {progress === undefined
              ? "Upload privately"
              : `Uploading ${progress}%`}
          </Button>
          {progress !== undefined && (
            <progress
              aria-label="Private upload progress"
              max={100}
              value={progress}
            />
          )}
        </>
      )}
      {files.error && (
        <p role="alert" className="form-error">
          {files.error.message}
        </p>
      )}
      {files.isPending && <p className="small">Loading private files…</p>}
      {visibleFiles?.length === 0 && (
        <p className="small text-muted">No accessible files are recorded.</p>
      )}
      {visibleFiles?.map((file) => (
        <div key={file.id} className="border-t border-slate-200 pt-3 space-y-2">
          <p>
            {file.filename} · {file.byte_size} bytes · {file.status}
          </p>
          <p className="small text-muted">
            {file.created_at} ·{" "}
            {file.category === "evidence"
              ? "Off-chain case attachment"
              : file.transaction_hash
                ? "Confirmed on-chain reference"
                : "Awaiting blockchain reference/association"}
          </p>
          <code className="wallet-address">{file.content_hash}</code>
          <div className="flex flex-wrap gap-2">
            {["ready", "linked"].includes(file.status) && (
              <Button variant="ghost" onClick={() => void download(file)}>
                Download & verify
              </Button>
            )}
            {file.uploader === auth.session!.address &&
              file.status === "ready" &&
              file.category === category &&
              onSelected && (
                <Button variant="ghost" onClick={() => onSelected(file)}>
                  Use this hash
                </Button>
              )}
            {file.uploader === auth.session!.address &&
              file.status === "failed" && (
                <Button
                  variant="ghost"
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
              <div>
                <Field
                  id={`receipt-${file.id}`}
                  label="Confirmed transaction hash for association"
                >
                  <Input
                    id={`receipt-${file.id}`}
                    value={receipt}
                    onChange={(e) => setReceipt(e.target.value.trim())}
                  />
                </Field>
                <Button
                  variant="secondary"
                  disabled={!/^0x[0-9a-fA-F]{64}$/.test(receipt)}
                  onClick={() => void link(file)}
                >
                  Retry confirmed association
                </Button>
              </div>
            )}
        </div>
      ))}
      {message && (
        <p aria-live="polite" className="small break-words">
          {message}
        </p>
      )}
    </div>
  );
}
