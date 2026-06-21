"use client";

import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  type ColumnDef,
  flexRender,
} from "@tanstack/react-table";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react";

import { AppNav } from "@/components/app-nav";
import fmeaData from "@/data/fmea-turbofan-data.json";

type Source = {
  title: string;
  year?: string;
  doi?: string;
  url?: string;
  category?: string;
  evidenceText?: string;
  sourceField?: string;
  charStart?: number;
  charEnd?: number;
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

type FmeaDataset = {
  system?: string;
  sourceType?: string;
  recordCount: number;
  relevantRecordCount?: number;
  rowCount: number;
  components: string[];
  rows: EvidenceRow[];
};

type SelectionStep = "initial" | "table";
type EditableField =
  | "included"
  | "effect"
  | "severity"
  | "cause"
  | "occurrence"
  | "currentControl"
  | "detection"
  | "correctiveAction"
  | "status";

type LoadingAction = "upload" | "system" | "export" | null;

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
const bundledTurbofanData = fmeaData as FmeaDataset;
const editableFields: EditableField[] = [
  "included",
  "effect",
  "severity",
  "cause",
  "occurrence",
  "currentControl",
  "detection",
  "correctiveAction",
  "status",
];

const fieldHelp: Record<string, string> = {
  included: "Include or exclude this row from save/export decisions.",
  component: "Physical engineering part or subsystem being analyzed.",
  function: "Intended function the component must perform.",
  requirement: "Operating requirement or condition the function must satisfy.",
  failureMode: "How the component or function can fail.",
  effect: "Consequence if the failure mode occurs.",
  severity: "Severity score: 1 is minor, 10 is hazardous or catastrophic.",
  cause: "Why the failure mode occurs.",
  occurrence: "Occurrence score: 1 is rare, 10 is frequent.",
  currentControl: "Existing prevention, detection, inspection, design, or maintenance control.",
  detection: "Detection score: 1 is easily detected before harm, 10 is unlikely to be detected.",
  rpn: "Risk Priority Number calculated as Severity x Occurrence x Detection.",
  correctiveAction: "Recommended action to reduce risk or correct a confirmed issue.",
  evidence: "Source count and citations behind the extracted FMEA fields.",
  status: "Human review state for this row.",
};

function makeRowId(row: Pick<FmeaRow, "component" | "failureMode">, index: number) {
  return `${row.component}-${row.failureMode}-${index}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

function scoreValue(value: string) {
  return scoreOptions.includes(value) ? value : "";
}

function toFmeaRows(rows: EvidenceRow[]): FmeaRow[] {
  return rows.map((row, index) => ({
    ...row,
    severity: scoreValue(row.severity),
    occurrence: scoreValue(row.occurrence),
    detection: scoreValue(row.detection),
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

function normalizeComponentList(components: string[]) {
  return Array.from(
    new Set(
      components
        .map((component) => component.trim())
        .filter(Boolean),
    ),
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

function sourceLabel(source: Source) {
  if (source.doi) return `DOI: ${source.doi}`;
  if (source.url) return source.url;
  return source.category ? source.category.replace(/_/g, " ") : "Source record";
}

function evidenceSummary(row: FmeaRow) {
  return [
    ["Component", row.component],
    ["Failure mode", row.failureMode],
    ["Cause", row.cause],
    ["Effect", row.effect],
    ["Control / action", row.correctiveAction || row.currentControl],
  ].filter(([, value]) => String(value || "").trim());
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

// Group rows by component for tree structure
function groupRowsByComponent(rows: FmeaRow[]) {
  const grouped = new Map<string, FmeaRow[]>();
  rows.forEach((row) => {
    if (!grouped.has(row.component)) {
      grouped.set(row.component, []);
    }
    grouped.get(row.component)!.push(row);
  });
  return Array.from(grouped.entries()).map(([component, childRows]) => ({
    component,
    childRows,
  }));
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cellRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [selectionStep, setSelectionStep] = useState<SelectionStep>("initial");
  const [rows, setRows] = useState<FmeaRow[]>(() => toFmeaRows(bundledTurbofanData.rows));
  const [turbofanDataset, setTurbofanDataset] = useState<FmeaDataset>(bundledTurbofanData);
  const [componentFilter, setComponentFilter] = useState("All");
  const [rowFilter, setRowFilter] = useState("all");
  const [componentQuery, setComponentQuery] = useState("");
  const [selectedSystemId, setSelectedSystemId] = useState("turbofan");
  const [manualComponent, setManualComponent] = useState("");
  const [manualComponents, setManualComponents] = useState<string[]>([]);
  const [selectedSourceRow, setSelectedSourceRow] = useState<FmeaRow | null>(null);
  const [notice, setNotice] = useState("Start with the turbofan evidence set, upload a BOM, or choose components to narrow the worksheet.");
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [focusedCellId, setFocusedCellId] = useState<string | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const components = useMemo(
    () => Array.from(new Set(rows.map((row) => row.component))).sort(),
    [rows],
  );
  const selectedSystem = systemTemplates.find((system) => system.id === selectedSystemId);
  const selectedSystemSource =
    selectedSystemId === "turbofan"
      ? `${turbofanDataset.recordCount} classified turbofan records; ${turbofanDataset.relevantRecordCount ?? 0} records with FMEA links; ${turbofanDataset.rowCount} assembled rows`
      : selectedSystem?.source;

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
  const canExport = includedRows.length > 0 && incompleteRows.length === 0;

  // Group visible rows by component for tree structure
  const groupedData = useMemo(() => groupRowsByComponent(visibleRows), [visibleRows]);

  // Load saved data from localStorage on mount
  useEffect(() => {
    try {
      const savedData = localStorage.getItem("riskonradar-fmea-data");
      if (savedData) {
        const parsedRows = JSON.parse(savedData) as FmeaRow[];
        if (parsedRows.length > 0) {
          setRows(parsedRows);
          const savedTime = localStorage.getItem("riskonradar-fmea-saved-at");
          if (savedTime) {
            setLastSavedAt(savedTime);
          }
          setHasUnsavedChanges(false);
        }
      }
    } catch (error) {
      console.error("Failed to load saved FMEA data:", error);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    fetchLiveTurbofanDataset()
      .then((dataset) => {
        if (!ignore) setTurbofanDataset(dataset);
      })
      .catch(() => {
        // The bundled snapshot remains available when Supabase is unreachable.
      });
    return () => {
      ignore = true;
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      // Ctrl+S or Cmd+S to save
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        saveFmea();
      }

      // Ctrl+? or Ctrl+H to open help
      if ((event.ctrlKey || event.metaKey) && (event.key === "?" || event.key === "h")) {
        event.preventDefault();
        setShowHelpModal(true);
      }

      // Escape to close dialog
      if (event.key === "Escape") {
        if (selectedSourceRow) {
          setSelectedSourceRow(null);
        } else if (showHelpModal) {
          setShowHelpModal(false);
        } else if (showExportDropdown) {
          setShowExportDropdown(false);
        } else if (focusedCellId) {
          setFocusedCellId(null);
        }
      }

      // Ctrl+A to select all visible rows
      if ((event.ctrlKey || event.metaKey) && event.key === "a") {
        event.preventDefault();
        const newSelection = new Set(visibleRows.map(row => row.id));
        setSelectedRowIds(newSelection);
      }

      // Delete to remove selected rows
      if (event.key === "Delete" && selectedRowIds.size > 0) {
        if ((event.target as HTMLElement | null)?.closest("input, textarea, select")) return;
        event.preventDefault();
        if (confirm(`Delete ${selectedRowIds.size} selected row${selectedRowIds.size === 1 ? "" : "s"}?`)) {
          setRows(currentRows => currentRows.filter(row => !selectedRowIds.has(row.id)));
          setSelectedRowIds(new Set());
          setHasUnsavedChanges(true);
        }
      }

      // Ctrl+D to toggle include on selected rows
      if ((event.ctrlKey || event.metaKey) && event.key === "d") {
        event.preventDefault();
        setRows(currentRows => 
          currentRows.map(row => 
            selectedRowIds.has(row.id) 
              ? { ...row, included: !row.included }
              : row
          )
        );
        setHasUnsavedChanges(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedSourceRow, showExportDropdown, visibleRows, selectedRowIds, focusedCellId, showHelpModal, rows]);

  const isLoading = loadingAction !== null;

  function updateRow(id: string, update: Partial<FmeaRow>) {
    setRows((currentRows) =>
      currentRows.map((row) => (row.id === id ? { ...row, ...update } : row)),
    );
    setHasUnsavedChanges(true);
  }

  function registerCell(rowId: string, field: EditableField, element: HTMLElement | null) {
    const key = `${rowId}:${field}`;
    if (element) {
      cellRefs.current.set(key, element);
    } else {
      cellRefs.current.delete(key);
    }
  }

  function focusCell(rowId: string, field: EditableField) {
    const target = cellRefs.current.get(`${rowId}:${field}`);
    target?.focus();
  }

  function handleTableCellKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
    rowId: string,
    field: EditableField,
  ) {
    if (event.key !== "Tab") return;
    const rowIndex = visibleRows.findIndex((row) => row.id === rowId);
    const fieldIndex = editableFields.indexOf(field);
    if (rowIndex < 0 || fieldIndex < 0) return;

    event.preventDefault();
    const flatIndex = rowIndex * editableFields.length + fieldIndex;
    const nextFlatIndex = flatIndex + (event.shiftKey ? -1 : 1);
    const maxIndex = visibleRows.length * editableFields.length - 1;
    const clampedIndex = Math.max(0, Math.min(maxIndex, nextFlatIndex));
    const nextRow = visibleRows[Math.floor(clampedIndex / editableFields.length)];
    const nextField = editableFields[clampedIndex % editableFields.length];
    if (nextRow && nextField) focusCell(nextRow.id, nextField);
  }

  function editableCellClass(rowId: string, field: EditableField) {
    return focusedCellId === `${rowId}:${field}` ? "cell-focused" : "";
  }

  function toggleRowSelection(rowId: string, event: MouseEvent | ReactKeyboardEvent) {
    if (event.ctrlKey || event.metaKey) {
      // Multi-selection
      setSelectedRowIds(current => {
        const newSet = new Set(current);
        if (newSet.has(rowId)) {
          newSet.delete(rowId);
        } else {
          newSet.add(rowId);
        }
        return newSet;
      });
    } else {
      // Single selection (Ctrl+not held)
      setSelectedRowIds(new Set([rowId]));
    }
  }

  function importBomFile(file: File) {
    if (!file) return;
    setLoadingAction("upload");
    const text = file.text();
    text.then((text) => {
      const componentsFromBom = parseBom(text);
      if (!componentsFromBom.length) {
        setNotice("Could not detect components from that BOM. Try CSV, TSV, or one component per line.");
        setLoadingAction(null);
        return;
      }
      setRows(templateRowsForComponents(componentsFromBom));
      setSelectionStep("table");
      setNotice(`Imported ${componentsFromBom.length} BOM components. Edit the generated worksheet, then export when required fields are complete.`);
      setHasUnsavedChanges(true);
      setLoadingAction(null);
    }).catch(() => {
      setNotice("Failed to read file. Please try again.");
      setLoadingAction(null);
    });
  }

  function handleBomUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    importBomFile(file);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    importBomFile(file);
  }

  function handleManualComponentChange(component: string) {
    if (!component) return;
    setManualComponent(component);
    setManualComponents((current) => normalizeComponentList([...current, component]));
  }

  function startManualWorksheet() {
    const nextComponents = manualComponents.length ? manualComponents : components.slice(0, 5);
    setRows(templateRowsForComponents(nextComponents));
    setComponentFilter("All");
    setComponentQuery("");
    setRowFilter("all");
    setSelectionStep("table");
    setNotice(`Started a manual worksheet with ${nextComponents.length} component${nextComponents.length === 1 ? "" : "s"}.`);
  }

  async function fetchLiveTurbofanDataset() {
    const response = await fetch("/api/knowledge/fmea?limit=1000", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Failed to load turbofan evidence (${response.status})`);
    }
    return (await response.json()) as FmeaDataset;
  }

  async function loadSystem(systemId: string) {
    const nextSystem = systemTemplates.find((system) => system.id === systemId);
    if (!nextSystem) return;
    setLoadingAction("system");
    setSelectedSystemId(systemId);
    setComponentFilter("All");
    setComponentQuery("");
    try {
      if (systemId === "turbofan") {
        const liveDataset = await fetchLiveTurbofanDataset();
        setTurbofanDataset(liveDataset);
        setRowFilter("all");
        setRows(toFmeaRows(liveDataset.rows));
        setNotice(`Loaded live turbofan evidence: ${liveDataset.recordCount} classified records, ${liveDataset.rowCount} assembled FMEA rows.`);
      } else {
        setRowFilter("all");
        setRows(templateRowsForComponents(nextSystem.components));
        setNotice(`Loaded ${nextSystem.name}. Edit the generated worksheet, then export when required fields are complete.`);
      }
      setSelectionStep("table");
      setHasUnsavedChanges(true);
    } catch (error) {
      if (systemId === "turbofan") {
        setRowFilter("all");
        setRows(toFmeaRows(bundledTurbofanData.rows));
        setSelectionStep("table");
        setNotice("Could not load live turbofan evidence. Using bundled worksheet snapshot.");
      } else {
        setNotice("Failed to load the selected system.");
      }
    } finally {
      setLoadingAction(null);
    }
  }

  function changeSystem() {
    if (hasUnsavedChanges) {
      const shouldContinue = confirm("You have unsaved worksheet changes. Change systems anyway?");
      if (!shouldContinue) return;
    }
    setSelectionStep("initial");
    setShowExportDropdown(false);
  }

  function handleManualSelection() {
    startManualWorksheet();
  }

  function exportData(format: "csv" | "excel") {
    if (!canExport) {
      setValidationError(`Cannot export: ${incompleteRows.length} included row${incompleteRows.length === 1 ? "" : "s"} still need function, effect, cause, controls, or S/O/D scores.`);
      setTimeout(() => setValidationError(null), 5000);
      return;
    }

    setIsExporting(true);
    setLoadingAction("export");
    setTimeout(() => {
      if (format === "csv") {
        downloadFile("risk-on-radar-fmea.csv", "text/csv;charset=utf-8", buildCsv(includedRows));
      } else {
        downloadFile(
          "risk-on-radar-fmea.xls",
          "application/vnd.ms-excel;charset=utf-8",
          buildExcelHtml(includedRows),
        );
      }
      setShowExportDropdown(false);
      setIsExporting(false);
      setLoadingAction(null);
    }, 100);
  }

  function saveFmea() {
    setIsSaving(true);
    window.setTimeout(() => {
      try {
        localStorage.setItem("riskonradar-fmea-data", JSON.stringify(rows));
        const now = new Date().toLocaleString();
        localStorage.setItem("riskonradar-fmea-saved-at", now);
        setLastSavedAt(now);
        setHasUnsavedChanges(false);
        setNotice("FMEA saved successfully.");
        setTimeout(() => setNotice(""), 3000);
      } catch (error) {
        setNotice("Failed to save FMEA data.");
        setTimeout(() => setNotice(""), 3000);
      } finally {
        setIsSaving(false);
      }
    }, 150);
  }

  function HeaderLabel({ field, label }: { field: string; label: string }) {
    return (
      <span className="header-label">
        {label}
        <button
          type="button"
          className="field-help"
          title={fieldHelp[field]}
          aria-label={`${label} help: ${fieldHelp[field]}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setShowHelpModal(true);
          }}
        >
          ?
        </button>
      </span>
    );
  }

  // TanStack Table columns
  const columns = useMemo<ColumnDef<FmeaRow>[]>(
    () => [
      {
        id: "included",
        header: () => <HeaderLabel field="included" label="Use" />,
        cell: ({ row }) => (
          <input
            ref={(element) => registerCell(row.original.id, "included", element)}
            type="checkbox"
            checked={row.original.included}
            onChange={(e) => updateRow(row.original.id, { included: e.target.checked })}
            className="fmea-checkbox"
            aria-label={`Include ${row.original.component} - ${row.original.failureMode}`}
            onFocus={() => setFocusedCellId(`${row.original.id}:included`)}
            onBlur={() => setFocusedCellId(null)}
            onKeyDown={(e) => handleTableCellKeyDown(e, row.original.id, "included")}
          />
        ),
        size: 50,
      },
      {
        accessorKey: "component",
        header: () => <HeaderLabel field="component" label="Component" />,
        cell: ({ row }) => <span className="visually-hidden">{row.original.component}</span>,
        size: 200,
      },
      {
        accessorKey: "function",
        header: () => <HeaderLabel field="function" label="Function" />,
        cell: ({ row }) => <span>{row.original.function}</span>,
        size: 250,
      },
      {
        accessorKey: "requirement",
        header: () => <HeaderLabel field="requirement" label="Requirement" />,
        cell: ({ row }) => <span>{row.original.requirement}</span>,
        size: 300,
      },
      {
        accessorKey: "failureMode",
        header: () => <HeaderLabel field="failureMode" label="Failure Mode" />,
        cell: ({ row }) => <span>{row.original.failureMode}</span>,
        size: 200,
      },
      {
        accessorKey: "effect",
        header: () => <HeaderLabel field="effect" label="Effect" />,
        cell: ({ row }) => (
          <input
            ref={(element) => registerCell(row.original.id, "effect", element)}
            type="text"
            value={row.original.effect}
            onChange={(e) => updateRow(row.original.id, { effect: e.target.value })}
            className={`fmea-cell-control ${editableCellClass(row.original.id, "effect")}`}
            aria-label={`Effect for ${row.original.component} - ${row.original.failureMode}`}
            onFocus={() => setFocusedCellId(`${row.original.id}:effect`)}
            onBlur={() => setFocusedCellId(null)}
            onKeyDown={(e) => handleTableCellKeyDown(e, row.original.id, "effect")}
          />
        ),
        size: 250,
      },
      {
        accessorKey: "severity",
        header: () => <HeaderLabel field="severity" label="S" />,
        cell: ({ row }) => (
          <select
            ref={(element) => registerCell(row.original.id, "severity", element)}
            value={row.original.severity}
            onChange={(e) => updateRow(row.original.id, { severity: e.target.value })}
            className={`fmea-cell-control fmea-score-control ${editableCellClass(row.original.id, "severity")}`}
            aria-label={`Severity score for ${row.original.component} - ${row.original.failureMode}`}
            onFocus={() => setFocusedCellId(`${row.original.id}:severity`)}
            onBlur={() => setFocusedCellId(null)}
            onKeyDown={(e) => handleTableCellKeyDown(e, row.original.id, "severity")}
          >
            <option value="">-</option>
            {scoreOptions.map((score) => (
              <option key={score} value={score}>
                {score}
              </option>
            ))}
          </select>
        ),
        size: 60,
      },
      {
        accessorKey: "cause",
        header: () => <HeaderLabel field="cause" label="Cause" />,
        cell: ({ row }) => (
          <input
            ref={(element) => registerCell(row.original.id, "cause", element)}
            type="text"
            value={row.original.cause}
            onChange={(e) => updateRow(row.original.id, { cause: e.target.value })}
            className={`fmea-cell-control ${editableCellClass(row.original.id, "cause")}`}
            aria-label={`Cause for ${row.original.component} - ${row.original.failureMode}`}
            onFocus={() => setFocusedCellId(`${row.original.id}:cause`)}
            onBlur={() => setFocusedCellId(null)}
            onKeyDown={(e) => handleTableCellKeyDown(e, row.original.id, "cause")}
          />
        ),
        size: 250,
      },
      {
        accessorKey: "occurrence",
        header: () => <HeaderLabel field="occurrence" label="O" />,
        cell: ({ row }) => (
          <select
            ref={(element) => registerCell(row.original.id, "occurrence", element)}
            value={row.original.occurrence}
            onChange={(e) => updateRow(row.original.id, { occurrence: e.target.value })}
            className={`fmea-cell-control fmea-score-control ${editableCellClass(row.original.id, "occurrence")}`}
            aria-label={`Occurrence score for ${row.original.component} - ${row.original.failureMode}`}
            onFocus={() => setFocusedCellId(`${row.original.id}:occurrence`)}
            onBlur={() => setFocusedCellId(null)}
            onKeyDown={(e) => handleTableCellKeyDown(e, row.original.id, "occurrence")}
          >
            <option value="">-</option>
            {scoreOptions.map((score) => (
              <option key={score} value={score}>
                {score}
              </option>
            ))}
          </select>
        ),
        size: 60,
      },
      {
        accessorKey: "currentControl",
        header: () => <HeaderLabel field="currentControl" label="Controls" />,
        cell: ({ row }) => (
          <input
            ref={(element) => registerCell(row.original.id, "currentControl", element)}
            type="text"
            value={row.original.currentControl}
            onChange={(e) => updateRow(row.original.id, { currentControl: e.target.value })}
            className={`fmea-cell-control ${editableCellClass(row.original.id, "currentControl")}`}
            aria-label={`Controls for ${row.original.component} - ${row.original.failureMode}`}
            onFocus={() => setFocusedCellId(`${row.original.id}:currentControl`)}
            onBlur={() => setFocusedCellId(null)}
            onKeyDown={(e) => handleTableCellKeyDown(e, row.original.id, "currentControl")}
          />
        ),
        size: 250,
      },
      {
        accessorKey: "detection",
        header: () => <HeaderLabel field="detection" label="D" />,
        cell: ({ row }) => (
          <select
            ref={(element) => registerCell(row.original.id, "detection", element)}
            value={row.original.detection}
            onChange={(e) => updateRow(row.original.id, { detection: e.target.value })}
            className={`fmea-cell-control fmea-score-control ${editableCellClass(row.original.id, "detection")}`}
            aria-label={`Detection score for ${row.original.component} - ${row.original.failureMode}`}
            onFocus={() => setFocusedCellId(`${row.original.id}:detection`)}
            onBlur={() => setFocusedCellId(null)}
            onKeyDown={(e) => handleTableCellKeyDown(e, row.original.id, "detection")}
          >
            <option value="">-</option>
            {scoreOptions.map((score) => (
              <option key={score} value={score}>
                {score}
              </option>
            ))}
          </select>
        ),
        size: 60,
      },
      {
        accessorKey: "rpn",
        header: () => <HeaderLabel field="rpn" label="RPN" />,
        cell: ({ row }) => <span className="rpn-value">{rowRpn(row.original)}</span>,
        size: 80,
      },
      {
        accessorKey: "correctiveAction",
        header: () => <HeaderLabel field="correctiveAction" label="Action" />,
        cell: ({ row }) => (
          <input
            ref={(element) => registerCell(row.original.id, "correctiveAction", element)}
            type="text"
            value={row.original.correctiveAction}
            onChange={(e) => updateRow(row.original.id, { correctiveAction: e.target.value })}
            className={`fmea-cell-control ${editableCellClass(row.original.id, "correctiveAction")}`}
            aria-label={`Corrective action for ${row.original.component} - ${row.original.failureMode}`}
            onFocus={() => setFocusedCellId(`${row.original.id}:correctiveAction`)}
            onBlur={() => setFocusedCellId(null)}
            onKeyDown={(e) => handleTableCellKeyDown(e, row.original.id, "correctiveAction")}
          />
        ),
        size: 250,
      },
      {
        id: "evidence",
        header: () => <HeaderLabel field="evidence" label="Evidence" />,
        cell: ({ row }) => (
          <button
            type="button"
            className="evidence-button"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedSourceRow(row.original);
            }}
            aria-label={`View evidence sources for ${row.original.component} - ${row.original.failureMode}`}
          >
            {row.original.evidenceCount || row.original.sources.length} sources
          </button>
        ),
        size: 120,
      },
      {
        accessorKey: "status",
        header: () => <HeaderLabel field="status" label="Status" />,
        cell: ({ row }) => (
          <select
            ref={(element) => registerCell(row.original.id, "status", element)}
            value={row.original.status}
            onChange={(e) =>
              updateRow(row.original.id, { status: e.target.value as FmeaRow["status"] })
            }
            className={`fmea-cell-control status-control ${editableCellClass(row.original.id, "status")}`}
            aria-label={`Review status for ${row.original.component} - ${row.original.failureMode}`}
            onFocus={() => setFocusedCellId(`${row.original.id}:status`)}
            onBlur={() => setFocusedCellId(null)}
            onKeyDown={(e) => handleTableCellKeyDown(e, row.original.id, "status")}
          >
            <option value="needs_review">Needs Review</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        ),
        size: 120,
      },
    ],
    [focusedCellId, visibleRows],
  );

  const visibleColumnCount = columns.length - 1;

  const table = useReactTable({
    data: visibleRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  if (selectionStep === "initial") {
    return (
      <div className="app-shell">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>

        <AppNav />

        <main id="main-content" className="app-main">
          <section className="workflow-card">
            <div className="page-heading workspace-start-heading">
              <span className="metric-label">FMEA Workspace</span>
              <h1>Start your reliability analysis</h1>
              <p>
                Upload a component file, select a known system, or pick components manually.
              </p>
            </div>

            <div className="workspace-start-grid">
              <div className="workspace-start-panel">
                <label className="field-label" htmlFor="system-template">
                  Select system
                </label>
                <select
                  id="system-template"
                  value={selectedSystemId}
                  onChange={(event) => setSelectedSystemId(event.target.value)}
                >
                  {systemTemplates.map((system) => (
                    <option key={system.id} value={system.id}>
                      {system.name} - {system.domain}
                    </option>
                  ))}
                </select>
                <p>
                  {selectedSystem?.description}
                </p>
                <span>
                  {selectedSystemSource}
                </span>
                <button
                  className="btn btn-primary btn-full"
                  type="button"
                  onClick={() => loadSystem(selectedSystemId)}
                  disabled={isLoading}
                >
                  {isLoading ? "Loading..." : "Open selected system"}
                </button>
              </div>

              <div className="workspace-start-panel">
                <label className="field-label" htmlFor="manual-component">
                  Select components manually
                </label>
                <select
                  id="manual-component"
                  value={manualComponent}
                  onChange={(event) => handleManualComponentChange(event.target.value)}
                >
                  <option value="">Choose a component</option>
                  {components.map((component) => (
                    <option key={component} value={component}>
                      {component}
                    </option>
                  ))}
                </select>
                <div className="component-chip-list" aria-label="Selected components">
                  {(manualComponents.length ? manualComponents : ["No components selected yet"]).map((component) => (
                    <span key={component}>{component}</span>
                  ))}
                </div>
                <button
                  className="btn btn-secondary btn-full"
                  type="button"
                  onClick={handleManualSelection}
                >
                  Start manual worksheet
                </button>
              </div>

              <button
                className="dropzone"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
                disabled={isLoading}
              >
                <strong>{isLoading ? "Processing..." : "Drop BOM or component list here"}</strong>
                <span>CSV, TSV, or text. The first column is treated as component name.</span>
              </button>

              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleBomUpload}
                aria-label="Upload BOM or component list file"
              />
            </div>
          </section>
        </main>

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

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <AppNav />

      <main id="main-content" className="app-main">
        <section className="workflow-card">
          {/* Header with Export */}
          <div className="fmea-header">
            <div>
              <span className="metric-label">FMEA Worksheet</span>
              <h1 className="fmea-title">Edit reliability analysis</h1>
            </div>
            <div className="fmea-header-actions">
              <button
                onClick={() => setShowHelpModal(true)}
                className="btn btn-secondary btn-sm"
                type="button"
                aria-label="Keyboard shortcuts and help"
              >
                ?
              </button>
              <button
                onClick={changeSystem}
                className="btn btn-secondary btn-sm"
                type="button"
              >
                Change system
              </button>
              <button
                onClick={saveFmea}
                className="btn btn-secondary btn-sm"
                type="button"
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
              {lastSavedAt && (
                <span className="save-status">
                  Last saved: {lastSavedAt}{hasUnsavedChanges ? " · unsaved changes" : ""}
                </span>
              )}
              <div className="export-menu">
                <button
                  onClick={() => setShowExportDropdown(!showExportDropdown)}
                  className="btn btn-primary btn-sm"
                  type="button"
                  disabled={isExporting}
                >
                  {isExporting ? "Exporting..." : "Export"}
                </button>
                {showExportDropdown && (
                  <div className="export-dropdown">
                    <button
                      onClick={() => exportData("excel")}
                    >
                      Export as Excel
                    </button>
                    <button
                      onClick={() => exportData("csv")}
                    >
                      Export as CSV
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Validation Error */}
          {validationError && (
            <div className="validation-error">
              {validationError}
            </div>
          )}

          {/* Worksheet Controls */}
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
                onChange={(event) => setComponentQuery(event.target.value)}
              />
            </div>

            <div className="control-field">
              <label className="field-label" htmlFor="component-filter">
                Component
              </label>
              <select
                id="component-filter"
                value={componentFilter}
                onChange={(event) => setComponentFilter(event.target.value)}
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
                onChange={(event) => setRowFilter(event.target.value)}
              >
                <option value="all">All rows</option>
                <option value="with_effect">With effect</option>
                <option value="included">Included only</option>
                <option value="evidence">Evidence-backed</option>
                <option value="incomplete">Incomplete</option>
              </select>
            </div>
          </div>

          {/* Notice */}
          {notice && (
            <p className="notice">{notice}</p>
          )}

          {/* Table */}
          <div className="grid-shell" id="worksheet">
            <div className="table-scroll">
              {isLoading && (
                <div className="table-loading" role="status">
                  {loadingAction === "upload" && "Processing file..."}
                  {loadingAction === "system" && "Loading system..."}
                  {loadingAction === "export" && "Preparing export..."}
                </div>
              )}
              <table className={`fmea-table ${focusedCellId ? "focus-mode" : ""}`}>
                <thead>
                  <tr className="column-group-row">
                    <th colSpan={4}>Component details</th>
                    <th colSpan={6}>Failure analysis and scoring</th>
                    <th colSpan={4}>Evidence and review</th>
                  </tr>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers
                        .filter((header) => header.column.id !== "component")
                        .map((header) => (
                        <th
                          key={header.id}
                          className={`col-${header.column.id}`}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {groupedData.map(({ component, childRows }) => (
                    <Fragment key={component}>
                      <tr className="component-section-row">
                        <td colSpan={visibleColumnCount}>
                          <span>Component</span>
                          {component}
                        </td>
                      </tr>
                      {childRows.map((row) => (
                        <tr
                          key={row.id}
                          className={`fmea-data-row ${selectedRowIds.has(row.id) ? "row-selected" : ""}`}
                          onClick={(event) => {
                            toggleRowSelection(row.id, event);
                          }}
                        >
                          {table.getRowModel().rows.find(r => r.original.id === row.id)?.getVisibleCells()
                            .filter((cell) => cell.column.id !== "component")
                            .map((cell) => (
                            <td
                              key={cell.id}
                              className={`col-${cell.column.id} ${focusedCellId?.startsWith(`${row.id}:`) && !cell.id.includes(focusedCellId.split(":")[1] ?? "") ? "cell-dimmed" : ""}`}
                              onClick={(event: MouseEvent<HTMLTableCellElement>) => {
                                if (["INPUT", "SELECT", "BUTTON"].includes((event.target as HTMLElement).tagName)) {
                                  event.stopPropagation();
                                }
                              }}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {!visibleRows.length && <p className="empty-state">No rows match the current filters.</p>}
            </div>
          </div>

          {/* Footer Info */}
          <div className="table-pagination">
            <span>
              {visibleRows.length} rows ({includedRows.filter((r) => visibleRows.includes(r)).length} included)
            </span>
            <span>
              {incompleteRows.length} incomplete row{incompleteRows.length === 1 ? "" : "s"}
            </span>
            {selectedRowIds.size > 0 && (
              <span className="selection-count">
                {selectedRowIds.size} selected
              </span>
            )}
          </div>
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
              <li>
                <strong>Extracted FMEA fields</strong>
                {evidenceSummary(selectedSourceRow).map(([label, value]) => (
                  <span key={label}>
                    {label}: {value}
                  </span>
                ))}
              </li>
              {selectedSourceRow.sources.map((source) => (
                <li key={[source.doi, source.title].filter(Boolean).join("|")}>
                  <strong>{source.title}</strong>
                  <span>
                    {sourceLabel(source)}
                    {source.year ? ` · ${source.year}` : ""}
                  </span>
                  {source.evidenceText ? (
                    <blockquote>{source.evidenceText}</blockquote>
                  ) : (
                    <span>Exact evidence span is not included in this bundled snapshot.</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {showHelpModal && (
        <div className="source-dialog-backdrop" role="presentation" onClick={() => setShowHelpModal(false)}>
          <section
            className="source-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts and help"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="dialog-close" type="button" aria-label="Close" onClick={() => setShowHelpModal(false)}>
              ×
            </button>
            <span className="metric-label">Help</span>
            <h3>Keyboard Shortcuts</h3>
            <ul className="source-list">
              <li>
                <strong>Tab / Shift+Tab</strong>
                <span>Navigate between editable cells</span>
              </li>
              <li>
                <strong>Ctrl+S / Cmd+S</strong>
                <span>Save FMEA data</span>
              </li>
              <li>
                <strong>Ctrl+A / Cmd+A</strong>
                <span>Select all visible rows</span>
              </li>
              <li>
                <strong>Ctrl+Click / Cmd+Click</strong>
                <span>Add/remove row from selection (multi-select). Click without Ctrl for single selection.</span>
              </li>
              <li>
                <strong>Delete</strong>
                <span>Delete selected rows (with confirmation)</span>
              </li>
              <li>
                <strong>Ctrl+D / Cmd+D</strong>
                <span>Toggle include/exclude on selected rows</span>
              </li>
              <li>
                <strong>Ctrl+H / Ctrl+?</strong>
                <span>Open help modal</span>
              </li>
              <li>
                <strong>Escape</strong>
                <span>Close dialogs, dropdowns, or clear selection</span>
              </li>
            </ul>
            <h3>FMEA Field Explanations</h3>
            <ul className="source-list">
              <li>
                <strong>Component</strong>
                <span>Physical engineering part or subsystem being analyzed</span>
              </li>
              <li>
                <strong>Function</strong>
                <span>Intended function the component must perform</span>
              </li>
              <li>
                <strong>Requirement</strong>
                <span>Operating requirement or condition the function must satisfy</span>
              </li>
              <li>
                <strong>Failure Mode</strong>
                <span>How the component or function can fail</span>
              </li>
              <li>
                <strong>Effect</strong>
                <span>Consequence if the failure mode occurs</span>
              </li>
              <li>
                <strong>Severity (S)</strong>
                <span>Severity score: 1 is minor, 10 is hazardous or catastrophic</span>
              </li>
              <li>
                <strong>Cause</strong>
                <span>Why the failure mode occurs</span>
              </li>
              <li>
                <strong>Occurrence (O)</strong>
                <span>Occurrence score: 1 is rare, 10 is frequent</span>
              </li>
              <li>
                <strong>Controls</strong>
                <span>Existing prevention, detection, inspection, design, or maintenance control</span>
              </li>
              <li>
                <strong>Detection (D)</strong>
                <span>Detection score: 1 is easily detected before harm, 10 is unlikely to be detected</span>
              </li>
              <li>
                <strong>RPN</strong>
                <span>Risk Priority Number = S × O × D. Higher values indicate higher risk priority</span>
              </li>
              <li>
                <strong>Action</strong>
                <span>Recommended action to reduce risk or correct a confirmed issue</span>
              </li>
              <li>
                <strong>Evidence</strong>
                <span>Source count and citations behind the extracted FMEA fields</span>
              </li>
              <li>
                <strong>Status</strong>
                <span>Human review state for this row</span>
              </li>
            </ul>
            <h3>Row Status</h3>
            <ul className="source-list">
              <li>
                <strong>Needs Review</strong>
                <span>Row requires engineer review and validation</span>
              </li>
              <li>
                <strong>Accepted</strong>
                <span>Row has been reviewed and validated</span>
              </li>
              <li>
                <strong>Rejected</strong>
                <span>Row has been reviewed and rejected</span>
              </li>
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
