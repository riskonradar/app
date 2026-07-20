import React, { useState } from "react";
import { readFile } from "node:fs/promises";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AnalysisList } from "@/components/fmea/analysis-list";
import { WorksheetHelpDialog } from "@/components/fmea/worksheet-help-dialog";

function HelpDialogHarness() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>Open worksheet help</button>
      {isOpen ? <WorksheetHelpDialog onClose={() => setIsOpen(false)} /> : null}
    </>
  );
}

describe("frontend polish safeguards", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("worksheet help uses a labelled modal and restores trigger focus", async () => {
    render(<HelpDialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open worksheet help" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts and worksheet help",
    });
    expect(dialog).toHaveAttribute("open");

    const close = screen.getByRole("button", { name: "Close help" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.click(close);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  test("renaming a saved analysis never nests a form control inside a link", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        analyses: [{
          id: "analysis-1",
          name: "Bearing review",
          scope: "Bearing",
          rowCount: 3,
          componentCount: 1,
          includedCount: 2,
          highestRpn: 96,
          updatedAt: "18 Jul 2026",
        }],
      }),
    }));

    render(<AnalysisList />);
    await screen.findByText("Bearing review");
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    const renameInput = screen.getByRole("textbox", { name: "Rename Bearing review" });
    expect(renameInput.closest("a")).toBeNull();
    expect(renameInput).toHaveFocus();
  });

  test("navigation, billing, and account failure states retain their safety controls", async () => {
    const [nav, billingReturn, account, evidenceDrawer, styles] = await Promise.all([
      readFile("src/components/app-nav.tsx", "utf8"),
      readFile("src/app/billing/return/page.tsx", "utf8"),
      readFile("src/app/account/page.tsx", "utf8"),
      readFile("src/components/fmea/evidence-drawer.tsx", "utf8"),
      readFile("src/app/globals.css", "utf8"),
    ]);

    expect(nav).toContain('aria-current={isCurrent ? "page" : undefined}');
    expect(nav).toContain('aria-label="Risk on Radar product home"');
    expect(nav).toContain("aria-expanded={isMenuOpen}");
    expect(styles).toContain(".nav-actions.is-open");
    expect(styles).not.toContain("fonts.googleapis.com");
    expect(styles).not.toContain("::-webkit-scrollbar");
    expect(styles).not.toContain("will-change: transform");

    expect(billingReturn).toContain("MAX_STATUS_CHECKS");
    expect(billingReturn).toContain("AbortController");
    expect(billingReturn).toContain("clearTimeout");
    expect(billingReturn).toContain("Check again");

    expect(account).toContain("No plan or billing status is being assumed");
    expect(account).not.toContain('summary?.role ?? "Owner"');
    expect(account).not.toContain('summary?.organization.billing_status ?? "free"');

    expect(evidenceDrawer).toContain("inferenceRationale");
    expect(evidenceDrawer).toContain("classifierVersion");
    expect(evidenceDrawer).toContain("Accept claim");
    expect(evidenceDrawer).toContain("Reject claim");
  });
});
