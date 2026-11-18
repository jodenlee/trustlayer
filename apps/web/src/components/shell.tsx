"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  ChevronDown,
  CircleHelp,
  FlaskConical,
  Gavel,
  History,
  LayoutDashboard,
  Menu,
  Settings2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { usePreview } from "./providers";
import { Button } from "./ui";
import { Dialog } from "./dialog";

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="TrustLayer home">
      <span className="logo-mark">
        <ShieldCheck size={22} strokeWidth={1.8} aria-hidden="true" />
      </span>
      TrustLayer<span className="logo-period">.</span>
    </Link>
  );
}
const navigation = [
  { href: "/dashboard", title: "Overview", icon: LayoutDashboard },
  { href: "/projects", title: "Projects", icon: BriefcaseBusiness },
  { href: "/disputes", title: "Disputes", icon: Gavel },
  { href: "/juror", title: "Juror workspace", icon: ShieldCheck },
  { href: "/transactions", title: "Transactions", icon: History },
  { href: "/settings", title: "Settings", icon: Settings2 },
];
function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace navigation" className="workspace-nav">
      {navigation.map(({ href, title, icon: Icon }, index) => (
        <Link
          href={href}
          key={href}
          onClick={onNavigate}
          className={`nav-link ${index === 3 ? "nav-divider" : ""} ${pathname === href || pathname.startsWith(`${href}/`) ? "active" : ""}`}
          aria-current={
            pathname === href || pathname.startsWith(`${href}/`)
              ? "page"
              : undefined
          }
        >
          <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
          {title}
        </Link>
      ))}
    </nav>
  );
}
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="sidebar-logo">
        <Logo />
      </div>
      <div className="workspace-switch">
        <span className="workspace-avatar">TL</span>
        <div>
          <strong>TrustLayer workspace</strong>
          <span>Development preview</span>
        </div>
        <ChevronDown size={14} aria-hidden="true" />
      </div>
      <p className="nav-label">WORKSPACE</p>
      <Navigation onNavigate={onNavigate} />
      <div className="sidebar-bottom">
        <Link href="/#how-it-works" className="help-link">
          <CircleHelp size={18} aria-hidden="true" />
          How TrustLayer works
          <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
        <div className="local-badge">
          <span className="status-dot" />
          Local development<span>Phase 3A</span>
        </div>
      </div>
    </>
  );
}
export function WalletPlaceholder() {
  const { openWallet } = usePreview();
  return (
    <Button variant="secondary" onClick={openWallet}>
      <Wallet size={16} aria-hidden="true" />
      <span>Connect wallet</span>
    </Button>
  );
}
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobile, setMobile] = useState(false);
  const { sample, setSample, name } = usePreview();
  const pathname = usePathname();
  const section =
    navigation.find((item) => pathname.startsWith(item.href))?.title ??
    "Workspace";
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <SidebarContent />
      </aside>
      <div className="app-body">
        <header className="app-header">
          <div className="header-start">
            <Button
              className="mobile-menu icon-button"
              variant="ghost"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </Button>
            <span className="breadcrumb">
              Workspace <span>/</span> <strong>{section}</strong>
            </span>
          </div>
          <div className="header-actions">
            <span className="disconnected">
              <span className="status-dot" />
              Not connected
            </span>
            <WalletPlaceholder />
            <Link
              href="/settings"
              aria-label="Profile settings"
              className="profile-avatar"
            >
              {name
                .trim()
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
                .toUpperCase() || "TL"}
            </Link>
          </div>
        </header>
        <main id="main" className="app-main">
          <div className="preview-banner">
            <div>
              <FlaskConical size={16} aria-hidden="true" />
              <p>
                <strong>Interface preview</strong>
                <span>
                  {" "}
                  · {sample ? "Fictional sample data" : "Empty workspace"}. No
                  wallet connected.
                </span>
              </p>
            </div>
            <button
              className="preview-toggle"
              onClick={() => setSample(!sample)}
            >
              {sample ? "Show empty state" : "Show sample data"}
            </button>
          </div>
          {children}
          <footer className="app-footer">
            <span>TrustLayer · Built for work built on trust.</span>
            <span>MockUSD has no real monetary value.</span>
          </footer>
        </main>
      </div>
      <Dialog
        open={mobile}
        onClose={() => setMobile(false)}
        title="Navigation"
        drawer
      >
        <SidebarContent onNavigate={() => setMobile(false)} />
      </Dialog>
    </div>
  );
}
