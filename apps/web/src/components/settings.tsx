"use client";
import { useState, type FormEvent } from "react";
import { Info, Monitor } from "lucide-react";
import { LiveWalletCard, ProtocolConnectionCard } from "./live-wallet";
import { Button, Card, CardHeading, Field, Input, PageHeading } from "./ui";
import { usePreview } from "./providers";
import { BackendProfileCard } from "./backend-auth";
export function Settings() {
  const { name, setName, precise, setPrecise, toast } = usePreview();
  const [draftName, setDraftName] = useState(name);
  const [error, setError] = useState("");
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draftName.trim()) {
      setError("Enter a display name.");
      return;
    }
    setError("");
    setName(draftName.trim());
    toast("Display name updated for this preview session.");
  }
  return (
    <>
      <PageHeading
        title="Make yourself at home"
        description="Your interface preferences and a clear view of connection status."
      />
      <div className="settings-grid">
        <div className="space-y-5">
          <BackendProfileCard />
          <Card>
            <CardHeading
              title="Profile preferences"
              description="Local to this open preview. Refreshing resets these settings."
            />
            <form className="card-body pt-0!" onSubmit={save}>
              <Field id="display-name" label="Display name">
                <Input
                  id="display-name"
                  value={draftName}
                  maxLength={40}
                  onChange={(e) => setDraftName(e.target.value)}
                  aria-invalid={!!error}
                  aria-describedby={error ? "name-error" : undefined}
                />
              </Field>
              {error && (
                <p
                  id="name-error"
                  role="alert"
                  className="small text-red-700 mt-2"
                >
                  {error}
                </p>
              )}
              <Button className="mt-5" type="submit">
                Save preferences
              </Button>
            </form>
          </Card>
          <Card>
            <CardHeading title="Interface" />
            <div className="card-body pt-0!">
              <div className="setting-row">
                <div>
                  <h3>Appearance</h3>
                  <p className="small text-muted mt-1">
                    A clear, consistent light workspace.
                  </p>
                </div>
                <span className="badge badge-gray">
                  <Monitor size={12} />
                  Light
                </span>
              </div>
              <label className="setting-row" htmlFor="precision">
                <div>
                  <h3>Full token precision</h3>
                  <p className="small text-muted mt-1">
                    Show all six mUSD decimal places.
                  </p>
                </div>
                <input
                  id="precision"
                  className="toggle"
                  type="checkbox"
                  checked={precise}
                  onChange={(e) => {
                    setPrecise(e.target.checked);
                    toast("Token display preference updated for this session.");
                  }}
                />
              </label>
            </div>
          </Card>
        </div>
        <div className="space-y-5">
          <LiveWalletCard />
          <ProtocolConnectionCard />
          <div className="info-note">
            <Info size={15} />
            <p>
              Live data requires a verified persistent local deployment. Sample
              projects remain fictional even when a wallet is connected. Backend
              profiles are stored separately from blockchain state. Sepolia and
              private evidence uploads remain deferred.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
