"use client";
import { useState, type FormEvent } from "react";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import type { LocalDeployment } from "@trustlayer/contracts";
import { useBackendAuth } from "./auth-provider";
import { backendRequest } from "@/lib/auth-client";
import {
  projectMetadataUrl,
  synchronizeMetadata,
  type MetadataDraft,
} from "@/lib/metadata-client";
import type { PersistentProject } from "@/lib/files";
import { deploymentScope } from "@/lib/blockchain/session";
import { Button, Card, CardHeading, Field, Input } from "./ui";
import type { SessionMetadata } from "@/lib/blockchain/projects";

export function usePersistentProject(
  manifest: LocalDeployment | undefined,
  id: bigint,
  exists: boolean,
) {
  const auth = useBackendAuth();
  const enabled = !!manifest && exists && !!auth.session;
  const query = useQuery({
    queryKey: [
      "metadata",
      auth.session?.address,
      manifest && deploymentScope(manifest),
      String(id),
    ],
    enabled,
    gcTime: 0,
    staleTime: 10_000,
    queryFn: () =>
      backendRequest<{ project: PersistentProject }>(
        projectMetadataUrl(manifest!, id),
      ),
  });
  return { ...query, project: enabled ? query.data?.project : undefined };
}
export function useProjectTitles(
  manifest: LocalDeployment | undefined,
  ids: bigint[],
) {
  const auth = useBackendAuth();
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: [
        "metadata",
        auth.session?.address,
        manifest && deploymentScope(manifest),
        String(id),
      ],
      enabled: !!manifest && !!auth.session,
      gcTime: 0,
      staleTime: 10_000,
      queryFn: () =>
        backendRequest<{ project: PersistentProject }>(
          projectMetadataUrl(manifest!, id),
        ),
    })),
  });
  return new Map(
    ids.map((id, i) => [
      String(id),
      auth.session ? queries[i].data?.project.title : undefined,
    ]),
  );
}
export function ProjectMetadataEditor({
  manifest,
  id,
  project,
  fallback,
  count,
}: {
  manifest: LocalDeployment;
  id: bigint;
  project?: PersistentProject;
  fallback?: SessionMetadata;
  count: number;
}) {
  const auth = useBackendAuth(),
    queries = useQueryClient();
  const [title, setTitle] = useState(project?.title ?? fallback?.title ?? "");
  const [description, setDescription] = useState(
    project?.description ?? fallback?.description ?? "",
  );
  const [milestones, setMilestones] = useState(
    Array.from({ length: count }, (_, index) => ({
      index,
      name:
        project?.milestones.find((m) => m.onchain_index === index)?.name ||
        fallback?.milestones[index] ||
        `Milestone ${index + 1}`,
      description:
        project?.milestones.find((m) => m.onchain_index === index)
          ?.description ||
        fallback?.milestones[index] ||
        "",
    })),
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const data: MetadataDraft = {
        title,
        description,
        milestones,
        ...(project ? { expectedRevision: project.revision } : {}),
      };
      await synchronizeMetadata(manifest, id, data);
      await queries.invalidateQueries({ queryKey: ["metadata"] });
      setMessage("Metadata synchronized. The on-chain project is unchanged.");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Metadata synchronization failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeading
        title="Project metadata"
        description="Descriptive text is stored off-chain. Blockchain state remains authoritative."
      />
      <div className="card-body pt-0!">
        {!auth.session ? (
          <p className="small text-muted">
            Sign in with the participant wallet to save or retrieve private
            project metadata. An existing on-chain project never needs to be
            created again to retry metadata.
          </p>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <Field id="saved-project-title" label="Saved project title">
              <Input
                id="saved-project-title"
                value={title}
                maxLength={160}
                required
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field
              id="saved-project-description"
              label="Saved project description"
            >
              <textarea
                className="input"
                id="saved-project-description"
                value={description}
                maxLength={10000}
                required
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            {milestones.map((m, index) => (
              <div key={index} className="space-y-3">
                <Field
                  id={`saved-milestone-${index}`}
                  label={`Milestone ${index + 1} name`}
                >
                  <Input
                    id={`saved-milestone-${index}`}
                    required
                    maxLength={160}
                    value={m.name}
                    onChange={(e) =>
                      setMilestones((v) =>
                        v.map((x, i) =>
                          i === index ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
                <Field
                  id={`saved-milestone-description-${index}`}
                  label={`Milestone ${index + 1} description`}
                >
                  <textarea
                    className="input"
                    id={`saved-milestone-description-${index}`}
                    required
                    maxLength={4000}
                    value={m.description}
                    onChange={(e) =>
                      setMilestones((v) =>
                        v.map((x, i) =>
                          i === index
                            ? { ...x, description: e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                </Field>
              </div>
            ))}
            <Button disabled={busy} type="submit">
              {busy ? "Synchronizing metadata…" : "Save project metadata"}
            </Button>
            {message && (
              <p aria-live="polite" className="small">
                {message}
              </p>
            )}
          </form>
        )}
      </div>
    </Card>
  );
}
