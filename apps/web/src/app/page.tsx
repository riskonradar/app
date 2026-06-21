"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { AuthControls } from "@/components/auth/auth-controls";
import fmeaData from "@/data/fmea-turbofan-data.json";
import severityReference from "@/data/fmea-severity-reference.json";
import occurrenceReference from "@/data/fmea-occurrence-reference.json";
import detectionReference from "@/data/fmea-detection-reference.json";
import propagationPaths from "@/data/turbofan-propagation-paths.json";

type Source = {
  title: string;
  year?: string;
  doi?: string;
  url?: string;
};

type EvidenceRow = {
  component: string;
  failureMode: string;
  effect: string;
  cause: string;
  severity: string;
  occurrence: string;
  detection: string;
  correctiveAction: string;
  rpn: string;
  evidenceCount: number;
  sources: Source[];
};

type FmeaRow = EvidenceRow & {
  id: string;
  function: string;
  requirement: string;
  currentControl: string;
  owner: string;
  status: "needs_review" | "accepted" | "rejected";
  included: boolean;
};

type SystemTemplate = {
  id: string;
  name: string;
  domain: string;
  source: string;
  description: string;
  components: string[];
};

const systemTemplates: SystemTemplate[] = [
  {
    id: "turbofan",
    name: "Turbofan engine",
    domain: "Aviation propulsion",
    source: `${fmeaData.recordCount} evidence records from papers + EASA; ${fmeaData.rowCount} merged FMEA rows`,
    description:
      "A preloaded reliability workspace built from the turbofan prototype corpus.",
    components: fmeaData.components as string[],
  },
  {
    id: "pump-train",
    name: "Centrifugal pump train",
    domain: "Process equipment",
    source: "Template system",
    description:
      "Starter structure for pump, seal, bearing, coupling, motor, and instrumentation FMEAs.",
    components: [
      "Pump casing",
      "Impeller",
      "Mechanical seal",
      "Shaft",
      "Bearing",
      "Coupling",
      "Electric motor",
      "Vibration sensor",
    ],
  },
  {
    id: "wind-drivetrain",
    name: "Wind turbine drivetrain",
    domain: "Renewable energy",
    source: "Template system",
    description:
      "Starter structure for gearbox, blade, bearing, generator, converter, brake, and tower interfaces.",
    components: [
      "Blade",
      "Pitch bearing",
      "Main shaft",
      "Main bearing",
      "Gearbox",
      "Generator",
      "Power converter",
      "Brake system",
    ],
  },
];

const defaultControls = [
  "Visual inspection",
  "Vibration monitoring",
  "Oil debris analysis",
  "Scheduled overhaul",
  "Borescope inspection",
  "Thermal trend monitoring",
];

const scoreOptions = Array.from({ length: 10 }, (_, index) => String(index + 1));

function makeRowId(row: Pick<FmeaRow, "component" | "failureMode">, index: number) {
  return `${row.component}-${row.failureMode}-${index}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

function toFmeaRows(rows: EvidenceRow[]): FmeaRow[] {
  return rows.map((row, index) => ({
    ...row,
    id: makeRowId(row, index),
    function: functionForComponent(row.component),
    requirement: "Maintain intended system function under defined operating conditions",
    currentControl: row.correctiveAction || defaultControls[index % defaultControls.length],
    owner: "",
    status: "needs_review",
    included: true,
  }));
}

function functionForComponent(component: string) {
  const lower = component.toLowerCase();
  if (lower.includes("bearing")) return "Support rotating load with controlled friction";
  if (lower.includes("blade") || lower.includes("fan")) return "Convert shaft power into controlled airflow";
  if (lower.includes("compressor")) return "Increase working-fluid pressure for combustion";
  if (lower.includes("turbine")) return "Extract gas-path energy into shaft power";
  if (lower.includes("shaft")) return "Transmit torque across rotating assemblies";
  if (lower.includes("gear")) return "Transfer speed and torque through accessory drives";
  if (lower.includes("seal")) return "Contain fluid and isolate pressure boundaries";
  return `Perform ${component.toLowerCase()} function`;
}

function templateRowsForComponents(components: string[]): FmeaRow[] {
  const failureModes = [
    "Fatigue cracking",
    "Wear / material loss",
    "Corrosion / pitting",
    "Loss of alignment",
    "Thermal degradation",
  ];

  return components.flatMap((component, componentIndex) =>
    failureModes.slice(0, 3).map((failureMode, failureIndex) => {
      const index = componentIndex * 3 + failureIndex;
      return {
        id: makeRowId({ component, failureMode }, index),
        component,
        function: functionForComponent(component),
        requirement: "Define requirement",
        failureMode,
        effect: "",
        cause: "",
        severity: "",
        occurrence: "",
        detection: "",
        correctiveAction: "",
        currentControl: defaultControls[index % defaultControls.length],
        owner: "",
        status: "needs_review" as const,
        included: true,
        rpn: "",
        evidenceCount: 0,
        sources: [],
      };
    }),
  );
}

function parseBom(text: string) {
  return Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.split(/,|\t|;/)[0]?.trim())
        .filter((item) => item && !/^(part|component|item|bom|name)$/i.test(item))
        .slice(0, 18),
    ),
  );
}

function csvEscape(value: string | number | undefined) {
  const stringValue = String(value ?? "");
  if (!/[",\n]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function htmlEscape(value: string | number | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadFile(filename: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function rowRpn(row: FmeaRow) {
  const s = Number(row.severity);
  const o = Number(row.occurrence);
  const d = Number(row.detection);
  if (!s || !o || !d) return "";
  return String(s * o * d);
}

function isComplete(row: FmeaRow) {
  if (!row.included) return true;
  return Boolean(
    row.component &&
      row.function &&
      row.failureMode &&
      row.effect &&
      row.cause &&
      row.severity &&
      row.occurrence &&
      row.detection &&
      row.currentControl,
  );
}

function buildCsv(rows: FmeaRow[]) {
  const headers = [
    "Included",
    "Component",
    "Function",
    "Requirement",
    "Failure mode",
    "Effect",
    "Severity",
    "Cause",
    "Occurrence",
    "Current controls",
    "Detection",
    "RPN",
    "Recommended action",
    "Owner",
    "Review status",
    "Evidence count",
    "Sources",
  ];

  const body = rows.map((row) => [
    row.included ? "Yes" : "No",
    row.component,
    row.function,
    row.requirement,
    row.failureMode,
    row.effect,
    row.severity,
    row.cause,
    row.occurrence,
    row.currentControl,
    row.detection,
    rowRpn(row),
    row.correctiveAction,
    row.owner,
    row.status,
    row.evidenceCount,
    row.sources.map((source) => source.doi || source.title).join("; "),
  ]);

  return [headers, ...body]
    .map((line) => line.map((cell) => csvEscape(cell)).join(","))
    .join("\n");
}

function buildExcelHtml(rows: FmeaRow[]) {
  const headers = [
    "Included",
    "Component",
    "Function",
    "Requirement",
    "Failure mode",
    "Effect",
    "Severity",
    "Cause",
    "Occurrence",
    "Current controls",
    "Detection",
    "RPN",
    "Recommended action",
    "Owner",
    "Review status",
    "Evidence count",
    "Sources",
  ];
  const body = rows.map((row) => [
    row.included ? "Yes" : "No",
    row.component,
    row.function,
    row.requirement,
    row.failureMode,
    row.effect,
    row.severity,
    row.cause,
    row.occurrence,
    row.currentControl,
    row.detection,
    rowRpn(row),
    row.correctiveAction,
    row.owner,
    row.status,
    row.evidenceCount,
    row.sources.map((source) => source.doi || source.title).join("; "),
  ]);

  return `<!doctype html><html><head><meta charset="utf-8" /></head><body><table>${[
    headers,
    ...body,
  ]
    .map((line) => `<tr>${line.map((cell) => `<td>${htmlEscape(cell)}</td>`).join("")}</tr>`)
    .join("")}</table></body></html>`;
}

function Wordmark() {
  return (
    <span className="wordmark">
      r<span className="wm-i">ı</span>sk on radar<span className="wm-dot">.</span>
    </span>
  );
}

function ScoreSelect({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="score-select"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">-</option>
      {scoreOptions.map((score) => (
        <option key={score} value={score}>
          {score}
        </option>
      ))}
    </select>
  );
}

function EditableCell({
  value,
  placeholder,
  onChange,
  className = "",
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <textarea
      className={`cell-input ${className}`}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      rows={2}
    />
  );
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeSystemId, setActiveSystemId] = useState("turbofan");
  const [rows, setRows] = useState<FmeaRow[]>(() => toFmeaRows(fmeaData.rows as EvidenceRow[]));
  const [componentFilter, setComponentFilter] = useState("All");
  const [evidenceFilter, setEvidenceFilter] = useState("all");
  const [selectedSourceRow, setSelectedSourceRow] = useState<FmeaRow | null>(null);
  const [paymentState, setPaymentState] = useState<"idle" | "loading" | "error">("idle");
  const [notice, setNotice] = useState("Free tier: 1 saved FMEA. Upgrade for unlimited saved worksheets.");
  const components = useMemo(
    () => Array.from(new Set(rows.map((row) => row.component))).sort(),
    [rows],
  );
  const activeSystem =
    systemTemplates.find((system) => system.id === activeSystemId) ??
    ({
      id: "custom",
      name: "Custom BOM system",
      domain: "Uploaded BOM",
      source: `${rows.length} draft rows from imported components`,
      description:
        "A local draft created from the uploaded BOM. Use the worksheet to complete and review required fields.",
      components,
    } satisfies SystemTemplate);

  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        if (componentFilter !== "All" && row.component !== componentFilter) return false;
        if (evidenceFilter === "evidence" && row.evidenceCount === 0) return false;
        if (evidenceFilter === "incomplete" && isComplete(row)) return false;
        if (evidenceFilter === "included" && !row.included) return false;
        return true;
      }),
    [componentFilter, evidenceFilter, rows],
  );

  const includedRows = rows.filter((row) => row.included);
  const incompleteRows = includedRows.filter((row) => !isComplete(row));
  const completionPercent = includedRows.length
    ? Math.round(((includedRows.length - incompleteRows.length) / includedRows.length) * 100)
    : 0;
  const evidenceBackedRows = includedRows.filter((row) => row.evidenceCount > 0).length;
  const totalEvidenceRecords =
    activeSystemId === "turbofan" ? Number(fmeaData.recordCount ?? 0) : rows.length;
  const mergedFmeaRows =
    activeSystemId === "turbofan" ? Number(fmeaData.rowCount ?? includedRows.length) : includedRows.length;
  const canExport = includedRows.length > 0 && incompleteRows.length === 0;

  function updateRow(id: string, update: Partial<FmeaRow>) {
    setRows((currentRows) =>
      currentRows.map((row) => (row.id === id ? { ...row, ...update } : row)),
    );
  }

  function loadSystem(systemId: string) {
    const nextSystem = systemTemplates.find((system) => system.id === systemId);
    if (!nextSystem) return;
    setActiveSystemId(systemId);
    setComponentFilter("All");
    if (systemId === "turbofan") {
      setRows(toFmeaRows(fmeaData.rows as EvidenceRow[]));
    } else {
      setRows(templateRowsForComponents(nextSystem.components));
    }
  }

  async function handleBomUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const componentsFromBom = parseBom(text);
    if (!componentsFromBom.length) {
      setNotice("Could not detect components from that BOM. Try CSV, TSV, or one component per line.");
      return;
    }
    setActiveSystemId("custom");
    setComponentFilter("All");
    setRows(templateRowsForComponents(componentsFromBom));
    setNotice(`Created a draft FMEA from ${componentsFromBom.length} BOM components. Review each required field before export.`);
  }

  function exportCsv() {
    if (!canExport) return;
    downloadFile("risk-on-radar-fmea.csv", "text/csv;charset=utf-8", buildCsv(includedRows));
  }

  function exportExcel() {
    if (!canExport) return;
    downloadFile(
      "risk-on-radar-fmea.xls",
      "application/vnd.ms-excel;charset=utf-8",
      buildExcelHtml(includedRows),
    );
  }

  async function upgradePlan() {
    setPaymentState("loading");
    setNotice("Opening Mollie checkout...");
    try {
      const response = await fetch("/api/billing/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountValue: "49.00",
          description: "Risk on Radar unlimited FMEA workspace",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        checkoutUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.checkoutUrl) {
        throw new Error(payload.error || "Payment checkout is not available yet.");
      }
      window.location.href = payload.checkoutUrl;
    } catch (error) {
      setPaymentState("error");
      setNotice(error instanceof Error ? error.message : "Could not open Mollie checkout.");
    }
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <nav className="nav app-nav" aria-label="Primary navigation">
        <div className="nav-container">
          <Link href="/" className="nav-brand" aria-label="Risk on Radar app home">
            <Wordmark />
          </Link>

          <div className="nav-actions">
            <a className="nav-link" href="#builder">
              Builder
            </a>
            <a className="nav-link" href="#worksheet">
              Worksheet
            </a>
            <a className="nav-link" href="#saved-workflows">
              Dashboard
            </a>
            <AuthControls />
          </div>
        </div>
      </nav>

      <main id="main-content" className="app-main">
        <section className="builder-hero" id="builder">
          <div className="hero-copy">
            <h1>Build an evidence-backed FMEA worksheet.</h1>
            <p>
              Select a system, import a BOM, review failure evidence, complete S/O/D scoring,
              and export a traceable spreadsheet for engineering review.
            </p>
          </div>

          <div className="run-strip" aria-label="FMEA status">
            <div>
              <span className="metric-label">Completion</span>
              <strong>{completionPercent}%</strong>
            </div>
            <div>
              <span className="metric-label">Evidence records</span>
              <strong>{totalEvidenceRecords}</strong>
            </div>
            <div>
              <span className="metric-label">Merged FMEA rows</span>
              <strong>{mergedFmeaRows}</strong>
            </div>
            <div>
              <span className="metric-label">Open fields</span>
              <strong>{incompleteRows.length}</strong>
            </div>
          </div>
        </section>

        <section className="builder-layout">
          <aside className="left-rail" aria-label="FMEA setup">
            <section className="panel">
              <div className="panel-heading">
                <span className="metric-label">System</span>
                <strong>{activeSystem.name}</strong>
              </div>
              <div className="system-options">
                {systemTemplates.map((system) => (
                  <button
                    type="button"
                    key={system.id}
                    className={`system-option ${activeSystemId === system.id ? "active" : ""}`}
                    onClick={() => loadSystem(system.id)}
                  >
                    <span>{system.name}</span>
                    <small>{system.domain}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <span className="metric-label">BOM import</span>
                <strong>Upload system parts</strong>
              </div>
              <p className="rail-copy">
                Upload CSV, TSV, or a simple parts list. The prototype extracts component names
                locally and drafts starter rows for review.
              </p>
              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleBomUpload}
              />
              <button className="btn btn-secondary btn-full" type="button" onClick={() => fileInputRef.current?.click()}>
                Upload BOM
              </button>
            </section>

            <section className="panel plan-panel">
              <div className="panel-heading">
                <span className="metric-label">Plan</span>
                <strong>Free tier</strong>
              </div>
              <div className="usage-bar" aria-hidden="true">
                <span />
              </div>
              <p className="rail-copy">1 saved FMEA available. Paid tier unlocks unlimited saved FMEAs.</p>
              <button
                className="btn btn-primary btn-full"
                type="button"
                onClick={upgradePlan}
                disabled={paymentState === "loading"}
              >
                {paymentState === "loading" ? "Opening checkout" : "Upgrade with Mollie"}
              </button>
            </section>
          </aside>

          <section className="workspace-panel">
            <div className="workspace-toolbar">
              <div>
                <span className="metric-label">{activeSystem.source}</span>
                <h2>{activeSystem.name}</h2>
                <p>{activeSystem.description}</p>
              </div>
              <div className="toolbar-actions">
                <select
                  value={componentFilter}
                  onChange={(event) => setComponentFilter(event.target.value)}
                  aria-label="Filter by component"
                >
                  <option value="All">All components</option>
                  {components.map((component) => (
                    <option key={component} value={component}>
                      {component}
                    </option>
                  ))}
                </select>
                <select
                  value={evidenceFilter}
                  onChange={(event) => setEvidenceFilter(event.target.value)}
                  aria-label="Filter rows"
                >
                  <option value="all">All rows</option>
                  <option value="included">Included only</option>
                  <option value="evidence">Evidence-backed</option>
                  <option value="incomplete">Incomplete</option>
                </select>
              </div>
            </div>

            <div className={`completion-banner ${canExport ? "ready" : "blocked"}`} role="status">
              <div>
                <strong>{canExport ? "Ready to export" : "Worksheet incomplete"}</strong>
                <span>
                  {canExport
                    ? "All included rows have required FMEA fields."
                    : `${incompleteRows.length} included row${incompleteRows.length === 1 ? "" : "s"} still need function, effect, cause, controls, or S/O/D scores.`}
                </span>
              </div>
              <div className="export-actions">
                <button className="btn btn-secondary btn-sm" type="button" onClick={exportCsv} disabled={!canExport}>
                  Export CSV
                </button>
                <button className="btn btn-primary btn-sm" type="button" onClick={exportExcel} disabled={!canExport}>
                  Export Excel
                </button>
              </div>
            </div>

            <p className={`notice ${paymentState === "error" ? "error" : ""}`}>{notice}</p>

            <div className="component-map" aria-label="System components">
              {components.map((component) => {
                const count = rows.filter((row) => row.component === component).length;
                return (
                  <button
                    type="button"
                    key={component}
                    className={`component-chip ${componentFilter === component ? "active" : ""}`}
                    onClick={() => setComponentFilter(componentFilter === component ? "All" : component)}
                  >
                    <span>{component}</span>
                    <small>{count}</small>
                  </button>
                );
              })}
            </div>

            <div className="table-shell" id="worksheet">
              <table className="fmea-table">
                <thead>
                  <tr>
                    <th>Use</th>
                    <th>Component / function</th>
                    <th>Requirement</th>
                    <th>Failure mode</th>
                    <th>Effect</th>
                    <th>S</th>
                    <th>Cause</th>
                    <th>O</th>
                    <th>Controls</th>
                    <th>D</th>
                    <th>RPN</th>
                    <th>Action / evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const complete = isComplete(row);
                    return (
                      <tr key={row.id} className={!complete ? "row-incomplete" : ""}>
                        <td>
                          <input
                            type="checkbox"
                            checked={row.included}
                            aria-label={`Include ${row.component} ${row.failureMode}`}
                            onChange={(event) => updateRow(row.id, { included: event.target.checked })}
                          />
                        </td>
                        <td className="component-cell">
                          <strong>{row.component}</strong>
                          <EditableCell
                            value={row.function}
                            placeholder="Function"
                            onChange={(value) => updateRow(row.id, { function: value })}
                          />
                        </td>
                        <td>
                          <EditableCell
                            value={row.requirement}
                            placeholder="Requirement"
                            onChange={(value) => updateRow(row.id, { requirement: value })}
                          />
                        </td>
                        <td>
                          <EditableCell
                            value={row.failureMode}
                            placeholder="Failure mode"
                            onChange={(value) => updateRow(row.id, { failureMode: value })}
                          />
                        </td>
                        <td>
                          <EditableCell
                            value={row.effect}
                            placeholder="Effect required"
                            onChange={(value) => updateRow(row.id, { effect: value })}
                          />
                        </td>
                        <td>
                          <ScoreSelect
                            label={`Severity for ${row.failureMode}`}
                            value={row.severity}
                            onChange={(value) => updateRow(row.id, { severity: value })}
                          />
                        </td>
                        <td>
                          <EditableCell
                            value={row.cause}
                            placeholder="Cause required"
                            onChange={(value) => updateRow(row.id, { cause: value })}
                          />
                        </td>
                        <td>
                          <ScoreSelect
                            label={`Occurrence for ${row.failureMode}`}
                            value={row.occurrence}
                            onChange={(value) => updateRow(row.id, { occurrence: value })}
                          />
                        </td>
                        <td>
                          <EditableCell
                            value={row.currentControl}
                            placeholder="Current control"
                            onChange={(value) => updateRow(row.id, { currentControl: value })}
                          />
                        </td>
                        <td>
                          <ScoreSelect
                            label={`Detection for ${row.failureMode}`}
                            value={row.detection}
                            onChange={(value) => updateRow(row.id, { detection: value })}
                          />
                        </td>
                        <td className="rpn-cell">{rowRpn(row) || "-"}</td>
                        <td className="action-cell">
                          <EditableCell
                            value={row.correctiveAction}
                            placeholder="Recommended action"
                            onChange={(value) => updateRow(row.id, { correctiveAction: value })}
                          />
                          <div className="row-actions">
                            <select
                              value={row.status}
                              aria-label={`Review status for ${row.failureMode}`}
                              onChange={(event) =>
                                updateRow(row.id, { status: event.target.value as FmeaRow["status"] })
                              }
                            >
                              <option value="needs_review">Needs review</option>
                              <option value="accepted">Accepted</option>
                              <option value="rejected">Rejected</option>
                            </select>
                            <button
                              type="button"
                              className="evidence-link"
                              onClick={() => setSelectedSourceRow(row)}
                              disabled={!row.sources.length}
                            >
                              {row.evidenceCount ? `${row.evidenceCount} sources` : "No source"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!visibleRows.length && <p className="empty-state">No rows match the current filters.</p>}
            </div>
          </section>
        </section>

        <section className="reference-section" aria-label="Scoring references">
          <details className="reference-disclosure">
            <summary>severity guide score</summary>
            <div className="reference-table-wrap">
              <table className="reference-table severity-guide-table">
                <thead>
                  <tr>
                    <th>S</th>
                    <th>Class</th>
                    <th>System effect</th>
                  </tr>
                </thead>
                <tbody>
                  {severityReference.map((item) => (
                    <tr key={item.score}>
                      <td>{item.score}</td>
                      <td>{item.classification}</td>
                      <td>{item.systemEffect}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <details className="reference-disclosure">
            <summary>occurrence guide score</summary>
            <p className="reference-description">
              Proposed O uses weighted evidence count plus a cause modifier. EASA AD records count as
              2 evidence points, journal papers count as 1. Recurring degradation causes can add 1;
              event-dependent causes such as bird strike, FOD, or maintenance error can subtract 1.
            </p>
            <div className="reference-table-wrap">
              <table className="reference-table occurrence-guide-table">
                <thead>
                  <tr>
                    <th>O</th>
                    <th>Likelihood</th>
                    <th>Weighted evidence</th>
                    <th>Guidance</th>
                  </tr>
                </thead>
                <tbody>
                  {occurrenceReference.map((item) => (
                    <tr key={item.score}>
                      <td>{item.score}</td>
                      <td>{item.likelihood}</td>
                      <td>{item.weightedEvidence}</td>
                      <td>{item.scoringGuidance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <details className="reference-disclosure">
            <summary>detection guide score</summary>
            <p className="reference-description">
              Proposed D starts at 6. Clear inspection or monitoring terms subtract 2. EASA source
              titles with inspection, check, test, or replacement subtract 1. Internal or latent
              causes add 1. Sudden, event-dependent, or hard-to-predict failures add 2. The final
              value is clamped from 1 to 10.
            </p>
            <div className="reference-table-wrap">
              <table className="reference-table detection-guide-table">
                <thead>
                  <tr>
                    <th>D</th>
                    <th>Detectability</th>
                    <th>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {detectionReference.map((item) => (
                    <tr key={item.score}>
                      <td>{item.score}</td>
                      <td>{item.detectability}</td>
                      <td>{item.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <details className="reference-disclosure">
            <summary>propagation paths</summary>
            <div className="reference-table-wrap">
              <table className="reference-table propagation-table">
                <thead>
                  <tr>
                    <th>Cause</th>
                    <th>Component failure</th>
                    <th>Local effect</th>
                    <th>Engine effect</th>
                    <th>Mission consequence</th>
                    <th>S</th>
                  </tr>
                </thead>
                <tbody>
                  {propagationPaths.map((path) => (
                    <tr key={`${path.cause}-${path.componentFailure}`}>
                      <td>{path.cause}</td>
                      <td>{path.componentFailure}</td>
                      <td>{path.localEffect}</td>
                      <td>{path.engineEffect}</td>
                      <td>{path.aircraftMissionConsequence}</td>
                      <td>{path.suggestedSeverity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section className="save-note" id="saved-workflows" aria-label="Dashboard preview">
          <div>
            <span className="metric-label">Dashboard later</span>
            <h2>Saved FMEAs will live in the dashboard.</h2>
          </div>
          <p>
            For now this page focuses on creating and exporting one worksheet. The dashboard will
            handle saved projects, edit history, and paid plan limits.
          </p>
        </section>
      </main>

      {selectedSourceRow && (
        <div className="source-dialog-backdrop" role="presentation" onClick={() => setSelectedSourceRow(null)}>
          <section
            className="source-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Evidence sources"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="dialog-close" type="button" aria-label="Close" onClick={() => setSelectedSourceRow(null)}>
              ×
            </button>
            <span className="metric-label">Evidence</span>
            <h3>
              {selectedSourceRow.component} · {selectedSourceRow.failureMode}
            </h3>
            <p>
              Source-linked evidence remains review-required until an engineer accepts the row.
            </p>
            <ul className="source-list">
              {selectedSourceRow.sources.map((source) => (
                <li key={[source.doi, source.title].filter(Boolean).join("|")}>
                  <strong>{source.title}</strong>
                  <span>
                    {source.doi ? `DOI: ${source.doi}` : source.url || "Source record"}
                    {source.year ? ` · ${source.year}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <footer className="footer">
        <div className="container">
          <div className="footer-inner">
            <span className="wordmark wordmark-light">
              r<span className="wm-i">ı</span>sk on radar<span className="wm-dot">.</span>
            </span>
            <div className="footer-links">
              <a href="https://riskonradar.com/whitepaper.pdf" target="_blank" rel="noopener noreferrer" className="footer-link">
                Whitepaper
              </a>
              <a href="https://www.linkedin.com/company/riskonradar/" target="_blank" rel="noopener noreferrer" className="footer-link">
                LinkedIn
              </a>
              <a href="mailto:contact@riskonradar.com" className="footer-link">
                contact@riskonradar.com
              </a>
            </div>
            <p className="footer-copy">© 2026 Risk on Radar. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
