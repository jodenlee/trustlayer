"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BriefcaseBusiness,
  Gavel,
  History,
  LayoutGrid,
  Menu,
  Scale,
  Settings2,
} from "lucide-react";
import { useConnection } from "wagmi";
import { Logo } from "./brand";
import { useUi } from "./providers";
import { Button, Notice } from "./ui";
import { Dialog } from "./dialog";
import { SwitchNetworkButton, walletNetwork } from "./wallet";
import { useBackendAuth } from "./auth-provider";
import { backendRequest, type BackendProfile } from "@/lib/auth-client";
import { useVerifiedDeployment } from "@/lib/blockchain/hooks/use-protocol";
import { describeError, shortenAddress } from "@/lib/blockchain/errors";
import { localChain } from "@/lib/blockchain/config";

const navigation = [
  { href: "/dashboard", title: "Overview", icon: LayoutGrid },
  { href: "/projects", title: "Projects", icon: BriefcaseBusiness },
  { href: "/disputes", title: "Disputes", icon: Gavel },
  { href: "/juror", title: "Jury", icon: Scale },
  { href: "/transactions", title: "Transactions", icon: History },
];
function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace navigation" className="workspace-nav">
      {navigation.map(({ href, title, icon: Icon }) => (
        <Link
          href={href}
          key={href}
          onClick={onNavigate}
          className={`nav-link ${isActive(pathname, href) ? "active" : ""}`}
          aria-current={isActive(pathname, href) ? "page" : undefined}
        >
          <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
          {title}
        </Link>
      ))}
      <p className="nav-section">Account</p>
      <Link
        href="/settings"
        onClick={onNavigate}
        className={`nav-link ${isActive(pathname, "/settings") ? "active" : ""}`}
        aria-current={isActive(pathname, "/settings") ? "page" : undefined}
      >
        <Settings2 size={17} strokeWidth={1.8} aria-hidden="true" />
        Settings
      </Link>
    </nav>
  );
}
/** The signed-in user's saved display name, when one exists. */
export function useProfile() {
  const auth = useBackendAuth();
  return useQuery({
    queryKey: ["backend-profile", auth.session?.address],
    enabled: !!auth.session,
    queryFn: () => backendRequest<{ profile: BackendProfile }>("/api/profile"),
    gcTime: 0,
  });
}
function initials(name: string | undefined, address: string | undefined) {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length)
    return parts
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase();
  return address ? address.slice(2, 4).toUpperCase() : "TL";
}
function AccountCard({ onNavigate }: { onNavigate?: () => void }) {
  const { address, chainId } = useConnection();
  const { openWallet } = useUi();
  const auth = useBackendAuth();
  const router = useRouter();
  const profile = useProfile();
  const name = profile.data?.profile.display_name?.trim();
  const onNetwork = chainId === localChain.id;
  return (
    <div className="account-card" aria-label="Signed-in account">
      <div className="account-row">
        <span className="avatar" aria-hidden="true">
          {initials(name, address)}
        </span>
        <div className="min-w-0">
          <span className="account-name">
            {name || (address ? shortenAddress(address) : "Wallet")}
          </span>
          <span className="account-meta">
            <span className={`net-dot ${onNetwork ? "" : "warn"}`} />
            {walletNetwork(chainId)}
          </span>
        </div>
      </div>
      <div className="account-actions">
        <Button
          variant="secondary"
          size="sm"
          aria-label="Manage wallet"
          onClick={() => {
            onNavigate?.();
            openWallet();
          }}
        >
          Wallet
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={auth.busy}
          onClick={async () => {
            onNavigate?.();
            await auth.logout();
            router.replace("/sign-in");
          }}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <Navigation onNavigate={onNavigate} />
      <div className="sidebar-bottom">
        <AccountCard onNavigate={onNavigate} />
        <p className="dev-badge">Local network · MockUSD has no real value</p>
      </div>
    </>
  );
}
/** One place for network/deployment problems instead of repeating them per page. */
export function DeploymentNotice() {
  const deployment = useVerifiedDeployment();
  if (!deployment.isConnected) return null;
  if (!deployment.supported)
    return (
      <Notice tone="warning" title="Wrong network" className="global-notice">
        <p>
          Your wallet is on {walletNetwork(deployment.chainId)}. Reads and
          transactions are paused until you switch.
        </p>
        <div className="mt-2">
          <SwitchNetworkButton />
        </div>
      </Notice>
    );
  if (deployment.isError) {
    const error = describeError(deployment.error);
    return (
      <Notice
        tone="danger"
        role="alert"
        label="Deployment setup"
        className="global-notice"
        title={
          error.kind === "deployment"
            ? "Local setup required"
            : "Local blockchain unavailable"
        }
      >
        <p>{error.message}</p>
        <div className="mt-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void deployment.refetch()}
          >
            Retry verification
          </Button>
        </div>
      </Notice>
    );
  }
  if (!deployment.readable)
    return (
      <p role="status" className="small text-muted global-notice">
        Verifying the local network and contracts…
      </p>
    );
  return null;
}
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobile, setMobile] = useState(false);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo />
        </div>
        <SidebarContent />
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="topbar-start">
            <Button
              className="icon-button"
              variant="ghost"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </Button>
            <Logo />
          </div>
        </header>
        <main id="main" className="app-main">
          <DeploymentNotice />
          {children}
          <footer className="app-footer">
            TrustLayer · Development network. MockUSD has no monetary value.
          </footer>
        </main>
      </div>
      <Dialog
        open={mobile}
        onClose={() => setMobile(false)}
        title="Navigation"
        drawer
      >
        {mobile && <SidebarContent onNavigate={() => setMobile(false)} />}
      </Dialog>
    </div>
  );
}
