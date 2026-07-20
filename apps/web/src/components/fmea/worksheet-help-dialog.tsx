"use client";

import { useId } from "react";

import { ModalDialog } from "@/components/ui/modal-dialog";

type WorksheetHelpDialogProps = {
  onClose: () => void;
};

const shortcuts = [
  ["Tab / Shift+Tab", "Navigate between editable cells"],
  ["Ctrl+S / Cmd+S", "Save analysis data"],
  ["Ctrl+A / Cmd+A", "Select all visible rows"],
  ["Ctrl+Click / Cmd+Click", "Add or remove a row from the current selection"],
  ["Delete", "Delete selected rows after confirmation"],
  ["Ctrl+H / Ctrl+?", "Open help"],
  ["Escape", "Close dialogs, dropdowns, or the current selection"],
] as const;

const fields = [
  ["Component", "Physical engineering part or subsystem being analyzed"],
  ["Function", "Intended function the component must perform"],
  ["Failure Mode", "How the component or function can fail"],
  ["Effect", "Consequence if the failure mode occurs"],
  ["Severity (S)", "Engineer input: 1 is minor, 10 is hazardous or catastrophic"],
  ["Cause", "Why the failure occurs"],
  ["Occurrence (O)", "Engineer input: 1 is rare, 10 is frequent"],
  ["Controls", "Existing prevention, detection, inspection, design, or maintenance control"],
  ["Detection (D)", "Engineer input: 1 is easily detected before harm, 10 is unlikely to be detected"],
  ["RPN", "Severity × Occurrence × Detection; calculated only after all three inputs are set"],
  ["Action", "Recommended action to reduce risk or correct a confirmed issue"],
  ["Evidence", "Field-level claims, exact source spans, confidence, and citations"],
  ["Status", "Human review state for this row"],
] as const;

const statuses = [
  ["Needs Review", "Row requires engineer review and validation"],
  ["Edited", "Accepted content changed and must be reviewed again"],
  ["Accepted", "Row has been reviewed and validated"],
  ["Rejected", "Row has been reviewed and rejected"],
] as const;

function HelpList({ entries }: { entries: ReadonlyArray<readonly [string, string]> }) {
  return (
    <ul className="source-list">
      {entries.map(([label, description]) => (
        <li key={label}><strong>{label}</strong><span>{description}</span></li>
      ))}
    </ul>
  );
}

export function WorksheetHelpDialog({ onClose }: WorksheetHelpDialogProps) {
  const titleId = useId();

  return (
    <ModalDialog ariaLabelledBy={titleId} closeLabel="Close help" onClose={onClose}>
        <span className="metric-label">Help</span>
        <h2 id={titleId}>Keyboard shortcuts and worksheet help</h2>
        <HelpList entries={shortcuts} />
        <h3>Worksheet fields</h3>
        <HelpList entries={fields} />
        <h3>Row status</h3>
        <HelpList entries={statuses} />
    </ModalDialog>
  );
}
