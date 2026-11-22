"use client";
import { useState, type FormEvent } from "react";
import { backendRequest, type BackendProfile } from "@/lib/auth-client";
import { useBackendAuth } from "./auth-provider";
import { useProfile } from "./shell";
import { Button, Card, CardBody, CardHeading, Field, Input } from "./ui";

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
      setFeedback("Profile saved.");
    } catch (e) {
      setFeedback(
        e instanceof Error ? e.message : "Profile could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={save}>
      <Field
        id="backend-display-name"
        label="Display name"
        hint="Shown to people you work with. Use non-sensitive information only."
      >
        <Input
          id="backend-display-name"
          required
          maxLength={80}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </Field>
      <Field id="backend-biography" label="About you (optional)">
        <textarea
          className="textarea"
          id="backend-biography"
          maxLength={2000}
          value={biography}
          onChange={(e) => setBiography(e.target.value)}
        />
      </Field>
      <div className="button-row">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving profile…" : "Save profile"}
        </Button>
        {feedback && (
          <p role="status" className="small text-muted">
            {feedback}
          </p>
        )}
      </div>
    </form>
  );
}
/** The signed-in wallet's persistent off-chain profile. */
export function BackendProfileCard() {
  const auth = useBackendAuth();
  const profile = useProfile();
  return (
    <Card label="Profile">
      <CardHeading
        title="Profile"
        description="Saved to your wallet-linked account, separate from blockchain data."
      />
      <CardBody>
        {profile.isPending && (
          <p className="small text-muted">Loading profile…</p>
        )}
        {profile.error && (
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
      </CardBody>
    </Card>
  );
}
