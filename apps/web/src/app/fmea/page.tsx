"use client";

import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  type ColumnDef,
  flexRender,
} from "@tanstack/react-table";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { EvidenceDrawer } from "@/components/fmea/evidence-drawer";
import { ScoringReferenceGuides } from "@/components/fmea/scoring-reference-guides";
import { WorksheetHelpDialog } from "@/components/fmea/worksheet-help-dialog";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { buildCsv, buildExcelWorkbook, downloadFile, type FmeaExportMode } from "@/lib/fmea/export";
import {
  editableFields,
  fieldHelp,
  groupRowsByComponent,
  scoreOptions,
  worksheetColumnSpecs,
  type EditableField,
} from "@/lib/fmea/table";
import type { FmeaRow, TaxonomySearchType } from "@/lib/fmea/types";
import {
  defaultAnalysisName,
  applyFmeaRowUpdate,
  applyEvidenceClaimReview,
  canPersistWorksheet,
  isComplete,
  knowledgeRowsToEvidenceRows,
  normalizeSavedRows,
  numericRowRpn,
  parseBom,
  rowRpn,
  rowsWithUniqueIds,
  sortedComponentNames,
  systemTemplates,
  templateRowsForComponents,
  toFmeaRows,
  type KnowledgeSearchResponse,
  type AnalysisLoadState,
  type LoadingAction,
  type SavedAnalysisResponse,
  type SelectionStep,
} from "@/lib/fmea/worksheet";

export default function FmeaPage() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}

function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNewMode = searchParams.get("mode") === "new";
  const savedAnalysisId = searchParams.get("analysis");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cellRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [selectionStep, setSelectionStep] = useState<SelectionStep>(
    isNewMode ? "initial" : "table",
  );
  const [rows, setRows] = useState<FmeaRow[]>(() => {
    return [];
  });
  const [componentFilter, setComponentFilter] = useState("All");
  const [rowFilter, setRowFilter] = useState("all");
  const [componentQuery, setComponentQuery] = useState("");
  const [knowledgeQuery, setKnowledgeQuery] = useState(searchParams.get("component") ?? "");
  const [knowledgeSearchType, setKnowledgeSearchType] = useState<TaxonomySearchType>("component");
  const [knowledgeDomain, setKnowledgeDomain] = useState("");
  const [newComponentName, setNewComponentName] = useState("");
  const [selectedSystemId, setSelectedSystemId] = useState("turbofan");
  const [currentAnalysisId, setCurrentAnalysisId] = useState<string | null>(null);
  const [expectedRowIds, setExpectedRowIds] = useState<string[] | null>(null);
  const [analysisLoadState, setAnalysisLoadState] = useState<AnalysisLoadState>(
    savedAnalysisId ? "loading" : "idle",
  );
  const [analysisLoadError, setAnalysisLoadError] = useState("");
  const [manualComponents, setManualComponents] = useState<string[]>([]);
  const [selectedSourceRow, setSelectedSourceRow] = useState<FmeaRow | null>(null);
  const [notice, setNotice] = useState(
    isNewMode
      ? "Start a new Failure Mode and Effects Analysis table by selecting components or importing a BOM."
      : savedAnalysisId
      ? "Loading saved Failure Mode and Effects Analysis table..."
      : "Loading current evidence from the shared knowledge taxonomy...",
  );
  const [analysisName, setAnalysisName] = useState(
    "Untitled Failure Mode and Effects Analysis",
  );
  const [sortMode, setSortMode] = useState<"component" | "rpn_desc" | "rpn_asc">("component");
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [focusedCellId, setFocusedCellId] = useState<string | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [expandedComponents, setExpandedComponents] = useState<Set<string>>(new Set());
  const [componentDropdownOpen, setComponentDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [cellViewer, setCellViewer] = useState<{ rowId: string; field: string; value: string } | null>(null);
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [searchWasTruncated, setSearchWasTruncated] = useState(false);
  const groupsPerPage = 6;
  const components = useMemo(
    () => {
      const rowComponents = Array.from(new Set(rows.map((row) => row.component)));
      return sortedComponentNames(rowComponents.length ? rowComponents : systemTemplates[0].components);
    },
    [rows],
  );
  const visibleRows = useMemo(
    () => {
      const filteredRows = rows.filter((row) => {
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
      });

      if (sortMode === "rpn_desc") {
        return [...filteredRows].sort((a, b) => numericRowRpn(b) - numericRowRpn(a) || b.evidenceCount - a.evidenceCount);
      }
      if (sortMode === "rpn_asc") {
        return [...filteredRows].sort((a, b) => numericRowRpn(a) - numericRowRpn(b) || b.evidenceCount - a.evidenceCount);
      }
      return filteredRows;
    },
    [componentFilter, componentQuery, rowFilter, rows, sortMode],
  );

  const includedRows = rows.filter((row) => row.included && row.status !== "rejected");
  const finalRows = rows.filter(
    (row) => row.included && row.status === "accepted" && row.provenance === "evidence" && isComplete(row) && row.evidence.length > 0,
  );
  const incompleteRows = includedRows.filter((row) => !isComplete(row));
  const canExportDraft = includedRows.length > 0;
  const canExportFinal = finalRows.length > 0;
  const canSave = canPersistWorksheet(analysisLoadState, currentAnalysisId, expectedRowIds);

  // Pagination keeps component groups intact, so related failure modes do not split oddly.
  const visibleGroupedData = useMemo(() => groupRowsByComponent(visibleRows), [visibleRows]);
  const totalPages = Math.max(1, Math.ceil(visibleGroupedData.length / groupsPerPage));
  const paginatedGroupedData = visibleGroupedData.slice(
    (currentPage - 1) * groupsPerPage,
    currentPage * groupsPerPage,
  );
  const renderedRows = paginatedGroupedData.flatMap((group) =>
    expandedComponents.has(group.component) ? group.childRows : [],
  );

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [componentFilter, componentQuery, rowFilter]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const loadSavedAnalysis = useCallback(async (analysisId: string, loadedNotice = "") => {
    setAnalysisLoadState("loading");
    setAnalysisLoadError("");
    setCurrentAnalysisId(null);
    setExpectedRowIds(null);
    setRows([]);
    setSelectionStep("table");
    setNotice("Loading saved Failure Mode and Effects Analysis table...");

    try {
      const response = await fetch(`/api/fmea/analyses/${analysisId}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as SavedAnalysisResponse;
      if (!response.ok || !payload.analysis) {
        throw new Error(payload.error || "Could not load this saved analysis.");
      }
      const loadedRows = normalizeSavedRows(payload.analysis.rows);
      setCurrentAnalysisId(payload.analysis.id);
      setExpectedRowIds(loadedRows.map((row) => row.id));
      setAnalysisName(payload.analysis.name);
      setRows(loadedRows);
      setLastSavedAt("Loaded from workspace");
      setHasUnsavedChanges(false);
      setAnalysisLoadState("ready");
      setNotice(loadedNotice);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load this saved analysis.";
      // Deliberately remain detached from the requested analysis. Save is
      // disabled until a successful retry supplies its verified row baseline.
      setCurrentAnalysisId(null);
      setExpectedRowIds(null);
      setRows([]);
      setAnalysisLoadState("error");
      setAnalysisLoadError(message);
      setNotice("");
    }
  }, []);

  useEffect(() => {
    const params =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();
    if (params.get("mode") === "new") {
      setSelectionStep("initial");
      setRows([]);
      setCurrentAnalysisId(null);
      setExpectedRowIds(null);
      setAnalysisLoadState("idle");
      setAnalysisName("Untitled Failure Mode and Effects Analysis");
      setNotice("Start a new Failure Mode and Effects Analysis table by selecting components or importing a BOM.");
      return;
    }

    const analysisId = params.get("analysis");
    if (analysisId) {
      void loadSavedAnalysis(analysisId);
      return;
    }

    const component = params.get("component") ?? "";
    setSelectionStep("table");
    setKnowledgeQuery(component);
    void loadKnowledgeSearch(component, false);
    // This is an initial route-state load; later searches are explicit form submissions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSavedAnalysis]);

  // Initialize all components as expanded
  useEffect(() => {
    const componentNames = sortedComponentNames(Array.from(new Set(rows.map(row => row.component))));
    setExpandedComponents(new Set(componentNames));
  }, [rows]);

  function toggleComponent(componentName: string) {
    setExpandedComponents(current => {
      const newSet = new Set(current);
      if (newSet.has(componentName)) {
        newSet.delete(componentName);
      } else {
        newSet.add(componentName);
      }
      return newSet;
    });
  }

  function toggleManualComponent(componentName: string) {
    setManualComponents(current => {
      const newSet = new Set(current);
      if (newSet.has(componentName)) {
        newSet.delete(componentName);
      } else {
        newSet.add(componentName);
      }
      return Array.from(newSet);
    });
  }

  function collapseAllComponents() {
    setExpandedComponents(new Set());
  }

  function expandAllComponents() {
    setExpandedComponents(new Set(components));
  }

  function openCellViewer(rowId: string, field: string, value: string) {
    setCellViewer({ rowId, field, value });
  }

  function saveCellViewer(newValue: string) {
    if (!cellViewer) return;
    const fieldMap: Record<string, keyof FmeaRow> = {
      "Function": "function",
      "Industry": "industry",
      "Failure Mode": "failureMode",
      "Effect": "effect",
      "Cause": "cause",
      "Controls": "currentControl",
      "Action": "correctiveAction",
    };
    const field = fieldMap[cellViewer.field];
    if (field) {
      updateRow(cellViewer.rowId, { [field]: newValue });
    }
    setCellViewer(null);
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: globalThis.MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setComponentDropdownOpen(false);
      }
    }
    if (componentDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [componentDropdownOpen]);

  function confirmWorksheetReplacement(action: string) {
    if (!hasUnsavedChanges) return true;
    return window.confirm(
      `You have unsaved worksheet changes. Discard them and continue ${action}?`,
    );
  }

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const protectedUrl = window.location.href;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const handleDocumentNavigation = (event: globalThis.MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      if (!window.confirm("You have unsaved worksheet changes. Discard them and leave this page?")) {
        event.preventDefault();
        event.stopPropagation();
      } else {
        setHasUnsavedChanges(false);
      }
    };
    const handleHistoryNavigation = () => {
      if (window.confirm("You have unsaved worksheet changes. Discard them and leave this page?")) {
        setHasUnsavedChanges(false);
        return;
      }
      const protectedLocation = new URL(protectedUrl);
      window.history.pushState(null, "", `${protectedLocation.pathname}${protectedLocation.search}${protectedLocation.hash}`);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handleHistoryNavigation);
    document.addEventListener("click", handleDocumentNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handleHistoryNavigation);
      document.removeEventListener("click", handleDocumentNavigation, true);
    };
  }, [hasUnsavedChanges]);

  const saveFmea = useCallback((options?: { redirectToDashboard?: boolean }) => {
    if (!canPersistWorksheet(analysisLoadState, currentAnalysisId, expectedRowIds)) {
      setNotice(
        analysisLoadState === "error"
          ? "This analysis was not loaded, so it cannot be saved. Retry the load or start a new worksheet."
          : "Wait for the analysis to finish loading before saving.",
      );
      return;
    }
    setIsSaving(true);
    const savedName = analysisName.trim() || defaultAnalysisName(rows);

    fetch("/api/fmea/analyses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        id: currentAnalysisId,
        name: savedName,
        rows,
        expectedRowIds: currentAnalysisId ? expectedRowIds : undefined,
      }),
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as SavedAnalysisResponse;
        if (!response.ok || !payload.analysis) {
          throw new Error(payload.error || "Failed to save Failure Mode and Effects Analysis data.");
        }

        const now = new Date().toLocaleString();
        setCurrentAnalysisId(payload.analysis.id);
        setAnalysisName(savedName);
        setLastSavedAt(now);
        const savedRows = normalizeSavedRows(payload.analysis.rows);
        setRows(savedRows);
        setExpectedRowIds(savedRows.map((row) => row.id));
        setAnalysisLoadState("ready");
        setHasUnsavedChanges(false);
        setNotice(`Saved "${savedName}".`);
        setTimeout(() => setNotice(""), 3000);
        if (typeof window !== "undefined" && !currentAnalysisId) {
          window.history.replaceState(null, "", `/fmea?analysis=${payload.analysis.id}`);
        }
        if (options?.redirectToDashboard) {
          router.push("/dashboard");
        }
      })
      .catch((error) => {
        setNotice(error instanceof Error ? error.message : "Failed to save Failure Mode and Effects Analysis data.");
        setTimeout(() => setNotice(""), 3000);
      })
      .finally(() => {
        setIsSaving(false);
      });
  }, [analysisLoadState, analysisName, currentAnalysisId, expectedRowIds, router, rows]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditingText = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
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
        if (showExitDialog) {
          setShowExitDialog(false);
        } else if (selectedSourceRow) {
          setSelectedSourceRow(null);
        } else if (showHelpModal) {
          setShowHelpModal(false);
        } else if (showExportDropdown) {
          setShowExportDropdown(false);
        } else if (focusedCellId) {
          setFocusedCellId(null);
        } else if (cellViewer) {
          setCellViewer(null);
        }
      }

      // Ctrl+A to select all visible rows
      if ((event.ctrlKey || event.metaKey) && event.key === "a") {
        if (isEditingText || !target?.closest("#worksheet")) return;
        event.preventDefault();
        const newSelection = new Set(visibleRows.map((row) => row.id));
        setSelectedRowIds(newSelection);
      }

      // Delete to remove selected rows
      if (event.key === "Delete" && selectedRowIds.size > 0) {
        if (isEditingText) return;
        event.preventDefault();
        if (confirm(`Delete ${selectedRowIds.size} selected row${selectedRowIds.size === 1 ? "" : "s"}?`)) {
          setRows((currentRows) => currentRows.filter((row) => !selectedRowIds.has(row.id)));
          setSelectedRowIds(new Set());
          setHasUnsavedChanges(true);
        }
      }

    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedSourceRow, showExportDropdown, visibleRows, selectedRowIds, focusedCellId, showHelpModal, cellViewer, showExitDialog, saveFmea]);

  const isLoading = loadingAction !== null;

  function updateRow(id: string, update: Partial<FmeaRow>) {
    const normalizedUpdate = update.status === "rejected" ? { ...update, included: false } : update;
    setRows((currentRows) =>
      currentRows.map((row) => (row.id === id ? applyFmeaRowUpdate(row, normalizedUpdate) : row)),
    );
    setSelectedSourceRow((current) =>
      current?.id === id ? applyFmeaRowUpdate(current, normalizedUpdate) : current,
    );
    setHasUnsavedChanges(true);
  }

  async function reviewEvidenceClaim(
    claimId: string,
    status: "accepted" | "rejected" | "needs_review",
  ) {
    const response = await fetch("/api/knowledge/review", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ claimId, status }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(payload.error || "Could not update evidence review.");
    setRows((currentRows) =>
      currentRows.map((row) => applyEvidenceClaimReview(row, claimId, status)),
    );
    setSelectedSourceRow((current) =>
      current ? applyEvidenceClaimReview(current, claimId, status) : current,
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

  const focusCell = useCallback((rowId: string, field: EditableField) => {
    const target = cellRefs.current.get(`${rowId}:${field}`);
    target?.focus();
  }, []);

  const handleTableCellKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLElement>,
    rowId: string,
    field: EditableField,
  ) => {
    if (event.key !== "Tab") return;
    const rowIndex = renderedRows.findIndex((row) => row.id === rowId);
    const fieldIndex = editableFields.indexOf(field);
    if (rowIndex < 0 || fieldIndex < 0) return;

    const flatIndex = rowIndex * editableFields.length + fieldIndex;
    const nextFlatIndex = flatIndex + (event.shiftKey ? -1 : 1);
    const maxIndex = renderedRows.length * editableFields.length - 1;
    // At worksheet boundaries retain the browser's native Tab behavior so
    // keyboard focus can leave the grid in either direction.
    if (nextFlatIndex < 0 || nextFlatIndex > maxIndex) return;
    const nextRow = renderedRows[Math.floor(nextFlatIndex / editableFields.length)];
    const nextField = editableFields[nextFlatIndex % editableFields.length];
    if (!nextRow || !nextField || !cellRefs.current.has(`${nextRow.id}:${nextField}`)) return;
    event.preventDefault();
    focusCell(nextRow.id, nextField);
  }, [focusCell, renderedRows]);

  const editableCellClass = useCallback((rowId: string, field: EditableField) => {
    return focusedCellId === `${rowId}:${field}` ? "cell-focused" : "";
  }, [focusedCellId]);

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
    if (!confirmWorksheetReplacement("with the BOM import")) return;
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
      setSearchWasTruncated(false);
      setCurrentAnalysisId(null);
      setExpectedRowIds(null);
      setAnalysisLoadState("idle");
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

  async function startManualWorksheet() {
    if (!confirmWorksheetReplacement("with a new manual worksheet")) return;
    const nextComponents = manualComponents.length ? manualComponents : components.slice(0, 5);
    setLoadingAction("system");
    setComponentFilter("All");
    setComponentQuery("");
    setRowFilter("all");
    try {
      const evidenceResult = await fetchKnowledgeRowsForComponents(nextComponents);
      const nextRows = evidenceResult.rows.length ? toFmeaRows(evidenceResult.rows) : templateRowsForComponents(nextComponents);
      setRows(nextRows);
      setSearchWasTruncated(evidenceResult.hasNext);
      setCurrentAnalysisId(null);
      setExpectedRowIds(null);
      setAnalysisLoadState("idle");
      setAnalysisName(defaultAnalysisName(nextRows));
      setNotice(
        evidenceResult.rows.length
          ? `Loaded ${nextRows.length} evidence-backed analysis row${nextRows.length === 1 ? "" : "s"} for ${nextComponents.length} selected component${nextComponents.length === 1 ? "" : "s"}.`
          : `Started a manual worksheet with ${nextComponents.length} component${nextComponents.length === 1 ? "" : "s"}.`,
      );
    } catch {
      const nextRows = templateRowsForComponents(nextComponents);
      setRows(nextRows);
      setSearchWasTruncated(false);
      setCurrentAnalysisId(null);
      setExpectedRowIds(null);
      setAnalysisLoadState("idle");
      setAnalysisName(defaultAnalysisName(nextRows));
      setNotice(`Live evidence could not be loaded. Started a manual worksheet with ${nextComponents.length} component${nextComponents.length === 1 ? "" : "s"}.`);
    } finally {
      setSelectionStep("table");
      setHasUnsavedChanges(true);
      setLoadingAction(null);
    }
  }

  async function fetchKnowledgeEvidence(
    query: string,
    type: TaxonomySearchType,
    domain = "",
  ) {
    const pageSize = 500;
    const maximumRows = 5_000;
    let offset = 0;
    let total = 0;
    let hasNext = false;
    let taxonomyMatch: KnowledgeSearchResponse["taxonomyMatch"] = null;
    const loadedRows = [] as ReturnType<typeof knowledgeRowsToEvidenceRows>;

    do {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset), type });
      if (query.trim()) params.set("q", query.trim());
      if (domain.trim()) params.set("domain", domain.trim());
      const response = await fetch(`/api/knowledge/search?${params.toString()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as KnowledgeSearchResponse;
        throw new Error(payload.error || `Failed to load knowledge evidence (${response.status})`);
      }
      const payload = (await response.json()) as KnowledgeSearchResponse;
      const pageRows = knowledgeRowsToEvidenceRows(payload.rows ?? []);
      loadedRows.push(...pageRows);
      taxonomyMatch ??= payload.taxonomyMatch ?? null;
      total = payload.total ?? loadedRows.length;
      hasNext = payload.pagination?.hasNext ?? offset + pageRows.length < total;
      offset += pageRows.length;
      if (!pageRows.length) break;
    } while (hasNext && loadedRows.length < maximumRows);

    return {
      rows: loadedRows.slice(0, maximumRows),
      taxonomyMatch,
      total,
      hasNext: hasNext && loadedRows.length >= maximumRows,
    };
  }

  async function fetchKnowledgeRowsForComponents(componentNames: string[]) {
    const results = new Array<Awaited<ReturnType<typeof fetchKnowledgeEvidence>>>(componentNames.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(4, componentNames.length) }, async () => {
      while (nextIndex < componentNames.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await fetchKnowledgeEvidence(componentNames[index], "component");
      }
    });
    await Promise.all(workers);
    return {
      rows: results.flatMap((result) => result.rows),
      hasNext: results.some((result) => result.hasNext),
    };
  }

  async function loadKnowledgeSearch(
    query: string,
    markUnsaved = true,
    type: TaxonomySearchType = knowledgeSearchType,
  ) {
    if (markUnsaved && !confirmWorksheetReplacement("with these search results")) return;
    setLoadingAction("system");
    const searchLabel = type === "failure_mode" ? "failure mode" : "component";
    setNotice(query.trim() ? `Searching current ${searchLabel} taxonomy for “${query.trim()}”...` : "Loading current evidence from the knowledge graph...");
    try {
      const result = await fetchKnowledgeEvidence(query, type, knowledgeDomain);
      const nextRows = toFmeaRows(result.rows);
      setRows(nextRows);
      setComponentFilter("All");
      setComponentQuery("");
      setSelectionStep("table");
      setCurrentAnalysisId(null);
      setExpectedRowIds(null);
      setAnalysisLoadState("idle");
      setAnalysisName(query.trim() ? `${result.taxonomyMatch?.name ?? query.trim()} Failure Mode and Effects Analysis` : "Knowledge evidence review");
      setHasUnsavedChanges(markUnsaved);
      setSearchWasTruncated(result.hasNext);
      setNotice(
        nextRows.length
          ? `${nextRows.length} grouped evidence row${nextRows.length === 1 ? "" : "s"} loaded from ${result.total} matching claim${result.total === 1 ? "" : "s"}${result.taxonomyMatch ? ` under ${result.taxonomyMatch.name}` : ""}.${result.hasNext ? " The result set exceeds 5,000 claims; refine the query or domain to load the remainder." : ""} Scores require engineer input.`
          : `No linked evidence found for “${query.trim()}” in the ${searchLabel} taxonomy.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load current knowledge evidence.");
    } finally {
      setLoadingAction(null);
    }
  }

  async function addTypedComponent() {
    const rawComponent = newComponentName.trim();
    if (!rawComponent) return;

    const component = rawComponent;
    const componentKey = component.toLowerCase();
    const existingComponentKeys = new Set(
      rows
        .map((row) => row.component.trim().toLowerCase())
        .filter(Boolean),
    );

    if (existingComponentKeys.has(componentKey)) {
      setComponentFilter(component);
      setExpandedComponents((current) => new Set([...current, component]));
      setNotice(`${component} is already in this Failure Mode and Effects Analysis. Showing that component now.`);
      setNewComponentName("");
      return;
    }

    setLoadingAction("system");
    try {
      const evidenceRows = (await fetchKnowledgeEvidence(component, "component")).rows;
      const generatedRows = evidenceRows.length ? toFmeaRows(evidenceRows) : templateRowsForComponents([component]);
      const rowsToAdd = rowsWithUniqueIds(generatedRows, rows);
      setRows((currentRows) => [...currentRows, ...rowsToAdd]);
      setComponentFilter("All");
      setExpandedComponents((current) => new Set([...current, ...rowsToAdd.map((row) => row.component)]));
      setNotice(
        evidenceRows.length
          ? `Added ${rowsToAdd.length} evidence-backed row${rowsToAdd.length === 1 ? "" : "s"} for ${component}.`
          : `Added starter Failure Mode and Effects Analysis rows for ${component}.`,
      );
    } catch {
      const generatedRows = templateRowsForComponents([component]);
      const rowsToAdd = rowsWithUniqueIds(generatedRows, rows);
      setRows((currentRows) => [...currentRows, ...rowsToAdd]);
      setComponentFilter("All");
      setExpandedComponents((current) => new Set([...current, ...rowsToAdd.map((row) => row.component)]));
      setNotice(`Live evidence could not be loaded. Added starter rows for ${component}.`);
    } finally {
      setNewComponentName("");
      setHasUnsavedChanges(true);
      setSelectionStep("table");
      setLoadingAction(null);
    }
  }

  function addBlankFailureModeRow() {
    const component = componentFilter !== "All" ? componentFilter : components[0];
    if (!component) {
      setNotice("Add a component before adding a failure-mode row.");
      return;
    }
    const [blankRow] = rowsWithUniqueIds(templateRowsForComponents([component]), rows);
    setRows((currentRows) => [...currentRows, blankRow]);
    setExpandedComponents((current) => new Set([...current, component]));
    setSelectedRowIds(new Set([blankRow.id]));
    setHasUnsavedChanges(true);
    setNotice(`Added a blank, unconfirmed row for ${component}. It is excluded from final export.`);
  }

  function duplicateSelectedRows() {
    const selectedRows = rows.filter((row) => selectedRowIds.has(row.id));
    if (!selectedRows.length) return;
    const duplicates = rowsWithUniqueIds(
      selectedRows.map((row) => ({
        ...row,
        id: `${row.id}-copy`,
        status: "needs_review" as const,
        included: false,
        reviewedAt: undefined,
      })),
      rows,
    );
    setRows((currentRows) => [...currentRows, ...duplicates]);
    setSelectedRowIds(new Set(duplicates.map((row) => row.id)));
    setHasUnsavedChanges(true);
    setNotice(`Duplicated ${duplicates.length} row${duplicates.length === 1 ? "" : "s"}. Review and include each copy explicitly.`);
  }

  function deleteSelectedRows() {
    if (!selectedRowIds.size) return;
    if (!window.confirm(`Delete ${selectedRowIds.size} selected row${selectedRowIds.size === 1 ? "" : "s"}?`)) return;
    setRows((currentRows) => currentRows.filter((row) => !selectedRowIds.has(row.id)));
    setSelectedRowIds(new Set());
    setHasUnsavedChanges(true);
  }

  async function loadSystem(systemId: string) {
    const nextSystem = systemTemplates.find((system) => system.id === systemId);
    if (!nextSystem) return;
    if (!confirmWorksheetReplacement(`with ${nextSystem.name}`)) return;
    setLoadingAction("system");
    setSelectedSystemId(systemId);
    setComponentFilter("All");
    setComponentQuery("");
    try {
      const evidenceResult = await fetchKnowledgeRowsForComponents(nextSystem.components);
      const nextRows = toFmeaRows(evidenceResult.rows);
      setRowFilter("all");
      setRows(nextRows);
      setCurrentAnalysisId(null);
      setExpectedRowIds(null);
      setAnalysisLoadState("idle");
      setSearchWasTruncated(evidenceResult.hasNext);
      setAnalysisName(defaultAnalysisName(nextRows));
      setNotice(`Loaded ${nextRows.length} current evidence-backed rows for ${nextSystem.name}. Scores require engineer input.`);
      setSelectionStep("table");
      setHasUnsavedChanges(true);
    } catch {
      setRowFilter("all");
      setNotice("Could not load live evidence. Your current worksheet was preserved; retry the knowledge search or start a manual worksheet.");
    } finally {
      setLoadingAction(null);
    }
  }

  function exitToDashboard() {
    setShowExportDropdown(false);
    if (hasUnsavedChanges) {
      setShowExitDialog(true);
      return;
    }
    router.push("/dashboard");
  }

  function discardAndExit() {
    setShowExitDialog(false);
    setHasUnsavedChanges(false);
    router.push("/dashboard");
  }

  function saveAndExit() {
    setShowExitDialog(false);
    saveFmea({ redirectToDashboard: true });
  }

  function recoverWithNewWorksheet() {
    setCurrentAnalysisId(null);
    setExpectedRowIds(null);
    setAnalysisLoadState("idle");
    setAnalysisLoadError("");
    setRows([]);
    setSearchWasTruncated(false);
    setAnalysisName("Untitled Failure Mode and Effects Analysis");
    setHasUnsavedChanges(false);
    setSelectionStep("initial");
    window.history.replaceState(null, "", "/fmea?mode=new");
  }

  function handleManualSelection() {
    startManualWorksheet();
  }

  function exportData(format: "csv" | "excel", mode: FmeaExportMode) {
    setIsExporting(true);
    setLoadingAction("export");
    setTimeout(() => {
      if (format === "csv") {
        downloadFile(`risk-on-radar-fmea-${mode}.csv`, "text/csv;charset=utf-8", buildCsv(rows, mode));
      } else {
        downloadFile(
          `risk-on-radar-fmea-${mode}.xlsx`,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buildExcelWorkbook(rows, mode),
        );
      }
      setShowExportDropdown(false);
      setIsExporting(false);
      setLoadingAction(null);
    }, 100);
  }

  function HeaderLabel({ field, label }: { field: string; label: string }) {
    const helpText = fieldHelp[field];
    return (
      <span
        className={`header-label header-label-${field}`}
        aria-label={helpText ? `${label}: ${helpText}` : label}
        title={helpText || undefined}
      >
        <span className="header-label-text">{label}</span>
      </span>
    );
  }

  function renderLongTextCell(row: FmeaRow, field: EditableField, label: string, value: string) {
    const displayValue = value.trim() || `Add ${label.toLowerCase()}`;
    const openText = () => openCellViewer(row.id, label, value);

    return (
      <button
        ref={(element) => registerCell(row.id, field, element)}
        type="button"
        className={`fmea-cell-control fmea-text-open ${editableCellClass(row.id, field)}`}
        aria-label={`Open full ${label.toLowerCase()} text for ${row.component} - ${row.failureMode}`}
        title={value || `Open ${label.toLowerCase()} text`}
        onClick={(event) => {
          event.stopPropagation();
          openText();
        }}
        onFocus={() => setFocusedCellId(`${row.id}:${field}`)}
        onBlur={() => setFocusedCellId(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            openText();
            return;
          }
          handleTableCellKeyDown(event, row.id, field);
        }}
      >
        {displayValue}
      </button>
    );
  }

  function renderScoreCell(
    row: FmeaRow,
    field: "severity" | "occurrence" | "detection",
    label: "Severity" | "Occurrence" | "Detection",
  ) {
    const suggestion = row.scoreSuggestions?.[field];
    return (
      <div className="score-input-stack">
        <select
          ref={(element) => registerCell(row.id, field, element)}
          value={row[field]}
          onChange={(event) => updateRow(row.id, { [field]: event.target.value })}
          className={`fmea-cell-control fmea-score-control ${editableCellClass(row.id, field)}`}
          aria-label={`${label} engineer input for ${row.component} - ${row.failureMode}`}
          title={row[field] ? `${label} ${row[field]} (engineer input)` : `${label} requires engineer input`}
          onFocus={() => setFocusedCellId(`${row.id}:${field}`)}
          onBlur={() => setFocusedCellId(null)}
          onKeyDown={(event) => handleTableCellKeyDown(event, row.id, field)}
        >
          <option value="">-</option>
          {scoreOptions.map((score) => (
            <option key={score} value={score}>
              {score}
            </option>
          ))}
        </select>
        {suggestion && (
          <button
            type="button"
            className="score-suggestion"
            title={`Heuristic suggestion only: ${suggestion.rationale}`}
            aria-label={`Apply heuristic ${label.toLowerCase()} suggestion ${suggestion.value}. ${suggestion.rationale}`}
            onClick={(event) => {
              event.stopPropagation();
              updateRow(row.id, { [field]: suggestion.value });
            }}
          >
            Suggested {suggestion.value}
          </button>
        )}
      </div>
    );
  }

  // TanStack Table columns
  const columns: ColumnDef<FmeaRow>[] = [
      {
        id: "included",
        header: () => <HeaderLabel field="included" label="✓" />,
        cell: ({ row }) => {
          const toggleIncluded = () => updateRow(row.original.id, { included: !row.original.included });
          return (
            <label className="fmea-checkbox-hitarea" onClick={(event) => event.stopPropagation()}>
              <span className="visually-hidden">
                Include {row.original.component} - {row.original.failureMode} in draft export and,
                when eligible, final export
              </span>
              <input
                ref={(element) => registerCell(row.original.id, "included", element)}
                type="checkbox"
                checked={row.original.included}
                onChange={(event) => {
                  event.stopPropagation();
                  toggleIncluded();
                }}
                onClick={(event) => event.stopPropagation()}
                className="fmea-checkbox"
                title="Include this row in exports. Final export additionally requires accepted, complete evidence-backed content."
                onFocus={() => setFocusedCellId(`${row.original.id}:included`)}
                onBlur={() => setFocusedCellId(null)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") {
                    event.preventDefault();
                    toggleIncluded();
                    return;
                  }
                  handleTableCellKeyDown(event, row.original.id, "included");
                }}
              />
            </label>
          );
        },
        size: 44,
      },
      {
        accessorKey: "component",
        header: () => <HeaderLabel field="component" label="Component" />,
        cell: ({ row }) => <span className="visually-hidden">{row.original.component}</span>,
        size: 120,
      },
      {
        accessorKey: "function",
        header: () => <HeaderLabel field="function" label="Function" />,
        cell: ({ row }) => renderLongTextCell(row.original, "function", "Function", row.original.function),
        size: 142,
      },
      {
        accessorKey: "industry",
        header: () => <HeaderLabel field="industry" label="Industry" />,
        cell: ({ row }) => renderLongTextCell(row.original, "industry", "Industry", row.original.industry),
        size: 88,
      },
      {
        accessorKey: "failureMode",
        header: () => <HeaderLabel field="failureMode" label="Failure Mode" />,
        cell: ({ row }) => renderLongTextCell(row.original, "failureMode", "Failure Mode", row.original.failureMode),
        size: 150,
      },
      {
        accessorKey: "effect",
        header: () => <HeaderLabel field="effect" label="Effect" />,
        cell: ({ row }) => renderLongTextCell(row.original, "effect", "Effect", row.original.effect),
        size: 164,
      },
      {
        accessorKey: "severity",
        header: () => <HeaderLabel field="severity" label="S" />,
        cell: ({ row }) => renderScoreCell(row.original, "severity", "Severity"),
        size: 72,
      },
      {
        accessorKey: "cause",
        header: () => <HeaderLabel field="cause" label="Cause" />,
        cell: ({ row }) => renderLongTextCell(row.original, "cause", "Cause", row.original.cause),
        size: 164,
      },
      {
        accessorKey: "occurrence",
        header: () => <HeaderLabel field="occurrence" label="O" />,
        cell: ({ row }) => renderScoreCell(row.original, "occurrence", "Occurrence"),
        size: 72,
      },
      {
        accessorKey: "currentControl",
        header: () => <HeaderLabel field="currentControl" label="Controls" />,
        cell: ({ row }) => renderLongTextCell(row.original, "currentControl", "Controls", row.original.currentControl),
        size: 154,
      },
      {
        accessorKey: "detection",
        header: () => <HeaderLabel field="detection" label="D" />,
        cell: ({ row }) => renderScoreCell(row.original, "detection", "Detection"),
        size: 72,
      },
      {
        accessorKey: "rpn",
        header: () => <HeaderLabel field="rpn" label="RPN" />,
        cell: ({ row }) => <span className="rpn-value">{rowRpn(row.original) || "-"}</span>,
        size: 52,
      },
      {
        accessorKey: "correctiveAction",
        header: () => <HeaderLabel field="correctiveAction" label="Action" />,
        cell: ({ row }) => renderLongTextCell(row.original, "correctiveAction", "Action", row.original.correctiveAction),
        size: 150,
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
        size: 82,
      },
      {
        accessorKey: "status",
        header: () => <HeaderLabel field="status" label="State" />,
        cell: ({ row }) => (
          <select
            ref={(element) => registerCell(row.original.id, "status", element)}
            value={row.original.status}
            onChange={(e) => {
              const status = e.target.value as FmeaRow["status"];
              if (status === "accepted" && !isComplete(row.original)) {
                setNotice("Complete the required engineering fields before accepting this row.");
                return;
              }
              updateRow(row.original.id, { status });
            }}
            className={`fmea-cell-control status-control status-${row.original.status} ${editableCellClass(row.original.id, "status")}`}
            aria-label={`Review status for ${row.original.component} - ${row.original.failureMode}`}
            title={row.original.status.replace("_", " ")}
            onFocus={() => setFocusedCellId(`${row.original.id}:status`)}
            onBlur={() => setFocusedCellId(null)}
            onKeyDown={(e) => handleTableCellKeyDown(e, row.original.id, "status")}
          >
            <option value="needs_review">Needs review</option>
            <option value="edited">Edited · review again</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        ),
        size: 44,
      },
    ];

  const visibleColumnCount = columns.length - 1;

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: visibleRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });
  const tableRowsById = new Map(
    table.getRowModel().rows.map((tableRow) => [tableRow.original.id, tableRow] as const),
  );

  const selectedTemplate = systemTemplates.find((system) => system.id === selectedSystemId) ?? systemTemplates[0];

  if (selectionStep === "initial") {
    return (
      <div className="app-shell">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>

        <AppNav />

        <main id="main-content" className="app-main">
          <section className="workflow-card">
            <div className="workspace-start-layout">
              <div className="workspace-start-intro">
                <div className="page-heading workspace-start-heading">
                  <span className="metric-label">Evidence-backed Failure Mode and Effects Analysis workspace</span>
                  <h1>Start from a system model, then review the evidence row by row.</h1>
                  <p>
                    Load a prepared reliability workspace, narrow the analysis to selected components,
                    or import a BOM to generate an editable Failure Mode and Effects Analysis worksheet with citations.
                  </p>
                </div>
              </div>

              <div className="workspace-start-actions">
                <div className="workspace-start-panel workspace-start-panel-primary">
                  <div className="workspace-panel-heading">
                    <label className="field-label" htmlFor="system-template">
                      Select system
                    </label>
                    <strong>{selectedTemplate.name}</strong>
                    <span>{selectedTemplate.domain}</span>
                  </div>
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
                  <p>{selectedTemplate.description}</p>
                  <span>{selectedTemplate.source}</span>
                  <button
                    className="btn btn-primary btn-full"
                    type="button"
                    onClick={() => loadSystem(selectedSystemId)}
                    disabled={isLoading}
                  >
                    {isLoading ? "Loading..." : "Open selected system"}
                  </button>
                </div>

                <div className="choice-divider" aria-hidden="true">
                  or
                </div>

                <div className="workspace-start-secondary">
                  <div className="workspace-start-panel">
                    <label className="field-label" htmlFor="manual-component">
                      Select components manually
                    </label>
                    <div className="component-picker" ref={dropdownRef}>
                      <button
                        type="button"
                        id="manual-component"
                        className="text-input component-picker-trigger"
                        onClick={() => setComponentDropdownOpen(!componentDropdownOpen)}
                        aria-expanded={componentDropdownOpen}
                        aria-controls="manual-component-list"
                      >
                        <span>
                          {manualComponents.length > 0
                            ? `${manualComponents.length} component${manualComponents.length === 1 ? "" : "s"} selected`
                            : "Choose components"
                          }
                        </span>
                        <span aria-hidden="true">v</span>
                      </button>
                      {componentDropdownOpen && (
                        <div id="manual-component-list" className="component-dropdown" role="group" aria-label="Available components">
                          {components.map((component) => (
                            <label key={component} className="dropdown-option">
                              <input
                                type="checkbox"
                                checked={manualComponents.includes(component)}
                                onChange={() => {
                                  toggleManualComponent(component);
                                  setComponentDropdownOpen(false);
                                }}
                              />
                              <span>{component}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="component-chip-list" aria-label="Selected components">
                      {manualComponents.map((component) => (
                        <span key={component} className="component-chip">
                          {component}
                          <button
                            type="button"
                            className="chip-remove"
                            onClick={() => toggleManualComponent(component)}
                            aria-label={`Remove ${component}`}
                          >
                            ×
                          </button>
                        </span>
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

                  <div className="choice-divider choice-divider-inline" aria-hidden="true">
                    or
                  </div>

                  <button
                    className="dropzone"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={handleDrop}
                    disabled={isLoading}
                  >
                    <span>Import BOM</span>
                    <strong>{isLoading ? "Processing..." : "Drop BOM or component list here"}</strong>
                    <small>.csv, .tsv, or .txt</small>
                  </button>
                </div>
              </div>

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
        <h1 className="visually-hidden">
          {analysisName || "Failure Mode and Effects Analysis worksheet"}
        </h1>
        <section className="workflow-card worksheet-workspace">
          {/* Worksheet header actions */}
          <div className="fmea-header">
            <div>
              <button
                onClick={exitToDashboard}
                className="worksheet-exit"
                type="button"
                aria-label="Exit to dashboard"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
                  <path d="M8.8 4.2 3 10l5.8 5.8 1.2-1.2L6.3 10.9H17V9.1H6.3L10 5.4 8.8 4.2Z" />
                </svg>
                <span>Exit to dashboard</span>
              </button>
              <span className="metric-label">Failure Mode and Effects Analysis worksheet</span>
              <label className="analysis-name-field">
                <span className="visually-hidden">Failure Mode and Effects Analysis name</span>
                <input
                  value={analysisName}
                  onChange={(event) => {
                    setAnalysisName(event.target.value);
                    setHasUnsavedChanges(true);
                  }}
                  aria-label="Failure Mode and Effects Analysis name"
                />
              </label>
            </div>
            <div className="fmea-header-actions">
              <button
                onClick={() => saveFmea()}
                className="btn btn-secondary btn-sm"
                type="button"
                disabled={isSaving || !canSave}
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
                  disabled={isExporting || (!canExportFinal && !canExportDraft)}
                  aria-expanded={showExportDropdown}
                  aria-controls="fmea-export-options"
                  aria-describedby={!canExportFinal && !canExportDraft ? "export-disabled-reason" : undefined}
                >
                  {isExporting ? "Exporting..." : "Export"}
                </button>
                {!canExportFinal && !canExportDraft && (
                  <span id="export-disabled-reason" className="visually-hidden">
                    Include at least one non-rejected row before creating a draft export.
                  </span>
                )}
                {showExportDropdown && (
                  <div id="fmea-export-options" className="export-dropdown" aria-label="Export formats">
                    <button
                      type="button"
                      onClick={() => exportData("excel", "final")}
                      disabled={!canExportFinal}
                    >
                      Final Excel · accepted evidence only
                    </button>
                    <button
                      type="button"
                      onClick={() => exportData("csv", "final")}
                      disabled={!canExportFinal}
                    >
                      Final CSV · accepted evidence only
                    </button>
                    <button
                      type="button"
                      onClick={() => exportData("excel", "draft")}
                      disabled={!canExportDraft}
                    >
                      Draft Excel · review required
                    </button>
                    <button
                      type="button"
                      onClick={() => exportData("csv", "draft")}
                      disabled={!canExportDraft}
                    >
                      Draft CSV · review required
                    </button>
                  </div>
                )}
                {(canExportFinal || canExportDraft) && (
                  <span className="export-hint" role="status">
                    {finalRows.length} final-ready · {includedRows.length - finalRows.length} draft-only
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowHelpModal(true)}
                className="worksheet-help"
                type="button"
                aria-label="Keyboard shortcuts and help"
              >
                Help
              </button>
            </div>
          </div>

          {analysisLoadState === "error" && (
            <section className="notice" role="alert" aria-labelledby="analysis-load-error-title">
              <h2 id="analysis-load-error-title">This saved analysis was not loaded</h2>
              <p>{analysisLoadError}</p>
              <p>No analysis ID or row baseline is attached to this empty recovery view, so Save is disabled.</p>
              <div className="dialog-actions">
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  onClick={() => savedAnalysisId && void loadSavedAnalysis(savedAnalysisId)}
                  disabled={!savedAnalysisId}
                >
                  Retry load
                </button>
                <button className="btn btn-secondary btn-sm" type="button" onClick={recoverWithNewWorksheet}>
                  Start a separate new worksheet
                </button>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => router.push("/dashboard")}>
                  Return to dashboard
                </button>
              </div>
            </section>
          )}

          {/* Worksheet Controls */}
          <div className="worksheet-controls" aria-disabled={analysisLoadState === "error" || analysisLoadState === "loading"}>
            <form
              className="control-field control-field-wide knowledge-search-control"
              onSubmit={(event) => {
                event.preventDefault();
                void loadKnowledgeSearch(knowledgeQuery, true, knowledgeSearchType);
              }}
            >
              <label className="field-label" htmlFor="knowledge-search">
                Search shared knowledge
              </label>
              <div className="add-component-control">
                <select
                  aria-label="Shared knowledge taxonomy"
                  value={knowledgeSearchType}
                  onChange={(event) => setKnowledgeSearchType(event.target.value as TaxonomySearchType)}
                >
                  <option value="component">Component</option>
                  <option value="failure_mode">Failure mode</option>
                </select>
                <input
                  id="knowledge-search"
                  className="text-input"
                  type="search"
                  placeholder={knowledgeSearchType === "failure_mode" ? "Low-cycle fatigue, corrosion, wear..." : "Bearing, gearbox, pump, turbine blade..."}
                  value={knowledgeQuery}
                  onChange={(event) => setKnowledgeQuery(event.target.value)}
                />
                <input
                  className="text-input"
                  type="text"
                  aria-label="Operating domain or application filter"
                  placeholder="Domain (optional)"
                  value={knowledgeDomain}
                  onChange={(event) => setKnowledgeDomain(event.target.value)}
                />
                <button className="btn btn-primary btn-sm" type="submit" disabled={loadingAction === "system"}>
                  Search
                </button>
              </div>
            </form>

            <div className="control-field control-field-wide">
              <label className="field-label" htmlFor="component-search">
                Filter loaded rows
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

            <div className="control-field">
              <label className="field-label" htmlFor="sort-mode">
                Sort
              </label>
              <select
                id="sort-mode"
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as typeof sortMode)}
              >
                <option value="component">Component order</option>
                <option value="rpn_desc">Highest RPN first</option>
                <option value="rpn_asc">Lowest RPN first</option>
              </select>
            </div>

            <div className="control-field control-field-add">
              <label className="field-label" htmlFor="add-component">
                Add component
              </label>
              <div className="add-component-control">
                <input
                  id="add-component"
                  className="text-input"
                  type="text"
                  placeholder="Type component..."
                  value={newComponentName}
                  onChange={(event) => setNewComponentName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void addTypedComponent();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void addTypedComponent()}
                  disabled={!newComponentName.trim() || loadingAction === "system"}
                >
                  Add
                </button>
              </div>
            </div>

            <div className="control-field">
              <label className="field-label">
                Components
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={collapseAllComponents}
                >
                  Collapse all
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={expandAllComponents}
                >
                  Expand all
                </button>
              </div>
            </div>
          </div>

          <div className="dialog-actions" aria-label="Worksheet row actions">
            <button className="btn btn-secondary btn-sm" type="button" onClick={addBlankFailureModeRow}>
              Add blank row
            </button>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={duplicateSelectedRows}
              disabled={selectedRowIds.size === 0}
            >
              Duplicate selected
            </button>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={deleteSelectedRows}
              disabled={selectedRowIds.size === 0}
            >
              Delete selected
            </button>
          </div>

          {/* Notice */}
          {notice && (
            <p className="notice" role="status" aria-live="polite">{notice}</p>
          )}
          {searchWasTruncated && (
            <p className="notice" role="status">
              More than 5,000 matching claims exist. Refine the component, failure mode, or domain before treating this worksheet as a complete search result.
            </p>
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
                <caption className="visually-hidden">
                  {analysisName || "Failure Mode and Effects Analysis worksheet"}. Rows are grouped
                  by component and include engineering values, scores, evidence, and review state.
                </caption>
                <colgroup>
                  {worksheetColumnSpecs.map((column) => (
                    <col
                      key={column.id}
                      className={`col-${column.id}`}
                      style={{ width: `${column.size}px` }}
                    />
                  ))}
                </colgroup>
                <thead>
                  <tr className="column-group-row">
                    <th colSpan={3}>Component details</th>
                    <th colSpan={7}>Failure analysis and scoring</th>
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
                {paginatedGroupedData.map(({ component, childRows }) => (
                  <tbody key={component}>
                      <tr className="component-section-row">
                        <th scope="rowgroup" colSpan={visibleColumnCount}>
                          <div className="component-row-content">
                            <button
                              type="button"
                              className="component-toggle"
                              onClick={() => toggleComponent(component)}
                              aria-label={`${expandedComponents.has(component) ? "Collapse" : "Expand"} ${component}`}
                              aria-expanded={expandedComponents.has(component)}
                            >
                              <span className="toggle-icon" aria-hidden="true">{expandedComponents.has(component) ? "▼" : "▶"}</span>
                              <span className="toggle-label">Component</span>
                            </button>
                            <span className="component-name" title={component}>{component}</span>
                          </div>
                        </th>
                      </tr>
                      {expandedComponents.has(component) && childRows.map((row) => (
                        <tr
                          key={row.id}
                          className={`fmea-data-row component-open-row ${selectedRowIds.has(row.id) ? "row-selected" : ""}`}
                          aria-selected={selectedRowIds.has(row.id)}
                          tabIndex={0}
                          onClick={(event) => {
                            toggleRowSelection(row.id, event);
                          }}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            toggleRowSelection(row.id, event);
                          }}
                        >
                          {tableRowsById.get(row.id)?.getVisibleCells()
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
                  </tbody>
                ))}
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
                {selectedRowIds.size} row{selectedRowIds.size === 1 ? "" : "s"} selected for batch actions
              </span>
            )}
            {totalPages > 1 && (
              <div className="pagination-controls">
                <button
                  type="button"
                  className="pagination-btn"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  aria-label="Previous page"
                >
                  ←
                </button>
                <span className="pagination-info">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  className="pagination-btn"
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  aria-label="Next page"
                >
                  →
                </button>
              </div>
            )}
          </div>
        </section>

        <ScoringReferenceGuides />
      </main>

      {showExitDialog && (
        <ModalDialog
          className="source-dialog-compact"
          ariaLabelledBy="fmea-exit-dialog-title"
          ariaDescribedBy="fmea-exit-dialog-description"
          closeLabel="Close unsaved changes dialog"
          onClose={() => setShowExitDialog(false)}
        >
            <span className="metric-label">Unsaved Failure Mode and Effects Analysis</span>
            <h2 id="fmea-exit-dialog-title">Save before returning to the dashboard?</h2>
            <p id="fmea-exit-dialog-description">
              This Failure Mode and Effects Analysis has unsaved edits. Save them now, or discard the changes and return to the dashboard.
            </p>
            <div className="dialog-actions">
              <button className="btn btn-secondary btn-sm" type="button" onClick={discardAndExit}>
                Discard
              </button>
              <button className="btn btn-primary btn-sm" type="button" onClick={saveAndExit} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save and exit"}
              </button>
            </div>
        </ModalDialog>
      )}

      {selectedSourceRow && (
        <EvidenceDrawer
          row={selectedSourceRow}
          onClose={() => setSelectedSourceRow(null)}
          onReviewClaim={reviewEvidenceClaim}
        />
      )}

      {showHelpModal && <WorksheetHelpDialog onClose={() => setShowHelpModal(false)} />}

      {cellViewer && (
        <ModalDialog
          ariaLabelledBy="fmea-cell-dialog-title"
          closeLabel={`Close ${cellViewer.field} editor`}
          onClose={() => setCellViewer(null)}
        >
            <span className="metric-label">Edit</span>
            <h2 id="fmea-cell-dialog-title">{cellViewer.field}</h2>
            <label className="field-label" htmlFor="fmea-cell-editor">
              Engineering value
            </label>
            <textarea
              id="fmea-cell-editor"
              value={cellViewer.value}
              onChange={(e) => setCellViewer({ ...cellViewer, value: e.target.value })}
              className="cell-viewer-textarea"
              rows={6}
              data-dialog-autofocus
            />
            <div className="dialog-actions">
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => setCellViewer(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={() => saveCellViewer(cellViewer.value)}
              >
                Save
              </button>
            </div>
        </ModalDialog>
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
