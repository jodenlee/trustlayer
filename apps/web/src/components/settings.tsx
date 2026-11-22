"use client";
import { ProtocolDetails, WalletSummary } from "./live-wallet";
import { Card, CardBody, CardHeading, PageHeading } from "./ui";
import { useUi } from "./providers";
import { BackendProfileCard } from "./backend-auth";

export function Settings() {
  const { precise, setPrecise, toast } = useUi();
  return (
    <>
      <PageHeading
        title="Settings"
        description="Your profile, wallet session and display preferences."
      />
      <div className="grid-main">
        <div className="stack">
          <BackendProfileCard />
          <Card label="Preferences">
            <CardHeading title="Preferences" />
            <CardBody>
              <label
                className="flex items-center justify-between gap-4"
                htmlFor="precision"
              >
                <span>
                  <span className="block font-medium">
                    Full token precision
                  </span>
                  <span className="small text-muted">
                    Show all six mUSD decimal places instead of trimming
                    trailing zeros.
                  </span>
                </span>
                <input
                  id="precision"
                  className="toggle"
                  type="checkbox"
                  checked={precise}
                  onChange={(e) => {
                    setPrecise(e.target.checked);
                    toast("Token display preference updated.");
                  }}
                />
              </label>
            </CardBody>
          </Card>
        </div>
        <div className="stack">
          <WalletSummary />
          <ProtocolDetails />
        </div>
      </div>
    </>
  );
}
