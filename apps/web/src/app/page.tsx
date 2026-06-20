import Link from "next/link";

import { AuthControls } from "@/components/auth/auth-controls";

export default function Home() {
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <nav className="nav" aria-label="Primary navigation">
        <div className="nav-container">
          <Link href="/" className="nav-brand">
            <span className="wordmark">
              r<span className="wm-i">ı</span>sk on radar
              <span className="wm-dot">.</span>
            </span>
          </Link>

          <div className="nav-actions">
            <div className="language-selector">
              <button
                type="button"
                className="language-button"
                aria-haspopup="listbox"
                aria-expanded="false"
                aria-label="Select language"
                title="Select language"
              >
                <span className="language-flag" aria-hidden="true">
                  🇬🇧
                </span>
                <span>EN</span>
                <svg
                  viewBox="0 0 12 8"
                  fill="none"
                  className="language-chevron"
                  aria-hidden="true"
                >
                  <path
                    d="M1 1.5L6 6.5L11 1.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <div className="language-menu" role="listbox" aria-label="Select language">
                <button
                  type="button"
                  className="language-option"
                  role="option"
                  aria-selected="true"
                >
                  🇬🇧 English
                </button>
                <button
                  type="button"
                  className="language-option"
                  role="option"
                  aria-selected="false"
                >
                  🇳🇱 Nederlands
                </button>
                <button
                  type="button"
                  className="language-option"
                  role="option"
                  aria-selected="false"
                >
                  🇩🇪 Deutsch
                </button>
              </div>
            </div>
            <AuthControls />
          </div>
        </div>
      </nav>

      <main id="main-content" className="app-empty-main" />

      <footer className="footer">
        <div className="container">
          <div className="footer-inner">
            <span className="wordmark wordmark-light">
              r<span className="wm-i">ı</span>sk on radar
              <span className="wm-dot">.</span>
            </span>
            <div className="footer-links">
              <a
                href="https://riskonradar.com/whitepaper.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link"
              >
                <svg viewBox="0 0 16 16" fill="none" className="footer-link-icon">
                  <path
                    d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9 2v4h4M6 9h4M6 11.5h4"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
                Whitepaper
              </a>
              <a
                href="https://www.linkedin.com/company/riskonradar/"
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="footer-link-icon"
                >
                  <path d="M3.58 0C1.604 0 0 1.604 0 3.581v8.838C0 14.396 1.604 16 3.581 16h8.838C14.396 16 16 14.396 16 12.419V3.58C16 1.604 14.396 0 12.419 0H3.58zM5.2 6.4v6.4H3.2V6.4H5.2zm-1-3.2a1 1 0 110 2 1 1 0 010-2zM12.8 12.8h-2v-3.2c0-.8-.32-1.2-.96-1.2-.64 0-1.04.48-1.04 1.2v3.2h-2V6.4H8.8v.88c.32-.56.96-.88 1.68-.88C11.84 6.4 12.8 7.36 12.8 9.2v3.6z" />
                </svg>
                LinkedIn
              </a>
              <a href="mailto:contact@riskonradar.com" className="footer-link">
                <svg viewBox="0 0 16 16" fill="none" className="footer-link-icon">
                  <path
                    d="M2.5 4h11v8h-11V4z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M3 4.5L8 8l5-3.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                contact@riskonradar.com
              </a>
            </div>
            <p className="footer-copy">
              © 2026 Risk on Radar. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
