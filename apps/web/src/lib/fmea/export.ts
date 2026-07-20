import type { EvidenceReference, FmeaRow } from "@/lib/fmea/types";
import { rowRpn, selectRowsForExport } from "@/lib/fmea/worksheet";

export type FmeaExportMode = "final" | "draft";

const headers = [
  "Artifact type",
  "Review status",
  "Provenance",
  "Reviewed at",
  "Engineer-edited fields",
  "Evidence domains",
  "Operating contexts",
  "Component",
  "Function",
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
  "Evidence count",
  "Sources",
  "Evidence claim IDs",
  "Exact evidence spans",
  "Claim confidence",
  "Claim review states",
  "Evidence support types",
  "Classifier lineage",
];

function displaySafeEvidence(evidence: EvidenceReference[]) {
  return evidence.map((reference) => ({
    ...reference,
    spans: reference.spans.filter((span) => span.licenseSafe === true),
  }));
}

function evidenceClaimIds(evidence: EvidenceReference[]) {
  return [...new Set(evidence.map((reference) => reference.claimId))].join("; ");
}

function evidenceSpanSummary(evidence: EvidenceReference[]) {
  return displaySafeEvidence(evidence)
    .flatMap((reference) =>
      reference.spans.map(
        (span) =>
          `${reference.field}: ${span.text} [${span.sourceField} ${span.charStart ?? "?"}-${span.charEnd ?? "?"}]`,
      ),
    )
    .join(" | ");
}

function evidenceConfidenceSummary(evidence: EvidenceReference[]) {
  return evidence
    .filter((reference) => reference.confidence != null)
    .map((reference) => `${reference.field}:${Math.round(Number(reference.confidence) * 100)}%`)
    .join("; ");
}

function evidenceReviewSummary(evidence: EvidenceReference[]) {
  return [...new Set(evidence.map((reference) => `${reference.field}:${reference.reviewStatus}`))].join("; ");
}

function evidenceSupportSummary(evidence: EvidenceReference[]) {
  return [...new Set(evidence.map((reference) => `${reference.field}:${reference.supportType}`))].join("; ");
}

function classifierLineageSummary(evidence: EvidenceReference[]) {
  return [
    ...new Set(
      evidence
        .map((reference) => {
          const model = [reference.llmProvider, reference.llmModel].filter(Boolean).join(":");
          return [reference.classifierVersion, model].filter(Boolean).join(" · ");
        })
        .filter(Boolean),
    ),
  ].join("; ");
}

function exportRows(rows: FmeaRow[], mode: FmeaExportMode) {
  return rows.map((row) => [
    mode === "final" ? "FINAL — accepted evidence-backed row" : "DRAFT — engineering review required",
    row.status,
    row.provenance,
    row.reviewedAt,
    row.engineerEditedFields.join("; "),
    (row.domains ?? []).join("; "),
    (row.operatingContexts ?? []).join("; "),
    row.component,
    row.function,
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
    row.evidenceCount,
    row.sources.map((source) => source.doi || source.title).join("; "),
    evidenceClaimIds(row.evidence),
    evidenceSpanSummary(row.evidence),
    evidenceConfidenceSummary(row.evidence),
    evidenceReviewSummary(row.evidence),
    evidenceSupportSummary(row.evidence),
    classifierLineageSummary(row.evidence),
  ]);
}

export function neutralizeSpreadsheetFormula(value: string | number | undefined) {
  const stringValue = String(value ?? "");
  return /^[\t\r\n ]*[=+\-@]/.test(stringValue) ? `'${stringValue}` : stringValue;
}

function csvEscape(value: string | number | undefined) {
  const stringValue = neutralizeSpreadsheetFormula(value);
  if (!/[",\r\n]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function xmlEscape(value: string | number | undefined) {
  return neutralizeSpreadsheetFormula(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function downloadFile(filename: string, mimeType: string, content: BlobPart | BlobPart[]) {
  const blob = new Blob(Array.isArray(content) ? content : [content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function buildCsv(rows: FmeaRow[], mode: FmeaExportMode = "final") {
  return [headers, ...exportRows(selectRowsForExport(rows, mode), mode)]
    .map((line) => line.map((cell) => csvEscape(cell)).join(","))
    .join("\n");
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(buffer: number[], value: number) {
  buffer.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(buffer: number[], value: number) {
  buffer.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function zipStore(files: { name: string; content: string }[]) {
  const encoder = new TextEncoder();
  const output: number[] = [];
  const centralDirectory: number[] = [];

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const contentBytes = encoder.encode(file.content);
    const checksum = crc32(contentBytes);
    const localOffset = output.length;

    writeUint32(output, 0x04034b50);
    writeUint16(output, 20);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint32(output, checksum);
    writeUint32(output, contentBytes.length);
    writeUint32(output, contentBytes.length);
    writeUint16(output, nameBytes.length);
    writeUint16(output, 0);
    output.push(...nameBytes, ...contentBytes);

    writeUint32(centralDirectory, 0x02014b50);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, checksum);
    writeUint32(centralDirectory, contentBytes.length);
    writeUint32(centralDirectory, contentBytes.length);
    writeUint16(centralDirectory, nameBytes.length);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, 0);
    writeUint32(centralDirectory, localOffset);
    centralDirectory.push(...nameBytes);
  }

  const centralOffset = output.length;
  output.push(...centralDirectory);
  writeUint32(output, 0x06054b50);
  writeUint16(output, 0);
  writeUint16(output, 0);
  writeUint16(output, files.length);
  writeUint16(output, files.length);
  writeUint32(output, centralDirectory.length);
  writeUint32(output, centralOffset);
  writeUint16(output, 0);
  return new Uint8Array(output);
}

function buildXlsxWorkbook(rows: (string | number | undefined)[][]) {
  const columnWidths = [34, 16, 14, 22, 30, 28, 34, 24, 30, 30, 38, 10, 34, 12, 34, 12, 10, 34, 18, 14, 55, 42, 70, 30, 28, 30, 48];
  const columnName = (index: number) => {
    let name = "";
    let value = index + 1;
    while (value > 0) {
      const remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }
    return name;
  };
  const columns = columnWidths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          const style = rowIndex === 0 ? ' s="1"' : "";
          return `<c r="${ref}"${style} t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return zipStore([
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Analysis Export" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>",
    },
    {
      name: "xl/styles.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF064E55"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
        "</styleSheet>",
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
        `<cols>${columns}</cols><sheetData>${sheetRows}</sheetData></worksheet>`,
    },
  ]);
}

export function buildExcelWorkbook(rows: FmeaRow[], mode: FmeaExportMode = "final") {
  return buildXlsxWorkbook([headers, ...exportRows(selectRowsForExport(rows, mode), mode)]);
}
