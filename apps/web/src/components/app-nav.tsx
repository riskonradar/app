"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { AuthControls } from "@/components/auth/auth-controls";

const primaryLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/systems", label: "Systems" },
  { href: "/account", label: "Account" },
  { href: "/pricing", label: "Pricing" },
] as const;

export function Wordmark() {
  return (
    <span className="wordmark">
      r<span className="wm-i">ı</span>sk on radar<span className="wm-dot">.</span>
    </span>
  );
}

export function AppNav() {
  const pathname = usePathname() ?? "";
  const menuId = useId();
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const fmeaHasOwnSkipLink = pathname.startsWith("/fmea");

  useEffect(() => {
    if (!isMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsMenuOpen(false);
      menuToggleRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isMenuOpen]);

  return (
    <>
      {!fmeaHasOwnSkipLink ? (
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
      ) : null}
      <nav className="nav app-nav" aria-label="Primary navigation">
        <div className="nav-container">
          <Link
            href="/dashboard"
            className="nav-brand"
            aria-label="Risk on Radar product home"
          >
            <Wordmark />
          </Link>

          <button
            ref={menuToggleRef}
            className="nav-menu-toggle"
            type="button"
            aria-controls={menuId}
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <span className="visually-hidden">{isMenuOpen ? "Close" : "Open"} primary navigation</span>
            <span className="nav-menu-icon" aria-hidden="true" />
          </button>

          <div
            id={menuId}
            className={`nav-actions ${isMenuOpen ? "is-open" : ""}`}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) setIsMenuOpen(false);
            }}
          >
            {primaryLinks.map((link) => {
              const isCurrent = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  className="nav-link"
                  href={link.href}
                  aria-current={isCurrent ? "page" : undefined}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {link.label}
                </Link>
              );
            })}
            <AuthControls />
          </div>
        </div>
      </nav>
    </>
  );
}
