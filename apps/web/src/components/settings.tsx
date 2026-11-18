"use client";
import { useState, type FormEvent } from "react";
import { Info, Monitor, Wallet } from "lucide-react";
import { networkPreview } from "@/lib/blockchain/config";
import { Button, Card, CardHeading, Field, Input, PageHeading } from "./ui";
import { usePreview } from "./providers";
export function Settings() {
  const { name, setName, precise, setPrecise, toast, openWallet } =
    usePreview();
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
          <Card>
            <CardHeading
              title="Wallet & network"
              action={<Wallet size={19} className="text-muted" />}
            />
            <div className="card-body pt-0!">
              <dl className="summary-list">
                <div>
                  <dt>Wallet</dt>
                  <dd>Not connected</dd>
                </div>
                <div>
                  <dt>Account address</dt>
                  <dd>Unavailable</dd>
                </div>
                <div>
                  <dt>Planned network</dt>
                  <dd>{networkPreview.name}</dd>
                </div>
                <div>
                  <dt>Chain ID</dt>
                  <dd>{networkPreview.chainId}</dd>
                </div>
                <div>
                  <dt>Payment token</dt>
                  <dd>
                    {networkPreview.token} · {networkPreview.decimals} decimals
                  </dd>
                </div>
                <div>
                  <dt>RPC status</dt>
                  <dd>Not connected</dd>
                </div>
                <div>
                  <dt>Contract deployment</dt>
                  <dd>Not loaded</dd>
                </div>
              </dl>
              <Button
                variant="secondary"
                className="w-full mt-5"
                onClick={openWallet}
              >
                <Wallet size={15} />
                About wallet connection
              </Button>
            </div>
          </Card>
          <div className="info-note">
            <Info size={15} />
            <p>
              This is metadata for future local-chain integration, not a live
              network reading. Sepolia connectivity, signing, and backend
              profiles are outside this phase.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
