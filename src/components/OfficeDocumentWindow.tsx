import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronLeft, ChevronRight, Clipboard, FileText, Loader2, Move, Save, Table2 } from 'lucide-react';
import type { FloatingImage, OfficeDocumentEdits } from '../lib/store';
import { Button } from './ui/button';

const ROWS_PER_PAGE = 30;
const COLUMNS_PER_PAGE = 12;
const MAX_COPY_ROWS = 2000;
const MAX_COPY_COLUMNS = 100;

type OfficeDocumentWindowProps = {
  media: FloatingImage;
  theme: 'light' | 'dark';
  onUpdate: (id: string, patch: Partial<FloatingImage>) => void;
  onMoveMouseDown: (event: React.MouseEvent, id: string) => void;
};

const getNodeRequire = () => typeof window !== 'undefined' && typeof (window as any).require === 'function'
  ? (window as any).require as (moduleName: string) => any
  : null;

const sourceToArrayBuffer = async (source: string): Promise<ArrayBuffer> => {
  if (source.startsWith('data:')) {
    const comma = source.indexOf(',');
    if (comma < 0) throw new Error('The document data is malformed.');
    const metadata = source.slice(0, comma);
    const payload = source.slice(comma + 1);
    if (/;base64/i.test(metadata)) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      return bytes.buffer;
    }
    return new TextEncoder().encode(decodeURIComponent(payload)).buffer;
  }

  const nodeRequire = getNodeRequire();
  if (nodeRequire) {
    const fs = nodeRequire('fs');
    const { fileURLToPath } = nodeRequire('url');
    const filePath = source.startsWith('file://') ? fileURLToPath(source) : source;
    if (fs.existsSync(filePath)) {
      const fileBuffer = fs.readFileSync(filePath);
      return fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
    }
  }

  const response = await fetch(source);
  if (!response.ok) throw new Error(`The document could not be read (HTTP ${response.status}).`);
  return await response.arrayBuffer();
};

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('The edited document could not be prepared.'));
  reader.readAsDataURL(blob);
});

const copyText = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
};

const stripExtension = (fileName: string, extension: string) => {
  return (fileName || `document.${extension}`).replace(new RegExp(`\\.${extension}$`, 'i'), '') || 'document';
};

const saveBlob = async (blob: Blob, suggestedFileName: string, extension: 'docx' | 'xlsx') => {
  const nodeRequire = getNodeRequire();
  if (nodeRequire) {
    const electron = nodeRequire('electron');
    const result = await electron.ipcRenderer.invoke('show-save-dialog', {
      title: extension === 'docx' ? 'Save edited Word document' : 'Save edited Excel workbook',
      defaultPath: suggestedFileName,
      filters: [{
        name: extension === 'docx' ? 'Word Document' : 'Excel Workbook',
        extensions: [extension]
      }]
    });
    if (result?.canceled || !result?.filePath) return false;
    const fs = nodeRequire('fs');
    const Buffer = nodeRequire('buffer').Buffer;
    fs.writeFileSync(result.filePath, Buffer.from(await blob.arrayBuffer()));
    return true;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedFileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
};

const getCellDisplayValue = (cell: any) => {
  const value = cell?.value;
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (typeof value.formula === 'string') return `=${value.formula}`;
    if (Array.isArray(value.richText)) return value.richText.map((part: any) => part.text || '').join('');
    if (typeof value.text === 'string') return value.text;
    if (value.result != null) return String(value.result);
  }
  return String(value);
};

const parseCellValue = (value: string) => {
  if (value.startsWith('=') && value.length > 1) return { formula: value.slice(1) };
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return Number(value);
  if (value.trim().toLowerCase() === 'true') return true;
  if (value.trim().toLowerCase() === 'false') return false;
  return value;
};

const columnLabel = (columnNumber: number) => {
  let value = columnNumber;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
};

function OfficeDocumentWindowComponent({ media, theme, onUpdate, onMoveMouseDown }: OfficeDocumentWindowProps) {
  const isDocx = media.type === 'docx';
  const extension = isDocx ? 'docx' : 'xlsx';
  const mimeType = isDocx
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const workbookRef = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [docxText, setDocxText] = useState(media.officeEdits?.docxText || '');
  const [xlsxEdits, setXlsxEdits] = useState<Record<string, Record<string, string>>>(media.officeEdits?.xlsxCells || {});
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState(media.officeEdits?.xlsxActiveSheet || '');
  const [rowOffset, setRowOffset] = useState(0);
  const [columnOffset, setColumnOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setMessage('');

    void (async () => {
      try {
        const arrayBuffer = await sourceToArrayBuffer(media.url);
        if (isDocx) {
          const mammothModule = await import('mammoth');
          const mammoth = (mammothModule as any).default || mammothModule;
          const result = await mammoth.extractRawText({ arrayBuffer });
          if (cancelled) return;
          const savedText = media.officeEdits?.docxText;
          setDocxText(savedText !== undefined ? savedText : result.value || '');
          if (result.messages?.length) setMessage('Some complex Word formatting is shown as editable text.');
        } else {
          const ExcelJS = await import('exceljs');
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(arrayBuffer);
          if (cancelled) return;
          workbookRef.current = workbook;
          const names = workbook.worksheets.map((worksheet: any) => worksheet.name);
          setSheetNames(names);
          setActiveSheet(current => names.includes(current) ? current : names[0] || 'Sheet1');
        }
        if (!cancelled) setStatus('ready');
      } catch (error: any) {
        if (cancelled) return;
        console.error('Office document failed to load:', error);
        setMessage(error?.message || 'This document could not be opened.');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      workbookRef.current = null;
    };
  }, [media.url, isDocx]);

  useEffect(() => {
    if (!isDocx || status === 'loading') return;
    const timer = window.setTimeout(() => {
      const edits: OfficeDocumentEdits = { ...(media.officeEdits || {}), docxText };
      onUpdate(media.id, { officeEdits: edits });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [docxText, isDocx, media.id, onUpdate, status]);

  useEffect(() => {
    if (isDocx || status === 'loading') return;
    const timer = window.setTimeout(() => {
      onUpdate(media.id, {
        officeEdits: {
          ...(media.officeEdits || {}),
          xlsxActiveSheet: activeSheet,
          xlsxCells: xlsxEdits
        }
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [activeSheet, isDocx, media.id, onUpdate, status, xlsxEdits]);

  useEffect(() => {
    setRowOffset(0);
    setColumnOffset(0);
  }, [activeSheet]);

  const worksheet = useMemo(() => workbookRef.current?.getWorksheet(activeSheet), [activeSheet, status]);
  const usedRows = Math.max(worksheet?.rowCount || 0, ROWS_PER_PAGE);
  const usedColumns = Math.max(worksheet?.columnCount || 0, COLUMNS_PER_PAGE);
  const visibleRows = Array.from({ length: ROWS_PER_PAGE }, (_, index) => rowOffset + index + 1);
  const visibleColumns = Array.from({ length: COLUMNS_PER_PAGE }, (_, index) => columnOffset + index + 1);

  const setCellEdit = (sheetName: string, address: string, value: string) => {
    setXlsxEdits(current => ({
      ...current,
      [sheetName]: {
        ...(current[sheetName] || {}),
        [address]: value
      }
    }));
  };

  const readEditedCell = (sheetName: string, address: string) => {
    if (Object.prototype.hasOwnProperty.call(xlsxEdits[sheetName] || {}, address)) {
      return xlsxEdits[sheetName][address];
    }
    return getCellDisplayValue(workbookRef.current?.getWorksheet(sheetName)?.getCell(address));
  };

  const handleCopy = async () => {
    try {
      if (isDocx) {
        await copyText(docxText);
        setMessage('Document text copied.');
      } else {
        const currentWorksheet = workbookRef.current?.getWorksheet(activeSheet);
        if (!currentWorksheet) return;
        const rowCount = Math.min(Math.max(currentWorksheet.rowCount, 1), MAX_COPY_ROWS);
        const columnCount = Math.min(Math.max(currentWorksheet.columnCount, 1), MAX_COPY_COLUMNS);
        const lines: string[] = [];
        for (let row = 1; row <= rowCount; row++) {
          const values: string[] = [];
          for (let column = 1; column <= columnCount; column++) {
            const address = `${columnLabel(column)}${row}`;
            values.push(readEditedCell(activeSheet, address).replace(/[\t\r\n]+/g, ' '));
          }
          lines.push(values.join('\t'));
        }
        await copyText(lines.join('\n'));
        setMessage(rowCount < currentWorksheet.rowCount || columnCount < currentWorksheet.columnCount
          ? `Copied the first ${rowCount} rows and ${columnCount} columns.`
          : `Copied ${activeSheet} as spreadsheet-ready text.`);
      }
      window.setTimeout(() => setMessage(''), 2500);
    } catch (error: any) {
      setMessage(error?.message || 'Copy failed.');
    }
  };

  const handleSave = async () => {
    setStatus('saving');
    setMessage('');
    try {
      let blob: Blob;
      let nextEdits: OfficeDocumentEdits;
      if (isDocx) {
        const { Document: DocxDocument, Packer, Paragraph, TextRun } = await import('docx');
        const paragraphs = docxText.replace(/\r\n/g, '\n').split('\n').map(line => new Paragraph({
          children: [new TextRun(line || '')]
        }));
        const documentFile = new DocxDocument({ sections: [{ children: paragraphs.length ? paragraphs : [new Paragraph('')] }] });
        blob = await Packer.toBlob(documentFile);
        nextEdits = { ...(media.officeEdits || {}), docxText };
      } else {
        const workbook = workbookRef.current;
        if (!workbook) throw new Error('The workbook is still loading.');
        for (const [sheetName, cells] of Object.entries(xlsxEdits)) {
          const targetSheet = workbook.getWorksheet(sheetName);
          if (!targetSheet) continue;
          for (const [address, value] of Object.entries(cells)) {
            targetSheet.getCell(address).value = parseCellValue(value);
          }
        }
        const buffer = await workbook.xlsx.writeBuffer();
        const byteView = new Uint8Array(buffer as ArrayBuffer);
        blob = new Blob([byteView.slice().buffer], { type: mimeType });
        nextEdits = { xlsxActiveSheet: activeSheet, xlsxCells: {} };
      }

      const baseName = stripExtension(media.fileName || `document.${extension}`, extension);
      const saved = await saveBlob(blob, `${baseName}.${extension}`, extension);
      if (!saved) {
        setStatus('ready');
        return;
      }
      const editedSource = await blobToDataUrl(blob);
      onUpdate(media.id, { url: editedSource, officeEdits: nextEdits, fileName: `${baseName}.${extension}` });
      if (!isDocx) setXlsxEdits({});
      setStatus('saved');
      setMessage('Saved. The board now keeps the edited version too.');
      window.setTimeout(() => {
        setStatus('ready');
        setMessage('');
      }, 2600);
    } catch (error: any) {
      console.error('Office document save failed:', error);
      setStatus('error');
      setMessage(error?.message || 'The edited file could not be saved.');
    }
  };

  const panelClass = 'bg-background text-foreground';
  const controlClass = 'border-border bg-card text-foreground hover:border-border-strong hover:bg-surface-elevated';

  return (
    <div className={`relative flex h-full min-h-0 w-full flex-col overflow-hidden ${panelClass} no-window-drag`}>
      <div
        className="floating-office-drag-handle flex shrink-0 cursor-move items-center justify-between gap-2 border-b border-border bg-surface-elevated px-2.5 py-2"
        onMouseDown={(event) => onMoveMouseDown(event, media.id)}
        data-office-drag-handle
        data-native-interactive="true"
        title="Drag this header to move the document window"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Move className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          {isDocx ? <FileText className="h-4 w-4 shrink-0 text-blue-500" /> : <Table2 className="h-4 w-4 shrink-0 text-emerald-500" />}
          <span className="truncate text-[11px] font-semibold">{media.fileName || (isDocx ? 'Word document' : 'Excel workbook')}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => void handleCopy()} className="h-7 px-2 text-[10px]" title={isDocx ? 'Copy all document text' : 'Copy the current sheet as tab-separated text'}>
            <Clipboard className="mr-1 inline h-3 w-3" /> Copy
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={() => void handleSave()} disabled={status === 'loading' || status === 'saving'} className="h-7 px-2 text-[10px]" title={`Save edited .${extension} file`}>
            {status === 'saving' ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : status === 'saved' ? <Check className="mr-1 inline h-3 w-3" /> : <Save className="mr-1 inline h-3 w-3" />} Save
          </Button>
        </div>
      </div>

      {status === 'loading' ? (
        <div className="flex min-h-64 flex-1 items-center justify-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Opening {isDocx ? 'document' : 'workbook'}…
        </div>
      ) : status === 'error' && !workbookRef.current && !isDocx ? (
        <div className="flex min-h-64 flex-1 items-center justify-center gap-2 p-6 text-center text-xs text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0" /> {message}
        </div>
      ) : isDocx ? (
        <textarea
          value={docxText}
          onChange={event => setDocxText(event.target.value)}
          spellCheck
          className="min-h-0 flex-1 resize-none overflow-auto bg-background p-5 font-sans text-sm leading-6 text-foreground outline-none"
          aria-label="Editable Word document text"
          title="Select, copy, and edit the document text here"
        />
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-elevated/60 px-2 py-1.5">
            <select value={activeSheet} onChange={event => setActiveSheet(event.target.value)} className={`min-w-0 flex-1 rounded-lg border px-2 py-1 text-[10px] outline-none ${controlClass}`} aria-label="Worksheet">
              {sheetNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <button type="button" onClick={() => setRowOffset(value => Math.max(0, value - ROWS_PER_PAGE))} disabled={rowOffset === 0} className={`rounded border p-1 disabled:opacity-30 ${controlClass}`} title="Previous rows"><ChevronLeft className="h-3 w-3" /></button>
            <span className="whitespace-nowrap text-[9px] text-muted-foreground">Rows {rowOffset + 1}–{rowOffset + ROWS_PER_PAGE}</span>
            <button type="button" onClick={() => setRowOffset(value => value + ROWS_PER_PAGE)} disabled={rowOffset + ROWS_PER_PAGE >= usedRows} className={`rounded border p-1 disabled:opacity-30 ${controlClass}`} title="Next rows"><ChevronRight className="h-3 w-3" /></button>
            <button type="button" onClick={() => setColumnOffset(value => Math.max(0, value - COLUMNS_PER_PAGE))} disabled={columnOffset === 0} className={`rounded border p-1 disabled:opacity-30 ${controlClass}`} title="Previous columns"><ChevronLeft className="h-3 w-3" /></button>
            <span className="whitespace-nowrap text-[9px] text-muted-foreground">{columnLabel(columnOffset + 1)}–{columnLabel(columnOffset + COLUMNS_PER_PAGE)}</span>
            <button type="button" onClick={() => setColumnOffset(value => value + COLUMNS_PER_PAGE)} disabled={columnOffset + COLUMNS_PER_PAGE >= usedColumns} className={`rounded border p-1 disabled:opacity-30 ${controlClass}`} title="Next columns"><ChevronRight className="h-3 w-3" /></button>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="border-separate border-spacing-0 text-[10px]">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className={`sticky left-0 z-30 h-7 min-w-10 border-b border-r ${theme === 'light' ? 'border-slate-300 bg-slate-100' : 'border-white/10 bg-slate-900'}`} />
                  {visibleColumns.map(column => (
                    <th key={column} className={`h-7 min-w-24 border-b border-r px-2 font-mono font-medium ${theme === 'light' ? 'border-slate-300 bg-slate-100' : 'border-white/10 bg-slate-900'}`}>{columnLabel(column)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(row => (
                  <tr key={row}>
                    <th className={`sticky left-0 z-10 h-7 border-b border-r px-2 text-right font-mono font-medium ${theme === 'light' ? 'border-slate-300 bg-slate-100' : 'border-white/10 bg-slate-900'}`}>{row}</th>
                    {visibleColumns.map(column => {
                      const address = `${columnLabel(column)}${row}`;
                      return (
                        <td key={address} className={`h-7 border-b border-r p-0 ${theme === 'light' ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-950'}`}>
                          <input
                            value={readEditedCell(activeSheet, address)}
                            onChange={event => setCellEdit(activeSheet, address, event.target.value)}
                            className="h-7 w-24 bg-transparent px-1.5 font-mono outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
                            aria-label={`${activeSheet} cell ${address}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="min-h-6 shrink-0 border-t border-border bg-surface-elevated px-2.5 py-1 text-[9px] text-muted-foreground">
        {message || (isDocx
          ? 'Text-focused editor: complex Word layout may be simplified when saved.'
          : 'Cells, formulas, sheets, and untouched workbook formatting are preserved; edited cells take the value shown.')}
      </div>
    </div>
  );
}

export const OfficeDocumentWindow = React.memo(OfficeDocumentWindowComponent);
