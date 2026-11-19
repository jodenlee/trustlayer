"use client";
import { useState, type FormEvent } from "react";
import { useConnection } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { backendRequest, type BackendProfile } from "@/lib/auth-client";
import { useBackendAuth } from "./auth-provider";
import { Button, Card, CardHeading, Field, Input } from "./ui";

export function BackendAuthControl() {
  const auth = useBackendAuth();
  const wallet = useConnection();
  return (
    <div className="space-y-3 mt-4" aria-label="Backend authentication">
      <p className="small" aria-live="polite">
        {auth.session
          ? "Backend authenticated"
          : auth.checking
            ? "Checking backend session…"
            : "Backend not authenticated"}
      </p>
      <p className="small text-muted">
        Wallet connection and backend sign-in are separate. Sign-in sends no
        transaction.
      </p>
      {!auth.configured && (
        <p className="small text-muted">
          Backend setup required. Configure PostgreSQL and apply the Phase 4A
          migration.
        </p>
      )}
      {auth.session ? (
        <Button
          variant="secondary"
          disabled={auth.busy}
          onClick={() => void auth.logout()}
        >
          Sign out of backend
        </Button>
      ) : (
        <Button
          variant="secondary"
          disabled={
            !wallet.isConnected ||
            wallet.chainId !== 31337 ||
            auth.busy ||
            auth.checking ||
            !auth.configured
          }
          onClick={() => void auth.signIn()}
        >
          {auth.busy ? "Confirm sign-in in wallet…" : "Sign in with Ethereum"}
        </Button>
      )}
      {auth.error && (
        <p
          role="alert"
          aria-label="Backend authentication error"
          className="form-error"
        >
          {auth.error}
        </p>
      )}
    </div>
  );
}
function ProfileEditor({
  profile,
  onSaved,
}: {
  profile: BackendProfile;
  onSaved: () => Promise<unknown>;
}) {
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [biography, setBiography] = useState(profile.biography);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFeedback("");
    try {
      await backendRequest("/api/profile", "PATCH", { displayName, biography });
      await onSaved();
      setFeedback("Backend profile saved.");
    } catch (e) {
      setFeedback(
        e instanceof Error ? e.message : "Profile could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="space-y-4 mt-5" onSubmit={save}>
      <p className="small text-muted">
        Saved for{" "}
        <code className="wallet-address">{profile.wallet_address}</code>. Use
        only non-sensitive profile information.
      </p>
      <Field id="backend-display-name" label="Backend display name">
        <Input
          id="backend-display-name"
          required
          maxLength={80}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </Field>
      <Field id="backend-biography" label="Biography (optional)">
        <textarea
          className="input"
          id="backend-biography"
          maxLength={2000}
          value={biography}
          onChange={(e) => setBiography(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={busy}>
        {busy ? "Saving profile…" : "Save backend profile"}
      </Button>
      {feedback && (
        <p role="status" className="small">
          {feedback}
        </p>
      )}
    </form>
  );
}
export function BackendProfileCard() {
  const auth = useBackendAuth();
  const profile = useQuery({
    queryKey: ["backend-profile", auth.session?.address],
    enabled: !!auth.session,
    queryFn: () => backendRequest<{ profile: BackendProfile }>("/api/profile"),
    gcTime: 0,
  });
  return (
    <Card>
      <CardHeading
        title="Wallet-linked profile"
        description="Persistent backend profile, separate from preview preferences."
      />
      <div className="card-body pt-0!">
        <BackendAuthControl />
        {auth.session && profile.isPending && (
          <p className="small mt-3">Loading profile…</p>
        )}
        {auth.session && profile.error && (
          <p role="alert" className="form-error">
            {profile.error.message}
          </p>
        )}
        {auth.session && profile.data && (
          <ProfileEditor
            key={auth.session.address}
            profile={profile.data.profile}
            onSaved={profile.refetch}
          />
        )}
      </div>
    </Card>
  );
}
