import Link from "next/link";

import { AuthControls } from "@/components/auth/auth-controls";

export function Wordmark() {
  return (
    <span className="wordmark">
      r<span className="wm-i">ı</span>sk on radar<span className="wm-dot">.</span>
    </span>
  );
}

export function AppNav() {
  return (
    <nav className="nav app-nav" aria-label="Primary navigation">
      <div className="nav-container">
        <Link
          href="/"
          className="nav-brand"
          aria-label="Risk on Radar app home"
        >
          <Wordmark />
        </Link>

        <div className="nav-actions">
          <Link className="nav-link" href="/">
            Home
          </Link>
          <Link className="nav-link" href="/dashboard">
            Dashboard
          </Link>
          <Link className="nav-link" href="/account">
            Account
          </Link>
          <Link className="nav-link" href="/pricing">
            Pricing
          </Link>
          <AuthControls />
        </div>
      </div>
    </nav>
  );
}
