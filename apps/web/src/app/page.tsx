"use client";

import { RevoGrid } from "@revolist/react-datagrid";
import type { AfterEditEvent, ColumnRegular, RevoGridCustomEvent } from "@revolist/react-datagrid";
import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { AppNav } from "@/components/app-nav";
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

type GridRow = {
  id: string;
  included: string;
  component: string;
  function: string;
  requirement: string;
  failureMode: string;
  effect: string;
  severity: string;
  cause: string;
  occurrence: string;
  currentControl: string;
  detection: string;
  rpn: string;
  correctiveAction: string;
  owner: string;
  status: FmeaRow["status"];
  evidenceCount: number;
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
const gridColumns: ColumnRegular[] = [
  { prop: "included", name: "Use", size: 72, pin: "colPinStart" },
  { prop: "component", name: "Component", size: 230, pin: "colPinStart", readonly: true },
  { prop: "function", name: "Function", size: 260 },
  { prop: "requirement", name: "Requirement", size: 310 },
  { prop: "failureMode", name: "Failure mode", size: 230 },
  { prop: "effect", name: "Effect", size: 290 },
  { prop: "severity", name: "S", size: 70 },
  { prop: "cause", name: "Cause", size: 280 },
  { prop: "occurrence", name: "O", size: 70 },
  { prop: "currentControl", name: "Controls", size: 260 },
  { prop: "detection", name: "D", size: 70 },
  { prop: "rpn", name: "RPN", size: 82, readonly: true },
  { prop: "correctiveAction", name: "Recommended action", size: 290 },
  { prop: "owner", name: "Owner", size: 150 },
  { prop: "status", name: "Review status", size: 160 },
  { prop: "evidenceCount", name: "Sources", size: 100, readonly: true },
];

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

function toGridRow(row: FmeaRow): GridRow {
  return {
    id: row.id,
    included: row.included ? "Yes" : "No",
    component: row.component,
    function: row.function,
    requirement: row.requirement,
    failureMode: row.failureMode,
    effect: row.effect,
    severity: row.severity,
    cause: row.cause,
    occurrence: row.occurrence,
    currentControl: row.currentControl,
    detection: row.detection,
    rpn: rowRpn(row),
    correctiveAction: row.correctiveAction,
    owner: row.owner,
    status: row.status,
    evidenceCount: row.evidenceCount,
  };
}

function gridRowToUpdate(row: GridRow): Partial<FmeaRow> {
  return {
    included: /^y|true|1$/i.test(String(row.included).trim()),
    function: String(row.function ?? ""),
    requirement: String(row.requirement ?? ""),
    failureMode: String(row.failureMode ?? ""),
    effect: String(row.effect ?? ""),
    severity: scoreOptions.includes(String(row.severity ?? "")) ? String(row.severity) : "",
    cause: String(row.cause ?? ""),
    occurrence: scoreOptions.includes(String(row.occurrence ?? "")) ? String(row.occurrence) : "",
    currentControl: String(row.currentControl ?? ""),
    detection: scoreOptions.includes(String(row.detection ?? "")) ? String(row.detection) : "",
    correctiveAction: String(row.correctiveAction ?? ""),
    owner: String(row.owner ?? ""),
    status: ["needs_review", "accepted", "rejected"].includes(String(row.status))
      ? row.status
      : "needs_review",
  };
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

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeSystemId, setActiveSystemId] = useState("turbofan");
  const [rows, setRows] = useState<FmeaRow[]>(() => toFmeaRows(fmeaData.rows as EvidenceRow[]));
  const [componentFilter, setComponentFilter] = useState("All");
  const [rowFilter, setRowFilter] = useState("with_effect");
  const [componentQuery, setComponentQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selectedSourceRow, setSelectedSourceRow] = useState<FmeaRow | null>(null);
  const [notice, setNotice] = useState("Start with the turbofan evidence set, upload a BOM, or choose components to narrow the worksheet.");
  const components = useMemo(
    () => Array.from(new Set(rows.map((row) => row.component))).sort(),
    [rows],
  );
  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        const query = componentQuery.trim().toLowerCase();
        if (componentFilter !== "All" && row.component !== componentFilter) return false;
        if (
          query &&
          ![row.component, row.failureMode, row.effect, row.cause]
            .join(" ")
            .toLowerCase()
            .includes(query)
        ) {
          return false;
        }
        if (rowFilter === "with_effect" && !row.effect.trim()) return false;
        if (rowFilter === "missing_effect" && row.effect.trim()) return false;
        if (rowFilter === "evidence" && row.evidenceCount === 0) return false;
        if (rowFilter === "incomplete" && isComplete(row)) return false;
        if (rowFilter === "included" && !row.included) return false;
        return true;
      }),
    [componentFilter, componentQuery, rowFilter, rows],
  );

  const includedRows = rows.filter((row) => row.included);
  const incompleteRows = includedRows.filter((row) => !isComplete(row));
  const rowsMissingEffect = rows.filter((row) => !row.effect.trim()).length;
  const canExport = includedRows.length > 0 && incompleteRows.length === 0;
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const currentPage = Math.min(pageIndex, totalPages - 1);
  const pageStart = currentPage * pageSize;
  const pageRows = visibleRows.slice(pageStart, pageStart + pageSize);
  const gridRows = useMemo(() => pageRows.map(toGridRow), [pageRows]);
  const editStepState = rows.length ? "active" : "pending";
  const exportStepState = canExport ? "active" : "pending";

  function updateRow(id: string, update: Partial<FmeaRow>) {
    setRows((currentRows) =>
      currentRows.map((row) => (row.id === id ? { ...row, ...update } : row)),
    );
  }

  function applyGridRow(row: GridRow) {
    updateRow(row.id, gridRowToUpdate(row));
  }

  function handleGridEdit(event: RevoGridCustomEvent<AfterEditEvent>) {
    const detail = event.detail as
      | { data: Record<number, GridRow> }
      | { model?: GridRow; prop?: keyof GridRow; val?: unknown };

    if ("data" in detail) {
      Object.values(detail.data).forEach((row) => {
        if (row?.id) applyGridRow(row);
      });
      return;
    }

    if (detail.model?.id) {
      applyGridRow({ ...detail.model, [String(detail.prop)]: detail.val } as GridRow);
    }
  }

  function resetPaging() {
    setPageIndex(0);
  }

  function loadSystem(systemId: string) {
    const nextSystem = systemTemplates.find((system) => system.id === systemId);
    if (!nextSystem) return;
    setActiveSystemId(systemId);
    setComponentFilter("All");
    setComponentQuery("");
    resetPaging();
    if (systemId === "turbofan") {
      setRowFilter("with_effect");
      setRows(toFmeaRows(fmeaData.rows as EvidenceRow[]));
    } else {
      setRowFilter("all");
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
    setComponentQuery("");
    setRowFilter("all");
    resetPaging();
    setRows(templateRowsForComponents(componentsFromBom));
    setNotice(`Imported ${componentsFromBom.length} BOM components. Edit the generated worksheet, then export when required fields are complete.`);
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

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <AppNav />

      <main id="main-content" className="app-main">
        <section className="workflow-card" id="builder">
          <div className="workflow-steps" aria-label="FMEA workflow steps">
            <div className="workflow-step active">
              <span>1</span>
              <strong>Select parts</strong>
              <small>Use the corpus, upload a BOM, or choose a component.</small>
            </div>
            <div className={`workflow-step ${editStepState}`}>
              <span>2</span>
              <strong>Edit FMEA rows</strong>
              <small>Review effects, causes, controls, and S/O/D scores.</small>
            </div>
            <div className={`workflow-step ${exportStepState}`}>
              <span>3</span>
              <strong>Export worksheet</strong>
              <small>Export once included rows are complete.</small>
            </div>
          </div>

          <section className="workspace-panel">
            <div className="worksheet-controls">
              <div className="control-field control-field-wide">
                <label className="field-label" htmlFor="component-search">
                  Search components
                </label>
                <input
                  id="component-search"
                  className="text-input"
                  type="search"
                  placeholder="Search bearing, compressor, turbine..."
                  value={componentQuery}
                  onChange={(event) => {
                    setComponentQuery(event.target.value);
                    resetPaging();
                  }}
                />
              </div>

              <div className="control-field">
                <label className="field-label" htmlFor="system-select">
                  Evidence set
                </label>
                <select
                  id="system-select"
                  value={activeSystemId}
                  onChange={(event) => loadSystem(event.target.value)}
                >
                  {systemTemplates.map((system) => (
                    <option key={system.id} value={system.id}>
                      {system.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="control-field">
                <label className="field-label" htmlFor="component-filter">
                  Component
                </label>
                <select
                  id="component-filter"
                  value={componentFilter}
                  onChange={(event) => {
                    setComponentFilter(event.target.value);
                    resetPaging();
                  }}
                >
                  <option value="All">All components</option>
                  {components.map((component) => (
                    <option key={component} value={component}>
                      {component}
                    </option>
                  ))}
                </select>
              </div>

              <div className="control-field">
                <label className="field-label" htmlFor="row-filter">
                  Rows
                </label>
                <select
                  id="row-filter"
                  value={rowFilter}
                  onChange={(event) => {
                    setRowFilter(event.target.value);
                    resetPaging();
                  }}
                >
                  <option value="with_effect">With effect</option>
                  <option value="all">All rows</option>
                  <option value="missing_effect">Missing effect ({rowsMissingEffect})</option>
                  <option value="included">Included only</option>
                  <option value="evidence">Evidence-backed</option>
                  <option value="incomplete">Incomplete</option>
                </select>
              </div>

              <div className="control-field">
                <label className="field-label" htmlFor="page-size">
                  Page size
                </label>
                <select
                  id="page-size"
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    resetPaging();
                  }}
                >
                  {[10, 25, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size} rows
                    </option>
                  ))}
                </select>
              </div>

              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleBomUpload}
              />
              <button
                className="btn btn-secondary control-button"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                Upload BOM
              </button>
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

            <p className="notice">{notice}</p>

            <div className="grid-shell" id="worksheet">
              <RevoGrid
                className="fmea-grid"
                columns={gridColumns}
                source={gridRows}
                resize
                range
                canFocus
                useClipboard
                theme="default"
                onAfteredit={handleGridEdit}
              />
              {!visibleRows.length && <p className="empty-state">No rows match the current filters.</p>}
            </div>

            <div className="table-pagination" aria-label="Table pagination">
              <span>
                {visibleRows.length
                  ? `${pageStart + 1}-${Math.min(pageStart + pageRows.length, visibleRows.length)} of ${visibleRows.length}`
                  : "0 rows"}
              </span>
              <div className="pagination-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => setPageIndex(0)}
                  disabled={currentPage === 0}
                >
                  First
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => setPageIndex((page) => Math.max(0, page - 1))}
                  disabled={currentPage === 0}
                >
                  Previous
                </button>
                <strong>
                  Page {currentPage + 1} of {totalPages}
                </strong>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => setPageIndex((page) => Math.min(totalPages - 1, page + 1))}
                  disabled={currentPage >= totalPages - 1}
                >
                  Next
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => setPageIndex(totalPages - 1)}
                  disabled={currentPage >= totalPages - 1}
                >
                  Last
                </button>
              </div>
            </div>
          </section>
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
