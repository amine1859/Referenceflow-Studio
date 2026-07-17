import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Settings, Plus, X, Trash2, Maximize2, Minimize2, Move, Lock, Unlock, SlidersHorizontal, ChevronLeft, ChevronRight, RotateCw, Palette, FileText, Monitor, Check, Edit2, Download,
  Pin, PinOff, Eye, EyeOff, Edit3, ChevronDown, ChevronUp, PenTool, Eraser, ZoomIn, ZoomOut, Maximize, Bold, Italic, List, Search, Loader2, Heart, Link as LinkIcon, Table2, Copy, Sparkles, FolderOpen, LayoutGrid, PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FloatingImage, FloatingMediaType, FloatingNote, FloatingSketch, FloatingSketchLine, ImageAnnotationPoint, Project, getProjects, createProject, updateProject, deleteProject, getActiveProjectId, setActiveProjectId, fileToBase64 } from './lib/store';
import { createLocalBoardManifest, createProjectMediaSnapshot, getBackgroundMediaFileName, getFloatingMediaFileName, getSavedMediaExtension, projectMediaSnapshotsEqual, sanitizeExportStem } from './lib/projectMedia';
import type { ProjectMediaSnapshot } from './lib/projectMedia';
import { resizeWindowFromEdge, resizeWindowWithAspectRatio, snapWindowRect } from './lib/windowGeometry';
import type { EdgeResizeStart, WindowRect, WindowResizeEdge } from './lib/windowGeometry';
import { getAnnotationPageKey, getSmoothStrokePath, getVisibleAnnotations, replaceVisibleAnnotations } from './lib/annotations';

import { FloatingSketchWindow } from './components/FloatingSketchWindow';
import { OfficeDocumentWindow } from './components/OfficeDocumentWindow';
import { getWindowResizeCursorClass, InvisibleResizeFrame } from './components/InvisibleResizeFrame';
import { Button } from './components/ui/button';
import { Skeleton } from './components/ui/skeleton';
import { Switch } from './components/ui/switch';
import { ToolbarButton } from './components/ui/toolbar-button';
import { TooltipProvider } from './components/ui/tooltip';
import { pdfjs } from 'react-pdf';

// PDF.js requires an explicit worker URL in packaged Electron builds. Keeping
// this beside the pdfjs import ensures Vite emits the worker into dist/assets.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const PATREON_URL = 'https://www.patreon.com/RefFlowStudio';
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SUPPORTED_MEDIA_ACCEPT = `image/*,application/pdf,${DOCX_MIME_TYPE},${XLSX_MIME_TYPE},.docx,.xlsx`;

const getImportedMediaType = (file: Pick<File, 'name' | 'type'>): FloatingMediaType | null => {
  const lowerName = String(file.name || '').toLowerCase();
  const mimeType = String(file.type || '').toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (mimeType === DOCX_MIME_TYPE || lowerName.endsWith('.docx')) return 'docx';
  if (mimeType === XLSX_MIME_TYPE || lowerName.endsWith('.xlsx')) return 'xlsx';
  return null;
};

const isOfficeDocument = (type?: FloatingMediaType) => type === 'docx' || type === 'xlsx';

const getSourceFileName = (source: string) => {
  if (!source || source.startsWith('data:')) return '';
  try {
    const parsed = new URL(source, window.location.href);
    const candidate = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    return candidate && candidate.includes('.') ? candidate : '';
  } catch {
    const candidate = source.split(/[\\/]/).pop()?.split(/[?#]/)[0] || '';
    return candidate && candidate.includes('.') ? candidate : '';
  }
};

const getMediaDisplayName = (media: FloatingImage, index = 0) => {
  const savedName = String(media.fileName || '').trim();
  if (savedName) return savedName;
  const sourceName = getSourceFileName(media.url);
  if (sourceName) return sourceName;
  const type = media.type || 'image';
  return `${type === 'image' ? 'Image' : type.toUpperCase()} ${index + 1}`;
};

const getNoteDisplayName = (note: FloatingNote, index = 0) => String(note.name || '').trim() || `Note ${index + 1}`;

const getSketchDisplayName = (sketch: FloatingSketch, index = 0) => String(sketch.name || '').trim() || `Sketch ${index + 1}`;

type AppUpdatePhase = 'idle' | 'development' | 'checking' | 'available' | 'downloading' | 'up-to-date' | 'ready' | 'installing' | 'error';

type AppUpdateStatus = {
  phase: AppUpdatePhase;
  currentVersion: string;
  availableVersion?: string | null;
  percent?: number | null;
  bytesPerSecond?: number | null;
  transferred?: number | null;
  total?: number | null;
  checkedAt?: string | null;
  message?: string;
};

type SettingsToggleProps = {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  compatibilityAriaLabel?: string;
};

function SettingsToggle({
  label,
  description,
  checked,
  disabled = false,
  onCheckedChange,
  compatibilityAriaLabel,
}: SettingsToggleProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground">{label}</div>
        {description && <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{description}</div>}
      </div>
      <div className="relative shrink-0">
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          aria-label={`Toggle ${label}`}
          className={compatibilityAriaLabel ? 'pointer-events-none' : undefined}
        />
        {compatibilityAriaLabel && (
          <input
            type="checkbox"
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
            aria-hidden="true"
            aria-label={compatibilityAriaLabel}
            tabIndex={-1}
            checked={checked}
            disabled={disabled}
            onChange={(event) => onCheckedChange(event.target.checked)}
          />
        )}
      </div>
    </div>
  );
}

const getNodeRequire = () => {
  if (typeof window === 'undefined') return null;
  return typeof (window as any).require === 'function' ? (window as any).require : null;
};

const normalizeHexColor = (value: string): string | null => {
  const trimmed = String(value || '').trim();
  const hexMatch = trimmed.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const raw = hexMatch[1].length === 3
      ? hexMatch[1].split('').map(character => character + character).join('')
      : hexMatch[1];
    return `#${raw.toUpperCase()}`;
  }

  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (!rgbMatch) return null;
  const toHex = (channel: string) => Math.min(255, Number(channel)).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`;
};

const dataUrlToUint8Array = (dataUrl: string): Uint8Array => {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const getPdfFileSource = (url: string) => {
  if (url.startsWith('data:application/pdf')) {
    return { data: dataUrlToUint8Array(url) };
  }
  return { url };
};

const mediaSourceToArrayBuffer = async (source: string): Promise<ArrayBuffer> => {
  if (source.startsWith('data:')) {
    const comma = source.indexOf(',');
    if (comma < 0) throw new Error('The file data is malformed.');
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
  if (!response.ok) throw new Error(`The file could not be read (HTTP ${response.status}).`);
  return await response.arrayBuffer();
};

const openInWindowsDefaultBrowser = async (targetUrl: string) => {
  try {
    const parsedUrl = new URL(targetUrl);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') return false;
    const nodeRequire = getNodeRequire();
    const electron = nodeRequire ? nodeRequire('electron') : null;
    if (electron?.ipcRenderer) {
      const opened = await electron.ipcRenderer.invoke('open-external-url', parsedUrl.toString());
      if (opened) return true;
    }
    window.open(parsedUrl.toString(), '_blank', 'noopener,noreferrer');
    return true;
  } catch (error) {
    console.warn('Could not open the link in the default browser:', error);
    return false;
  }
};

const writeTextToSystemClipboard = async (text: string) => {
  const nodeRequire = getNodeRequire();
  const electron = nodeRequire ? nodeRequire('electron') : null;
  if (electron?.clipboard) {
    electron.clipboard.writeText(text);
    return;
  }
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

const getSelectedDocumentText = (target: EventTarget | null) => {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? start;
    return target.value.slice(Math.min(start, end), Math.max(start, end));
  }
  return window.getSelection()?.toString() || '';
};

const MAX_REFERENCE_PREVIEW_DIMENSION = 2048;
const MAX_CONCURRENT_REFERENCE_PREVIEWS = 2;
const MIN_BOUNDED_PREVIEW_SOURCE_LENGTH = 1_500_000;
const FLOATING_IMAGE_TOOLBAR_HEIGHT = 34;
const FLOATING_NOTE_TOOLBAR_HEIGHT = 32;
const FLOATING_SKETCH_TOOLBAR_HEIGHT = 32;
const FLOATING_WINDOW_SNAP_THRESHOLD = 12;
const FLOATING_WINDOW_SNAP_GAP = 8;
const FLOATING_NOTE_MIN_WIDTH = 220;
const FLOATING_NOTE_MIN_HEIGHT = 100;
const FLOATING_MEDIA_MIN_WIDTH = 120;
const FLOATING_MEDIA_MIN_HEIGHT = 80;
const FLOATING_MEDIA_FALLBACK_HEIGHT = 240;
const OFFICE_DOCUMENT_DEFAULT_HEIGHT = 520;
const OFFICE_DOCUMENT_MIN_WIDTH = 360;
const OFFICE_DOCUMENT_MIN_HEIGHT = 280;

type FloatingWindowKind = 'image' | 'note' | 'sketch';

const getFloatingWindowToolbarHeight = (kind: FloatingWindowKind) => {
  if (kind === 'image') return FLOATING_IMAGE_TOOLBAR_HEIGHT;
  if (kind === 'note') return FLOATING_NOTE_TOOLBAR_HEIGHT;
  return FLOATING_SKETCH_TOOLBAR_HEIGHT;
};

let activeReferencePreviewJobs = 0;
const pendingReferencePreviewJobs: Array<() => void> = [];

const drainReferencePreviewJobs = () => {
  while (activeReferencePreviewJobs < MAX_CONCURRENT_REFERENCE_PREVIEWS && pendingReferencePreviewJobs.length > 0) {
    pendingReferencePreviewJobs.shift()?.();
  }
};

const withReferencePreviewSlot = <T,>(task: () => Promise<T>) => new Promise<T>((resolve, reject) => {
  pendingReferencePreviewJobs.push(() => {
    activeReferencePreviewJobs++;
    void task().then(resolve, reject).finally(() => {
      activeReferencePreviewJobs--;
      drainReferencePreviewJobs();
    });
  });
  drainReferencePreviewJobs();
});

const getReferencePreviewWidth = (displayWidth: number, zoom: number) => {
  const requiredWidth = displayWidth * Math.max(1, zoom) * (window.devicePixelRatio || 1);
  if (requiredWidth <= 512) return 512;
  if (requiredWidth <= 1024) return 1024;
  return MAX_REFERENCE_PREVIEW_DIMENSION;
};

const shouldKeepNativeImageRendering = (source: string) =>
  !/^data:image\//i.test(source)
  || source.length < MIN_BOUNDED_PREVIEW_SOURCE_LENGTH
  || /^data:image\/(?:gif|webp)/i.test(source)
  || /\.(?:gif|webp)(?:$|[?#])/i.test(source);

// Render static references through a bounded canvas so a 10k source image does
// not keep a 10k decoded GPU surface alive. The original source remains intact
// for exporting, native drag-and-drop, palette extraction, and board storage.
function ReferenceImagePreview({
  src,
  targetWidth,
  className,
  style,
  draggable,
  title,
  onMouseDown,
  onMouseEnter,
  onDragStart
}: {
  src: string;
  targetWidth: number;
  className?: string;
  style?: React.CSSProperties;
  draggable: boolean;
  title: string;
  onMouseDown?: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseEnter?: () => void;
  onDragStart?: (event: React.DragEvent<HTMLElement>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const failedSourceRef = useRef('');
  const nativeRendering = shouldKeepNativeImageRendering(src);
  const [fallbackToImage, setFallbackToImage] = useState(nativeRendering);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (nativeRendering || typeof createImageBitmap !== 'function') {
      setFallbackToImage(true);
      return;
    }
    if (failedSourceRef.current === src) {
      setFallbackToImage(true);
      return;
    }
    if (!canvas) {
      setFallbackToImage(false);
      return;
    }

    let disposed = false;
    let bitmap: ImageBitmap | null = null;
    const controller = new AbortController();
    setFallbackToImage(false);

    const renderPreview = async () => {
      const response = await fetch(src, { signal: controller.signal });
      if (!response.ok) throw new Error(`Image preview fetch failed with HTTP ${response.status}.`);
      const blob = await response.blob();
      bitmap = await createImageBitmap(blob);
      if (disposed || !bitmap) return;
      if (!bitmap.width || !bitmap.height) throw new Error('Image preview dimensions are invalid.');

      const scale = Math.min(
        1,
        targetWidth / bitmap.width,
        MAX_REFERENCE_PREVIEW_DIMENSION / bitmap.height
      );
      const previewWidth = Math.max(1, Math.round(bitmap.width * scale));
      const previewHeight = Math.max(1, Math.round(bitmap.height * scale));
      canvas.width = previewWidth;
      canvas.height = previewHeight;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) throw new Error('Image preview canvas is unavailable.');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.clearRect(0, 0, previewWidth, previewHeight);
      context.drawImage(bitmap, 0, 0, previewWidth, previewHeight);
      bitmap.close();
      bitmap = null;
    };

    void withReferencePreviewSlot(renderPreview).catch(error => {
      if (disposed || controller.signal.aborted) return;
      console.warn('Falling back to native image rendering:', error);
      failedSourceRef.current = src;
      setFallbackToImage(true);
    });

    return () => {
      disposed = true;
      controller.abort();
      bitmap?.close();
      bitmap = null;
    };
  }, [src, targetWidth, nativeRendering, fallbackToImage]);

  useEffect(() => () => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }, []);

  if (fallbackToImage) {
    return (
      <img
        src={src}
        alt="Floating Reference"
        loading="lazy"
        decoding="async"
        className={className}
        style={style}
        draggable={draggable}
        title={title}
        onMouseDown={event => onMouseDown?.(event)}
        onMouseEnter={() => onMouseEnter?.()}
        onDragStart={event => onDragStart?.(event)}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Floating Reference"
      className={className}
      style={{ ...style, width: '100%', height: style?.height ?? 'auto' }}
      draggable={draggable}
      title={title}
      onMouseDown={event => onMouseDown?.(event)}
      onMouseEnter={() => onMouseEnter?.()}
      onDragStart={event => onDragStart?.(event)}
    />
  );
}

function PdfCanvas({
  url,
  pageNumber,
  width,
  scale,
  onLoadSuccess,
  onLoadError,
  onRenderSuccess,
  children
}: {
  url: string;
  pageNumber: number;
  width: number;
  scale: number;
  onLoadSuccess: (numPages: number) => void;
  onLoadError: (error: Error) => void;
  onRenderSuccess?: () => void;
  children?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [isLoadingPdf, setIsLoadingPdf] = useState(true);
  const [pdfDocument, setPdfDocument] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: any = null;
    setIsLoadingPdf(true);
    setPdfDocument(null);

    try {
      loadingTask = pdfjs.getDocument(getPdfFileSource(url) as any);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      console.error('PDF worker failed to initialize:', normalizedError);
      setIsLoadingPdf(false);
      onLoadError(normalizedError);
      return;
    }

    loadingTask.promise
      .then((pdf: any) => {
        if (cancelled) return;
        onLoadSuccess(pdf.numPages);
        setPdfDocument(pdf);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        console.error('PDF failed to load:', error);
        setIsLoadingPdf(false);
        onLoadError(error);
      });

    return () => {
      cancelled = true;
      loadingTask?.destroy();
    };
  }, [url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pdfDocument) return;

    let cancelled = false;
    let renderTask: any = null;
    let textLayerTask: any = null;
    setIsLoadingPdf(true);

    pdfDocument.getPage(pageNumber)
      .then(async (page: any) => {
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale = width / baseViewport.width;
        const viewport = page.getViewport({ scale: fitScale * scale });
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas context is unavailable.');

        const deviceScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * deviceScale);
        canvas.height = Math.floor(viewport.height * deviceScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const textLayerElement = textLayerRef.current;
        if (textLayerElement) {
          textLayerElement.replaceChildren();
          textLayerElement.style.setProperty('--total-scale-factor', String(fitScale * scale));
          const TextLayer = (pdfjs as any).TextLayer;
          if (TextLayer) {
            textLayerTask = new TextLayer({
              textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
              container: textLayerElement,
              viewport
            });
          }
        }

        context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);
        renderTask = page.render({ canvas, canvasContext: context, viewport });
        await Promise.all([renderTask.promise, textLayerTask?.render?.()]);
        if (!cancelled) {
          setIsLoadingPdf(false);
          onRenderSuccess?.();
        }
      })
      .catch((error: Error) => {
        if (cancelled) return;
        console.error('PDF canvas render failed:', error);
        setIsLoadingPdf(false);
        onLoadError(error);
      });

    return () => {
      cancelled = true;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {
          // Ignore render cancellation during fast page/zoom changes.
        }
      }
      try {
        textLayerTask?.cancel?.();
      } catch {
        // Ignore text-layer cancellation during fast page/zoom changes.
      }
    };
  }, [pdfDocument, pageNumber, width, scale]);

  return (
    <div className="relative inline-block shrink-0 align-top">
      {isLoadingPdf && (
        <div className="absolute inset-0 z-20 min-h-32 flex items-center justify-center bg-slate-900/50 text-slate-200 text-sm pointer-events-none">
          Loading PDF...
        </div>
      )}
      <canvas ref={canvasRef} className="block max-w-none" />
      <div ref={textLayerRef} className="pdf-text-layer textLayer no-window-drag" aria-label="Selectable PDF text" />
      {children}
    </div>
  );
}

type OfficePillPreviewData = {
  source: string;
  type: 'docx' | 'xlsx';
  lines?: string[];
  cells?: string[][];
};

const officePillPreviewCache = new Map<string, OfficePillPreviewData>();
const MAX_OFFICE_PILL_PREVIEWS = 64;

const rememberOfficePillPreview = (id: string, preview: OfficePillPreviewData) => {
  officePillPreviewCache.delete(id);
  officePillPreviewCache.set(id, preview);
  while (officePillPreviewCache.size > MAX_OFFICE_PILL_PREVIEWS) {
    const oldestKey = officePillPreviewCache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    officePillPreviewCache.delete(oldestKey);
  }
};

const getCompactCellText = (cell: any) => {
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

const getEditedOfficePillPreview = (media: FloatingImage): OfficePillPreviewData | null => {
  if (media.type === 'docx' && media.officeEdits?.docxText !== undefined) {
    return {
      source: media.url,
      type: 'docx',
      lines: media.officeEdits.docxText.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 5)
    };
  }

  if (media.type === 'xlsx' && media.officeEdits?.xlsxCells) {
    const sheetEdits = Object.values(media.officeEdits.xlsxCells).find(cells => Object.keys(cells).length > 0);
    if (sheetEdits) {
      return {
        source: media.url,
        type: 'xlsx',
        cells: [Object.values(sheetEdits).slice(0, 9)].map(row => row.map(value => String(value)))
      };
    }
  }
  return null;
};

function PillPdfPreview({ media }: { media: FloatingImage }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    let loadingTask: any = null;
    let renderTask: any = null;
    setStatus('loading');

    void withReferencePreviewSlot(async () => {
      if (cancelled) return;
      loadingTask = pdfjs.getDocument(getPdfFileSource(media.url) as any);
      const document = await loadingTask.promise;
      if (cancelled) return;
      const page = await document.getPage(1);
      if (cancelled) return;
      const baseViewport = page.getViewport({ scale: 1 });
      // Render enough pixels to cover a square tile. CSS crops the page at the
      // edges instead of shrinking it into an unreadable stamp surrounded by
      // empty gray space.
      const previewSize = 220;
      const scale = Math.max(previewSize / baseViewport.width, previewSize / baseViewport.height);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) throw new Error('The PDF preview canvas is unavailable.');
      const deviceScale = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(viewport.width * deviceScale));
      canvas.height = Math.max(1, Math.floor(viewport.height * deviceScale));
      context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
      renderTask = page.render({ canvas, canvasContext: context, viewport });
      await renderTask.promise;
      if (!cancelled) setStatus('ready');
    }).catch(error => {
      if (cancelled || error?.name === 'RenderingCancelledException') return;
      console.warn('Could not create the compact PDF preview:', error);
      setStatus('error');
    });

    return () => {
      cancelled = true;
      try { renderTask?.cancel?.(); } catch { /* Ignore preview cancellation. */ }
      void loadingTask?.destroy?.();
    };
  }, [media.url]);

  return (
    <div
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[linear-gradient(145deg,#eef1f6,#d8dde7)]"
      data-preview-status={status}
      data-pdf-preview-surface
    >
      {status !== 'ready' && <FileText className="absolute z-10 h-5 w-5 text-primary/65" />}
      <canvas
        ref={canvasRef}
        className={`h-full w-full object-cover object-top transition-opacity duration-200 ${status === 'ready' ? 'opacity-100' : 'opacity-0'}`}
      />
      <div className="pointer-events-none absolute inset-0 border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]" />
    </div>
  );
}

function PillOfficePreview({ media }: { media: FloatingImage }) {
  const editedPreview = getEditedOfficePillPreview(media);
  const cachedPreview = officePillPreviewCache.get(media.id);
  const [preview, setPreview] = useState<OfficePillPreviewData | null>(() => (
    editedPreview || (cachedPreview?.source === media.url && cachedPreview.type === media.type ? cachedPreview : null)
  ));
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(preview ? 'ready' : 'loading');

  useEffect(() => {
    const immediatePreview = getEditedOfficePillPreview(media);
    if (immediatePreview) {
      rememberOfficePillPreview(media.id, immediatePreview);
      setPreview(immediatePreview);
      setStatus('ready');
      return;
    }

    const cached = officePillPreviewCache.get(media.id);
    if (cached?.source === media.url && cached.type === media.type) {
      setPreview(cached);
      setStatus('ready');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    void withReferencePreviewSlot(async () => {
      const arrayBuffer = await mediaSourceToArrayBuffer(media.url);
      if (media.type === 'docx') {
        const mammothModule = await import('mammoth');
        const mammoth = (mammothModule as any).default || mammothModule;
        const result = await mammoth.extractRawText({ arrayBuffer });
        return {
          source: media.url,
          type: 'docx' as const,
          lines: String(result.value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 5)
        };
      }

      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(arrayBuffer);
      const worksheet = workbook.worksheets[0];
      const cells = Array.from({ length: 3 }, (_, rowIndex) => (
        Array.from({ length: 3 }, (_, columnIndex) => getCompactCellText(worksheet?.getCell(rowIndex + 1, columnIndex + 1)))
      ));
      return { source: media.url, type: 'xlsx' as const, cells };
    }).then(nextPreview => {
      if (cancelled) return;
      rememberOfficePillPreview(media.id, nextPreview);
      setPreview(nextPreview);
      setStatus('ready');
    }).catch(error => {
      if (cancelled) return;
      console.warn('Could not create the compact Office preview:', error);
      setStatus('error');
    });

    return () => { cancelled = true; };
  }, [media.id, media.officeEdits, media.type, media.url]);

  if (media.type === 'docx') {
    return (
      <div className="relative h-full w-full overflow-hidden bg-white px-1.5 pb-5 pt-1.5 text-left text-[6px] leading-[8px] text-slate-700" data-preview-status={status}>
        <div className="mb-1 h-px w-8 bg-blue-300" />
        {preview?.lines?.length ? preview.lines.map((line, index) => (
          <div key={`${line}-${index}`} className="max-h-4 overflow-hidden border-b border-slate-100 py-px">{line}</div>
        )) : (
          <div className="flex h-full items-center justify-center"><FileText className="h-5 w-5 text-blue-500" /></div>
        )}
      </div>
    );
  }

  const cells = preview?.cells?.length ? preview.cells : Array.from({ length: 3 }, () => ['', '', '']);
  return (
    <div className="relative grid h-full w-full grid-cols-3 content-start overflow-hidden bg-emerald-50 pb-5 text-[5px] leading-3 text-emerald-950" data-preview-status={status}>
      {cells.flatMap((row, rowIndex) => Array.from({ length: 3 }, (_, columnIndex) => (
        <div key={`${rowIndex}-${columnIndex}`} className="h-4 overflow-hidden border-b border-r border-emerald-200 px-0.5">
          {row[columnIndex] || ''}
        </div>
      )))}
      {status !== 'ready' && <Table2 className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-emerald-500" />}
    </div>
  );
}

const extractPalette = (imgUrl: string): Promise<string[]> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve([]);
      
      // Scale image down to 100x100 to obtain rich, high-density sample pixels while maintaining super fast performance
      const width = 100;
      const height = 100;
      canvas.width = width;
      canvas.height = height;
      
      try {
        ctx.drawImage(img, 0, 0, width, height);
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;
        
        // Implement K-Means clustering for more accurate dominant color extraction
        const pixels: {r: number, g: number, b: number}[] = [];
        
        for (let i = 0; i < data.length; i += 4) {
          // Skip highly transparent background pixels
          if (data[i + 3] >= 150) {
            pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
          }
        }

        if (pixels.length === 0) {
          resolve([]);
          return;
        }

        const K = Math.min(6, pixels.length);
        
        // Initialize centroids using K-Means++ style initialization
        const centroids: {r: number, g: number, b: number}[] = [];
        centroids.push(pixels[Math.floor(Math.random() * pixels.length)]);
        
        for (let i = 1; i < K; i++) {
          let maxDist = -1;
          let nextCentroid = pixels[0];
          
          for (const p of pixels) {
            let minDist = Infinity;
            for (const c of centroids) {
              const d = Math.pow(p.r - c.r, 2) + Math.pow(p.g - c.g, 2) + Math.pow(p.b - c.b, 2);
              if (d < minDist) minDist = d;
            }
            if (minDist > maxDist) {
              maxDist = minDist;
              nextCentroid = p;
            }
          }
          centroids.push(nextCentroid);
        }

        // Run K-Means iterations
        const maxIterations = 10;
        const assignments = new Array(pixels.length).fill(0);
        
        for (let iter = 0; iter < maxIterations; iter++) {
          let changed = false;
          const sums = Array.from({ length: K }, () => ({ r: 0, g: 0, b: 0, count: 0 }));
          
          for (let pIdx = 0; pIdx < pixels.length; pIdx++) {
            const p = pixels[pIdx];
            let minDist = Infinity;
            let bestCluster = 0;
            
            for (let cIdx = 0; cIdx < K; cIdx++) {
              const c = centroids[cIdx];
              const d = Math.pow(p.r - c.r, 2) + Math.pow(p.g - c.g, 2) + Math.pow(p.b - c.b, 2);
              if (d < minDist) {
                minDist = d;
                bestCluster = cIdx;
              }
            }
            
            if (assignments[pIdx] !== bestCluster) {
              changed = true;
              assignments[pIdx] = bestCluster;
            }
            
            sums[bestCluster].r += p.r;
            sums[bestCluster].g += p.g;
            sums[bestCluster].b += p.b;
            sums[bestCluster].count++;
          }
          
          if (!changed && iter > 0) break;
          
          for (let cIdx = 0; cIdx < K; cIdx++) {
            if (sums[cIdx].count > 0) {
              centroids[cIdx] = {
                r: Math.round(sums[cIdx].r / sums[cIdx].count),
                g: Math.round(sums[cIdx].g / sums[cIdx].count),
                b: Math.round(sums[cIdx].b / sums[cIdx].count)
              };
            }
          }
        }

        // Count assignments
        const clusterCounts = new Array(K).fill(0);
        for (const a of assignments) {
          clusterCounts[a]++;
        }

        // Organize and sort by cluster popularity
        const paletteObjects = centroids.map((c, i) => ({ ...c, count: clusterCounts[i] })).filter(c => c.count > 0);
        paletteObjects.sort((a, b) => b.count - a.count);

        // Filter for visually distinct colors and format to hex
        const toHex = (c: number) => c.toString(16).padStart(2, '0').toUpperCase();
        const hexPalette: string[] = [];
        const minDistance = 30; // Threshold to ensure colors are distinct
        
        for (const col of paletteObjects) {
          let isDistinct = true;
          for (const palHex of hexPalette) {
            const pr = parseInt(palHex.substring(1, 3), 16);
            const pg = parseInt(palHex.substring(3, 5), 16);
            const pb = parseInt(palHex.substring(5, 7), 16);
            
            const dist = Math.sqrt(Math.pow(col.r - pr, 2) + Math.pow(col.g - pg, 2) + Math.pow(col.b - pb, 2));
            if (dist < minDistance) {
              isDistinct = false;
              break;
            }
          }
          
          if (isDistinct) {
            hexPalette.push(`#${toHex(col.r)}${toHex(col.g)}${toHex(col.b)}`);
          }
        }
        
        // If filtering removed too many colors, fallback to returning all non-empty centroids
        if (hexPalette.length < 3) {
          resolve([...new Set(paletteObjects.map(c => `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`))]);
        } else {
          resolve(hexPalette);
        }
        
      } catch (e) {
        console.error("Advanced palette extraction failed due to security/CORS, falling back gracefully:", e);
        // Direct horizontal pixel sampling fallback
        canvas.width = 5;
        canvas.height = 1;
        try {
          ctx.drawImage(img, 0, 0, 5, 1);
          const toHex = (c: number) => c.toString(16).padStart(2, '0').toUpperCase();
          const colors: string[] = [];
          for (let i = 0; i < 5; i++) {
            const data = ctx.getImageData(i, 0, 1, 1).data;
            colors.push(`#${toHex(data[0])}${toHex(data[1])}${toHex(data[2])}`);
          }
          resolve([...new Set(colors)]);
        } catch (err) {
          resolve([]);
        }
      }
    };
    img.onerror = () => resolve([]);
    img.src = imgUrl;
  });
};

const getCorsProxyUrl = (url: string): string => {
  if (!url) return url;
  if (url.startsWith('data:') || url.startsWith('blob:') || url.includes('localhost') || url.includes('corsproxy.io')) {
    return url;
  }
  return `https://corsproxy.io/?${encodeURIComponent(url)}`;
};

const loadSafeImage = async (url: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => {
      const proxied = getCorsProxyUrl(url);
      if (proxied === url) {
        reject(new Error(`Failed to load image: ${url}`));
        return;
      }
      const img2 = new Image();
      img2.crossOrigin = "Anonymous";
      img2.onload = () => resolve(img2);
      img2.onerror = () => reject(new Error(`Failed to load image via proxy: ${proxied}`));
      img2.src = proxied;
    };
    img.src = url;
  });
};

const getImageResolution = async (url: string): Promise<{width: number, height: number}> => {
  try {
    const img = await loadSafeImage(url);
    return { width: img.width, height: img.height };
  } catch (e) {
    console.warn("[getImageResolution] failed, using fallback:", e);
    return { width: 0, height: 0 };
  }
};

const calculatePHash = async (imageUrl: string): Promise<string> => {
  try {
    const img = await loadSafeImage(imageUrl);
    const canvas = document.createElement("canvas");
    const size = 8;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    
    ctx.drawImage(img, 0, 0, size, size);
    const imgData = ctx.getImageData(0, 0, size, size);
    const data = imgData.data;
    
    let total = 0;
    const grays: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      grays.push(gray);
      total += gray;
    }
    const avg = total / grays.length;
    let hash = "";
    for (let i = 0; i < grays.length; i++) {
      hash += grays[i] >= avg ? "1" : "0";
    }
    return parseInt(hash, 2).toString(16).padStart(16, "0");
  } catch (e) {
    console.warn("[calculatePHash] failed:", e);
    return "unknown";
  }
};

const calculateHammingSimilarity = (hash1: string, hash2: string): number => {
  if (!hash1 || !hash2 || hash1 === "unknown" || hash2 === "unknown") return 0.5;
  if (hash1.length !== hash2.length) return 0;
  let matches = 0;
  for (let i = 0; i < hash1.length; i++) {
    const hex1 = parseInt(hash1[i], 16);
    const hex2 = parseInt(hash2[i], 16);
    const xor = hex1 ^ hex2;
    let bitMatches = 4;
    for (let bit = 0; bit < 4; bit++) {
      if ((xor & (1 << bit)) !== 0) {
        bitMatches--;
      }
    }
    matches += bitMatches;
  }
  return matches / (hash1.length * 4);
};

const getAverageColor = async (imgUrl: string): Promise<{r: number, g: number, b: number}> => {
  try {
    const img = await loadSafeImage(imgUrl);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      return { r: data[0], g: data[1], b: data[2] };
    }
    return { r: 127, g: 127, b: 127 };
  } catch (e) {
    return { r: 127, g: 127, b: 127 };
  }
};

const calculateColorSimilarity = (c1: {r: number, g: number, b: number}, c2: {r: number, g: number, b: number}): number => {
  const diffR = c1.r - c2.r;
  const diffG = c1.g - c2.g;
  const diffB = c1.b - c2.b;
  const maxDist = Math.sqrt(255*255 * 3);
  const dist = Math.sqrt(diffR*diffR + diffG*diffG + diffB*diffB);
  return 1 - (dist / maxDist);
};

const calculateAspectRatioSimilarity = (ar1: number, ar2: number): number => {
  if (!ar1 || !ar2) return 1.0;
  return Math.min(ar1, ar2) / Math.max(ar1, ar2);
};

const fetchImageAsBase64 = async (url: string): Promise<string> => {
  const tryFetch = async (targetUrl: string): Promise<string> => {
    const response = await fetch(targetUrl);
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error("Failed to read downloaded image as data URL"));
        }
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(blob);
    });
  };

  try {
    return await tryFetch(url);
  } catch (e: any) {
    try {
      console.warn(`[Auto High-Res] Direct fetch failed for base64 conversion (${e.message}). Retrying with CORS proxy...`);
      return await tryFetch(getCorsProxyUrl(url));
    } catch (proxyError: any) {
      console.warn("[Auto High-Res] CORS prevented converting image to base64 even with proxy. Using direct URL as fallback.");
      return url;
    }
  }
};



type ShortcutParts = { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string };

const parseShortcut = (combo: string): ShortcutParts => {
  const parts = String(combo || '').toLowerCase().split('+').map(part => part.trim()).filter(Boolean);
  const modifiers = new Set(['ctrl', 'alt', 'shift', 'meta']);
  return {
    ctrl: parts.includes('ctrl'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
    meta: parts.includes('meta'),
    key: [...parts].reverse().find(part => !modifiers.has(part)) || ''
  };
};

const buildShortcut = ({ ctrl, alt, shift, meta, key }: ShortcutParts) => {
  const normalizedKey = key.trim().toLowerCase();
  if (!normalizedKey) return '';
  return [ctrl && 'ctrl', alt && 'alt', shift && 'shift', meta && 'meta', normalizedKey].filter(Boolean).join('+');
};

const normalizeShortcutKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
  const rawKey = event.key.toLowerCase();
  if (['control', 'alt', 'shift', 'meta'].includes(rawKey)) return '';
  if (rawKey === ' ') return 'space';
  if (rawKey === ',') return 'comma';
  return rawKey;
};

const shortcutKeyLabel = (key: string) => {
  if (!key) return '';
  if (key === 'comma') return ',';
  if (key === 'space') return 'Space';
  return key.length === 1 ? key.toUpperCase() : key.replace(/^arrow/, '').replace(/^./, value => value.toUpperCase());
};

const matchShortcut = (combo: string, e: KeyboardEvent) => {
  const shortcut = parseShortcut(combo);
  if (!shortcut.key) return false;

  const isCtrlMatched = shortcut.ctrl === e.ctrlKey;
  const isShiftMatched = shortcut.shift === e.shiftKey;
  const isAltMatched = shortcut.alt === e.altKey;
  const isMetaMatched = shortcut.meta === e.metaKey;
  
  let isKeyMatched = false;
  if (shortcut.key === 'escape' || shortcut.key === 'esc') {
    isKeyMatched = e.key.toLowerCase() === 'escape';
  } else if (shortcut.key === 'comma') {
    isKeyMatched = e.key === ',';
  } else if (shortcut.key === 'space') {
    isKeyMatched = e.key === ' ';
  } else {
    isKeyMatched = e.key.toLowerCase() === shortcut.key || (e.code.toLowerCase().replace('key', '') === shortcut.key);
  }

  return isCtrlMatched && isShiftMatched && isAltMatched && isMetaMatched && isKeyMatched;
};

const ensureTempLocalFile = async (url: string, id: string): Promise<string> => {
  const nodeRequire = getNodeRequire();
  if (!nodeRequire) return "";
  const electron = nodeRequire('electron');
  const fs = nodeRequire('fs');
  const path = nodeRequire('path');
  const os = nodeRequire('os');
  
  try {
    let ext = '.jpg';
    if (url.toLowerCase().includes('.png') || url.startsWith('data:image/png')) ext = '.png';
    else if (url.toLowerCase().includes('.webp') || url.startsWith('data:image/webp')) ext = '.webp';
    else if (url.toLowerCase().includes('.gif') || url.startsWith('data:image/gif')) ext = '.gif';
    else if (url.toLowerCase().includes('.pdf') || url.startsWith('data:application/pdf')) ext = '.pdf';
    else if (url.toLowerCase().includes('.docx') || url.startsWith(`data:${DOCX_MIME_TYPE}`)) ext = '.docx';
    else if (url.toLowerCase().includes('.xlsx') || url.startsWith(`data:${XLSX_MIME_TYPE}`)) ext = '.xlsx';
    else if (url.startsWith('data:image/jpeg') || url.startsWith('data:image/jpg')) ext = '.jpg';
    
    let dataRoot = '';
    try {
      dataRoot = await electron.ipcRenderer.invoke('get-default-data-directory');
    } catch (e) {
      console.warn("Could not read ReferenceFlow data folder, using Documents fallback:", e);
    }
    const documentsDir = path.join(os.homedir(), 'Documents');
    const baseDir = dataRoot || (documentsDir ? path.join(documentsDir, 'ReferenceFlow') : '');
    if (!baseDir) return "";

    const exportDir = path.join(baseDir, 'Clipboard');
    fs.mkdirSync(exportDir, { recursive: true });

    const safeId = String(id || 'reference').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80) || 'reference';
    const tempPath = path.join(exportDir, `refflow_export_${safeId}${ext}`);
    
    if (fs.existsSync(tempPath)) return tempPath;

    if (url.startsWith('data:')) {
       const base64Data = url.split(',')[1] || '';
       fs.writeFileSync(tempPath, Buffer.from(base64Data, 'base64'));
       return tempPath;
    }

    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(tempPath, Buffer.from(arrayBuffer));
    return tempPath;
  } catch (e) {
    console.error("Failed to cache temp file:", e);
    return "";
  }
};

const copyImageToClipboard = async (url: string, id: string) => {
  const electron = (window as any).require ? (window as any).require('electron') : null;
  if (electron) {
    const tempPath = await ensureTempLocalFile(url, id);
    if (tempPath) {
      const copied = await electron.ipcRenderer.invoke('copy-image-to-clipboard', tempPath);
      if (copied) {
        console.log(`[Copy Image] Natively copied bitmap to clipboard via: ${tempPath}`);
      } else {
        await electron.ipcRenderer.invoke('copy-file-to-clipboard', tempPath);
        console.log(`[Copy Image] Copied file path because bitmap clipboard was unavailable: ${tempPath}`);
      }
    }
  } else {
    // Web fallback using ClipboardItem
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      if (blob.type === 'image/png' || blob.type === 'image/jpeg') {
         const item = new ClipboardItem({ [blob.type]: blob });
         await navigator.clipboard.write([item]);
         console.log("[ClipboardFallback] Copied image to browser clipboard successfully.");
      } else {
         // Fallback via Canvas drawing
         const canvas = document.createElement('canvas');
         const img = new Image();
         img.crossOrigin = 'anonymous';
         img.onload = async () => {
           canvas.width = img.width;
           canvas.height = img.height;
           const ctx = canvas.getContext('2d');
           if (ctx) {
             ctx.drawImage(img, 0, 0);
             canvas.toBlob(async (pngBlob) => {
               if (pngBlob) {
                 const item = new ClipboardItem({ 'image/png': pngBlob });
                 await navigator.clipboard.write([item]);
                 console.log("[ClipboardFallback] Copied non-standard image to browser clipboard as PNG.");
               }
             }, 'image/png');
           }
         };
         img.src = url;
      }
    } catch (e) {
      console.warn("[ClipboardFallback] Clipboard API block or fail in sandbox preview:", e);
    }
  }
};

const copyFileToClipboard = async (url: string, id: string) => {
  const electron = (window as any).require ? (window as any).require('electron') : null;
  if (!electron) {
    console.warn("[Copy File] Windows Explorer file copying is only supported in native Desktop App mode.");
    return;
  }
  const tempPath = await ensureTempLocalFile(url, id);
  if (tempPath) {
    await electron.ipcRenderer.invoke('copy-file-to-clipboard', tempPath);
    console.log(`[Copy File] Copied native Windows Explorer reference: ${tempPath}`);
  }
};

const copyReferenceForOtherApps = async (url: string, id: string) => {
  const electron = (window as any).require ? (window as any).require('electron') : null;
  if (electron) {
    const tempPath = await ensureTempLocalFile(url, id);
    if (tempPath) {
      await electron.ipcRenderer.invoke('copy-file-to-clipboard', tempPath);
      return tempPath;
    }
  }
  await copyImageToClipboard(url, id);
  return "";
};

const exportOriginalImage = async (url: string, id: string, formatType: 'png' | 'jpg' | 'webp') => {
  const canvas = document.createElement('canvas');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = async () => {
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    
    const mimeType = formatType === 'png' ? 'image/png' : formatType === 'jpg' ? 'image/jpeg' : 'image/webp';
    const dataUrl = canvas.toDataURL(mimeType, formatType === 'png' ? undefined : 0.95);
    const nodeRequire = getNodeRequire();
    const electron = nodeRequire ? nodeRequire('electron') : null;
    
    if (electron) {
      const result = await electron.ipcRenderer.invoke('show-save-dialog', {
        title: `Export Original as ${formatType.toUpperCase()}`,
        defaultPath: `export_${id}.${formatType}`,
        filters: [
          { name: `${formatType.toUpperCase()} Image`, extensions: [formatType] }
        ]
      });
      if (!result.canceled && result.filePath) {
        const fs = nodeRequire('fs');
        const base64Data = dataUrl.split(',')[1];
        fs.writeFileSync(result.filePath, Buffer.from(base64Data, 'base64'));
        console.log(`[Export ${formatType}] Saved original natively to: ${result.filePath}`);
      }
    } else {
      // Fallback: Web browser anchor download
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `export_${id}.${formatType}`;
      a.target = '_blank';
      a.click();
      console.log(`[Export ${formatType}] Web fallback download triggered.`);
    }
  };
  img.src = url;
};

if (typeof window !== 'undefined') {
  const electron = (window as any).require ? (window as any).require('electron') : null;
  const ipcRenderer = electron ? electron.ipcRenderer : null;
  if (!(window as any).electronAPI) {
    (window as any).electronAPI = {
      setIgnoreMouseEvents: (ignore: boolean, options?: any) => {
        console.log(`[preload.cjs] window.electronAPI.setIgnoreMouseEvents(${ignore}, ${options ? JSON.stringify(options) : 'undefined'}) called`);
        if (ipcRenderer) {
          try {
            ipcRenderer.send('set-ignore-mouse-events', ignore, options);
          } catch (err: any) {
            console.error(`[preload.cjs] IPC send error:`, err);
          }
        } else {
          console.warn("[preload.cjs] ipcRenderer not found. Running in browser?");
        }
      }
    };
  }
}

export default function App() {
  type DisplayLayout = {
    virtual: { x: number; y: number; width: number; height: number };
    primary: { x: number; y: number; width: number; height: number };
    displays: Array<{
      id: string;
      label: string;
      bounds: { x: number; y: number; width: number; height: number };
      workArea: { x: number; y: number; width: number; height: number };
      scaleFactor: number;
      isPrimary: boolean;
    }>;
  };

  const [images, setImages] = useState<string[]>([]);
  const [floatingImages, setFloatingImages] = useState<FloatingImage[]>([]);
  const [floatingNotes, setFloatingNotes] = useState<FloatingNote[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [showSearchComponent, setShowSearchComponent] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchProvider, setSearchProvider] = useState("All Native");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchStatus, setSearchStatus] = useState("idle");
  const [searchFilters, setSearchFilters] = useState<string[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('ref-flow-search-history');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [activeProviderSearching, setActiveProviderSearching] = useState<string>("None");
  const [lastResultsCount, setLastResultsCount] = useState<number>(0);
  const [searchLog, setSearchLog] = useState<string[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [searchContextMenu, setSearchContextMenu] = useState<{x: number, y: number, result: any} | null>(null);
  const [floatingContextMenu, setFloatingContextMenu] = useState<{x: number, y: number, id: string, url: string, type?: FloatingMediaType, fileName?: string, selectedText?: string} | null>(null);
  const [contextMenuTempPath, setContextMenuTempPath] = useState<string>('');
  const dragFilePathsRef = useRef<Map<string, string>>(new Map());
  const NATIVE_PROVIDERS = ['All Native', 'Wikimedia Commons', 'Openverse'];
  const BROWSER_PROVIDERS = ['Google Images', 'Pinterest', 'DuckDuckGo Images', 'Bing Images', 'ArtStation', 'Behance'];
  const FILTER_OPTIONS = ['Portrait', 'Landscape', 'Square', 'Black & White', 'Transparent', 'High Resolution'];
  const [isRetracted, setIsRetracted] = useState(false);
  const [showInTaskbar, setShowInTaskbar] = useState(() => {
    const saved = localStorage.getItem('ref-flow-show-in-taskbar');
    return saved ? saved === 'true' : false;
  });
  const [isPillVisible, setIsPillVisible] = useState(() => {
    const saved = localStorage.getItem('ref-flow-pill-visible');
    return saved ? saved === 'true' : true;
  });
  const [isPillContentReady, setIsPillContentReady] = useState(false);
  
  const [projects, setProjects] = useState<Project[]>([]);
  const projectsRef = useRef<Project[]>([]);
  const mirroredMediaSnapshotsRef = useRef<Map<string, ProjectMediaSnapshot>>(new Map());
  const autosaveQueueRef = useRef<{
    timer: number | null;
    inFlight: boolean;
    pending: (() => Promise<void>) | null;
  }>({ timer: null, inFlight: false, pending: null });
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null);
  const [showManager, setShowManager] = useState(false);
  const [isManagerSidebarCollapsed, setIsManagerSidebarCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isEmptyBoardPromptDismissed, setIsEmptyBoardPromptDismissed] = useState(false);
  const [managingProjectId, setManagingProjectId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectSurface, setEditingProjectSurface] = useState<'card' | 'sidebar' | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null);
  const [editingMediaProjectId, setEditingMediaProjectId] = useState<string | null>(null);
  const [editingMediaName, setEditingMediaName] = useState("");
  const [editingCanvasItem, setEditingCanvasItem] = useState<{
    kind: 'note' | 'sketch';
    id: string;
    projectId: string | null;
    name: string;
  } | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [dragError, setDragError] = useState<string>('');
  const [defaultAutosaveRoot, setDefaultAutosaveRoot] = useState<string>("");
  const [copiedColor, setCopiedColor] = useState<string | null>(null);
  const colorCopyTimerRef = useRef<number | null>(null);
  const [editingNotes, setEditingNotes] = useState<Record<string, boolean>>({});
  const [topWindowId, setTopWindowId] = useState<string | null>(null);
  const [displayLayout, setDisplayLayout] = useState<DisplayLayout | null>(null);
  const [annotationModes, setAnnotationModes] = useState<Record<string, boolean>>({});
  const [annotationColors, setAnnotationColors] = useState<Record<string, string>>({});
  const imagePanSessionRef = useRef<{ id: string; pointerId: number; x: number; y: number } | null>(null);
  const pdfViewportRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pdfPanSessionRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const annotationSessionRef = useRef<{ id: string; pointerId: number; pageKey?: string } | null>(null);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>({
    phase: 'idle',
    currentVersion: '',
    message: 'Updates are checked automatically.'
  });
  const [updateActionPending, setUpdateActionPending] = useState(false);

  const [floatingSketches, setFloatingSketches] = useState<FloatingSketch[]>([]);
  const hasAnyWorkspaceContent = floatingImages.length > 0 || floatingNotes.length > 0 || floatingSketches.length > 0;

  useEffect(() => {
    if (hasAnyWorkspaceContent) setIsEmptyBoardPromptDismissed(false);
  }, [hasAnyWorkspaceContent]);

  useEffect(() => {
    setIsEmptyBoardPromptDismissed(false);
  }, [activeProjectId]);

  useEffect(() => {
    if (!isPillVisible || isRetracted) {
      setIsPillContentReady(false);
      return;
    }

    let timer: number | null = null;
    const animationFrame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => setIsPillContentReady(true), 190);
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [isPillVisible, isRetracted]);

  useEffect(() => {
    projectsRef.current = projects;
    const activeIds = new Set(projects.map(project => project.id));
    for (const projectId of mirroredMediaSnapshotsRef.current.keys()) {
      if (!activeIds.has(projectId)) mirroredMediaSnapshotsRef.current.delete(projectId);
    }
  }, [projects]);

  const fetchAndAddImage = async (url: string, suggestedName?: string) => {
    const displayName = String(suggestedName || '').trim() || getSourceFileName(url);
    try {
      // Attempt to cache as base64 to prevent hotlinking and improve offline support
      const response = await fetch(url);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Url = reader.result as string;
        addSearchResultToWorkspace(base64Url, displayName);
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      console.warn("[Search] CORS prevented downloading image as blob. Using direct URL as fallback.");
      addSearchResultToWorkspace(url, displayName);
    }
  };

  const addSearchResultToWorkspace = (url: string, fileName = '') => {
    setIsRetracted(false);
    setFloatingImages(prev => [
      ...prev,
      {
        id: Math.random().toString(36).substr(2, 9),
        url,
        fileName: fileName || undefined,
        x: position.x + pillDimensions.width + 100 + (Math.random() * 50),
        y: position.y + (Math.random() * 50),
        width: 400,
        opacity: 1,
        isLocked: false,
        rotation: 0,
        isCollapsed: false,
        zoom: 1,
      }
    ]);
  };

  const createFloatingMediaItems = (
    files: File[],
    urls: string[],
    origin: { x: number; y: number },
    collapsed = false
  ): FloatingImage[] => {
    return urls.map((url, i) => {
      const mediaType = getImportedMediaType(files[i]) || 'image';
      const isPdf = mediaType === 'pdf';
      const isOffice = isOfficeDocument(mediaType);
      return {
        id: Math.random().toString(36).substr(2, 9),
        url,
        x: origin.x + (i * 20),
        y: origin.y + (i * 20),
        width: isOffice ? 680 : isPdf ? 420 : 400,
        height: isOffice ? OFFICE_DOCUMENT_DEFAULT_HEIGHT : undefined,
        opacity: 1,
        isLocked: false,
        rotation: 0,
        palette: [],
        zoom: 1,
        type: mediaType,
        fileName: files[i]?.name,
        documentPage: isPdf ? 1 : undefined,
        isCollapsed: collapsed
      };
    });
  };

  const importMediaFiles = async (
    files: File[],
    origin: { x: number; y: number } = { x: position.x + pillDimensions.width + 20, y: position.y },
    collapsed = false
  ): Promise<FloatingImage[]> => {
    const mediaFiles = files.filter(file => getImportedMediaType(file) !== null);
    if (mediaFiles.length === 0) return [];

    const newMedia = await Promise.all(mediaFiles.map(fileToBase64));
    const newFloatingImages = createFloatingMediaItems(mediaFiles, newMedia, origin, collapsed);
    setIsRetracted(false);
    setFloatingImages(prev => [...prev, ...newFloatingImages]);
    return newFloatingImages;
  };

  const scoreResult = (resultTitle: string, queryStr: string): number => {
    if (!resultTitle) return 0;
    const title = resultTitle.toLowerCase().trim();
    const query = queryStr.toLowerCase().trim();

    // Stop words
    const stopWords = new Set(["the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "with", "of", "about", "is", "are", "was", "were", "by", "from", "as"]);

    // Stemming/normalization for simple plural/singular
    const normalizeWord = (w: string) => {
      let word = w.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
      if (word.endsWith("ies")) {
        return word.slice(0, -3) + "y";
      }
      if (word.endsWith("es") && !word.endsWith("ees") && !word.endsWith("o_es")) {
        return word.slice(0, -2);
      }
      if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("as") && !word.endsWith("is")) {
        return word.slice(0, -1);
      }
      return word;
    };

    let score = 0;

    // 1. Exact phrase match
    if (title.includes(query)) {
      score += 150;
    }

    // Quoted phrase checks
    const phraseRegex = /"([^"]+)"/g;
    let match;
    const phrases: string[] = [];
    while ((match = phraseRegex.exec(query)) !== null) {
      phrases.push(match[1]);
    }

    const queryCleaned = query.replace(/"([^"]+)"/g, " ");
    const queryWords = queryCleaned.split(/\s+/).filter(w => w && !stopWords.has(w));

    for (const phrase of phrases) {
      if (title.includes(phrase)) {
        score += 200;
      }
    }

    const originalCleanQuery = query.replace(/["]/g, "").trim();
    if (originalCleanQuery.split(/\s+/).length > 1 && title.includes(originalCleanQuery)) {
      score += 80;
    }

    // Token word matches
    const titleWords = title.split(/\s+/).map(normalizeWord);
    const normalizedQueryWords = queryWords.map(normalizeWord);

    let wordMatches = 0;
    for (const qw of normalizedQueryWords) {
      if (titleWords.includes(qw)) {
        wordMatches++;
        score += 30; // exact word match
      } else {
        const subMatch = titleWords.some(tw => tw.includes(qw) || qw.includes(tw));
        if (subMatch) {
          score += 10;
        }
      }
    }

    if (wordMatches === normalizedQueryWords.length && normalizedQueryWords.length > 0) {
      score += 50; // all words match
    }

    // Start matches bonus
    const firstWord = originalCleanQuery.split(/\s+/)[0];
    if (firstWord && title.startsWith(firstWord.toLowerCase())) {
      score += 20;
    }

    return score;
  };

  const rankSearchResults = (results: any[], query: string): any[] => {
    return results.map(res => {
      // Relevance
      const relevance = scoreResult(res.title || "", query);

      // Resolution area
      const area = (res.width || 800) * (res.height || 600);
      const resolutionScore = Math.min(area / 1000000, 10) * 15; // up to 150 pts

      // Aspect ratio: prefer 0.5 to 2.2
      const ar = res.width && res.height ? res.width / res.height : 1.0;
      const arScore = (ar >= 0.5 && ar <= 2.2) ? 20 : 0;

      // Sharpness approximation
      const urlLower = (res.url || "").toLowerCase();
      let sharpnessScore = 0;
      if (urlLower.includes("original") || urlLower.includes("full") || urlLower.includes("raw") || urlLower.includes("high")) {
        sharpnessScore += 30;
      }
      if (res.provider === 'Unsplash' || res.provider === 'Pexels') {
        sharpnessScore += 20;
      }

      const finalScore = relevance + resolutionScore + arScore + sharpnessScore;

      return {
        ...res,
        finalScore
      };
    }).sort((a, b) => b.finalScore - a.finalScore);
  };

  const filterDuplicates = (existing: any[], incoming: any[]): any[] => {
    const seenUrls = new Set(existing.map(item => item.url.toLowerCase()));
    const seenThumbnails = new Set(existing.map(item => (item.thumbnail || "").toLowerCase()));
    const seenDimensions = new Set(existing.map(item => `${item.width}x${item.height}`));

    const result: any[] = [...existing];

    for (const item of incoming) {
      const urlLower = item.url.toLowerCase();
      const thumbLower = (item.thumbnail || "").toLowerCase();
      const dimKey = `${item.width}x${item.height}`;

      const isUnverifiedDim = item.width === 0 || item.height === 0;

      if (seenUrls.has(urlLower)) {
        continue;
      }
      if (thumbLower && seenThumbnails.has(thumbLower)) {
        continue;
      }
      if (!isUnverifiedDim && seenDimensions.has(dimKey)) {
        const duplicateTitle = existing.some(ext => ext.title && item.title && ext.title.toLowerCase() === item.title.toLowerCase());
        if (duplicateTitle) {
          continue;
        }
      }
      seenUrls.add(urlLower);
      if (thumbLower) seenThumbnails.add(thumbLower);
      if (!isUnverifiedDim) seenDimensions.add(dimKey);

      result.push(item);
    }

    return result;
  };

  const applyLocalFilters = (results: any[], activeFilters: string[]): any[] => {
    if (activeFilters.length === 0) return results;

    return results.filter(item => {
      for (const f of activeFilters) {
        if (f === 'Portrait') {
          if (item.width && item.height && item.width >= item.height) return false;
        }
        if (f === 'Landscape') {
          if (item.width && item.height && item.height >= item.width) return false;
        }
        if (f === 'Square') {
          if (item.width && item.height) {
            const ratio = item.width / item.height;
            if (ratio < 0.95 || ratio > 1.05) return false;
          }
        }
        if (f === 'Transparent') {
          const isPng = item.url.toLowerCase().split('?')[0].endsWith('.png');
          const transparentMeta = (item.title || "").toLowerCase().includes("transparent") || (item.title || "").toLowerCase().includes("png") || (item.url || "").toLowerCase().includes("transparent");
          if (!isPng && !transparentMeta) return false;
        }
        if (f === 'High Resolution') {
          if (item.width && item.height) {
            if (item.width < 1600 && item.height < 1600) return false;
          }
        }
        if (f === 'Black & White') {
          const titleLower = (item.title || "").toLowerCase();
          const bwMeta = titleLower.includes("black and white") || titleLower.includes("grayscale") || titleLower.includes("monochrome") || titleLower.includes("b&w");
          if (!bwMeta) return false;
        }
      }
      return true;
    });
  };

  const performSearch = async (isLoadMore = false) => {
    if (!searchQuery.trim()) return;
    
    if (BROWSER_PROVIDERS.includes(searchProvider)) {
        const BrowserSearchURLs: Record<string, string> = {
            'Google Images': `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(searchQuery)}`,
            'Pinterest': `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(searchQuery)}`,
            'DuckDuckGo Images': `https://duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&iar=images&iax=images&ia=images`,
            'Bing Images': `https://www.bing.com/images/search?q=${encodeURIComponent(searchQuery)}`,
            'ArtStation': `https://www.artstation.com/search?sort_by=relevance&query=${encodeURIComponent(searchQuery)}`,
            'Behance': `https://www.behance.net/search/projects?search=${encodeURIComponent(searchQuery)}`
        };
        const url = BrowserSearchURLs[searchProvider];
        if (url) {
            void openInWindowsDefaultBrowser(url);
            setSearchLog(prev => [...prev, `[Search] Opened ${searchProvider} in the Windows default browser.`]);
        }
        return;
    }

    const nextPage = isLoadMore ? searchPage + 1 : 1;
    if (!isLoadMore) {
        setSearchPage(1);
        setSearchResults([]);
        setSearchHistory(prev => {
          const filtered = prev.filter(q => q.toLowerCase() !== searchQuery.trim().toLowerCase());
          const updated = [searchQuery.trim(), ...filtered].slice(0, 10);
          localStorage.setItem('ref-flow-search-history', JSON.stringify(updated));
          return updated;
        });
        setSearchLog(prev => [...prev, `[Search] Started search for "${searchQuery}" using provider: ${searchProvider}`]);
    } else {
        setSearchPage(nextPage);
        setSearchLog(prev => [...prev, `[Search] Loading page ${nextPage}...`]);
    }
    
    setSearchStatus(isLoadMore ? "loading-more" : "loading");

    let newResults: any[] = [];
    const providersToTry = searchProvider === "All Native" 
      ? providerOrder.filter(p => providerStatus[p]?.enabled ?? true)
      : [searchProvider];
    
    for (const p of providersToTry) {
        const pConfig = getProviderConfig(p);
        if (!pConfig.isEnabled) {
            if (!isLoadMore) setSearchLog(prev => [...prev, `[Search] Skipped ${p}: Disabled.`]);
            continue;
        }
        setActiveProviderSearching(p);
        setSearchLog(prev => [...prev, `[Search] Querying ${p}...`]);
        const startTime = Date.now();
        let errorStr = '';
        let reqUrl = '';
        let sortOrder = 'default';
        let providerQueryTerms = searchQuery;
        let pFiltersApplied: string[] = [];
        let fetchedHits = 0;
        let providerHits: any[] = [];

        try {
            if (p === 'Wikimedia Commons') {
                const sroffset = (nextPage - 1) * 20;
                reqUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(searchQuery)}&gsrnamespace=6&gsrlimit=20${isLoadMore ? `&gsroffset=${sroffset}` : ''}&prop=imageinfo&iiprop=url|size&origin=*&format=json`;
                
                const res = await fetch(reqUrl);
                if (!res.ok) throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
                const data = await res.json();
                if (data.query?.pages) {
                    const pages = Object.values(data.query.pages) as any[];
                    providerHits = pages.filter(page => page.imageinfo && page.imageinfo.length > 0).map(page => ({
                        url: page.imageinfo[0].url,
                        thumbnail: page.imageinfo[0].url,
                        provider: 'Wikimedia Commons',
                        title: page.title,
                        width: page.imageinfo[0].width || 0,
                        height: page.imageinfo[0].height || 0
                    }));
                }
            } else if (p === 'Openverse') {
                reqUrl = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(searchQuery)}&page=${nextPage}`;
                const res = await fetch(reqUrl);
                if (!res.ok) throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
                const data = await res.json();
                if (data.results && data.results.length > 0) {
                    providerHits = data.results.map((item: any) => ({
                        url: item.url,
                        thumbnail: item.thumbnail || item.url,
                        provider: 'Openverse',
                        title: item.title,
                        width: 0, 
                        height: 0
                    }));
                }
            }

            const locallyFiltered = applyLocalFilters(providerHits, searchFilters);
            fetchedHits = locallyFiltered.length;

            newResults = [...newResults, ...locallyFiltered];
            
            const timeTaken = Date.now() - startTime;
            setSearchLog(prev => [
              ...prev,
              `[Diagnostics - ${p}]`,
              `- Request URL: ${reqUrl || 'N/A'}`,
              `- Query: "${providerQueryTerms}"`,
              `- Filters: ${searchFilters.length > 0 ? searchFilters.join(', ') : 'None'} (source-mapped: ${pFiltersApplied.join(', ') || 'None'})`,
              `- Sort order: ${sortOrder}`,
              `- Response count: ${providerHits.length} (Locally filtered: ${locallyFiltered.length})`,
              `- Page number: ${nextPage}`,
              `- Time taken: ${timeTaken}ms`
            ]);

        } catch (err: any) {
            errorStr = err.message || 'Unknown error.';
            console.error(`[Search] Error with ${p}:`, err);
            setSearchLog(prev => [...prev, `[Search] Error querying ${p}: ${errorStr}`]);
        }

        setSearchDiagnostics(prev => ({
          lastSearch: new Date(),
          reqCount: prev.reqCount + 1,
          resCount: prev.resCount + fetchedHits,
          errors: errorStr ? [...prev.errors, `${p}: ${errorStr}`] : prev.errors
        }));
    }

    setActiveProviderSearching("None");
    setLastResultsCount(newResults.length);

    const rankedNewResults = rankSearchResults(newResults, searchQuery);

    if (rankedNewResults.length > 0) {
        setSearchResults(prev => {
          const combined = isLoadMore ? filterDuplicates(prev, rankedNewResults) : filterDuplicates([], rankedNewResults);
          return combined;
        });
        setSearchStatus("idle");
        setSearchLog(prev => [...prev, `[Search] Ready. Appended ${rankedNewResults.length} scored results.`]);
    } else {
        setSearchStatus(isLoadMore ? "idle" : "no-results");
        setSearchLog(prev => [...prev, `[Search] Complete. No ${isLoadMore ? 'more' : 'usable'} results match filters.`]);
    }
  };

  const handleSearchScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 50 && searchStatus === 'idle') {
      performSearch(true);
    }
  };

  const handleAutoHighRes = async (img: FloatingImage) => {
    console.log(`[Auto High-Res] Starting pipeline for image ID: ${img.id}`);
    
    // Add to searchLogs
    setSearchLog(prev => [...prev, `[Auto High-Res] Starting multi-stage pipeline for image ID ${img.id}`]);

    // Set initial status to stage 1: Generating image fingerprint
    setFloatingImages(prev => prev.map(f => f.id === img.id ? {
      ...f, 
      isSearchInProgress: true, 
      searchStatus: "Generating image fingerprint..."
    } : f));

    // STAGE 1: Image Fingerprinting
    let pHash = "";
    try {
      pHash = await calculatePHash(img.url);
      console.log(`[Auto High-Res Fingerprint] pHash: ${pHash}`);
    } catch (e) {
      console.error(`[Auto High-Res] Failed to calculate pHash`, e);
      pHash = "unknown";
    }

    let originalRes = { width: 0, height: 0 };
    try {
      originalRes = await getImageResolution(img.url);
      console.log(`[Auto High-Res Fingerprint] Dimensions: ${originalRes.width}x${originalRes.height}`);
    } catch (e) {
      console.warn(`[Auto High-Res] Could not determine original resolution.`);
    }

    const originalAspect = originalRes.width && originalRes.height ? originalRes.width / originalRes.height : 1.0;
    
    let dominantColors: string[] = [];
    try {
      dominantColors = await extractPalette(img.url);
      console.log(`[Auto High-Res Fingerprint] Dominant colors: ${dominantColors.join(', ')}`);
    } catch (e) {
      console.warn(`[Auto High-Res] Could not extract palette.`);
    }

    let originalAvgColor = { r: 127, g: 127, b: 127 };
    try {
      originalAvgColor = await getAverageColor(img.url);
      console.log(`[Auto High-Res Fingerprint] Average Color: r:${originalAvgColor.r} g:${originalAvgColor.g} b:${originalAvgColor.b}`);
    } catch (e) {
      console.warn(`[Auto High-Res] Could not extract average color.`);
    }

    const fingerprint = {
      pHash,
      width: originalRes.width,
      height: originalRes.height,
      aspectRatio: originalAspect,
      dominantColors,
      averageColor: originalAvgColor
    };

    console.log(`[Auto High-Res Fingerprint] Generated visual fingerprint:`, fingerprint);
    setSearchLog(prev => [...prev, `[Auto High-Res Fingerprint] pHash: ${pHash}, Size: ${originalRes.width}x${originalRes.height}, Aspect: ${originalAspect.toFixed(2)}`]);

    // STAGE 2: Reverse Image Search
    const candidates: Array<{ url: string; provider: string }> = [];

    // Direct URL patterns provide a no-key upgrade path for known image hosts.
    let hasMatchedDirectResolver = false;
    let directResolverName = "";
    let directResolvedUrl = "";

    if (img.url.includes("upload.wikimedia.org") && img.url.includes("/thumb/")) {
      const parts = img.url.split('/');
      const thumbIndex = parts.indexOf('thumb');
      if (thumbIndex !== -1) {
        hasMatchedDirectResolver = true;
        directResolverName = "Wikimedia Commons";
        directResolvedUrl = [...parts.slice(0, thumbIndex), ...parts.slice(thumbIndex + 1, parts.length - 1)].join('/');
      }
    } else if (img.url.includes('images.unsplash.com')) {
      hasMatchedDirectResolver = true;
      directResolverName = "Unsplash";
      let newUrl = img.url.replace(/&w=\d+/, '').replace(/\?w=\d+/, '');
      newUrl = newUrl.replace(/w=\d+&/, '');
      newUrl += newUrl.includes('?') ? '&w=4000' : '?w=4000';
      directResolvedUrl = newUrl;
    } else if (img.url.includes('images.pexels.com')) {
      hasMatchedDirectResolver = true;
      directResolverName = "Pexels";
      let newUrl = img.url.replace(/&w=\d+/, '').replace(/\?w=\d+/, '');
      newUrl = newUrl.replace(/w=\d+&/, '');
      directResolvedUrl = newUrl;
    }

    // Direct Pattern Resolvers
    if (hasMatchedDirectResolver && directResolvedUrl) {
      setFloatingImages(prev => prev.map(f => f.id === img.id ? { ...f, searchStatus: `Searching provider (${directResolverName})...` } : f));
      candidates.push({ url: directResolvedUrl, provider: `${directResolverName} Direct Resolver` });
      console.log(`[Auto High-Res Search] Direct resolver matched and candidate added: ${directResolvedUrl}`);
      setSearchLog(prev => [...prev, `[Direct Resolver] Added high-res direct pattern match from ${directResolverName}.`]);
    } else {
      console.log("[Auto High-Res Search] Direct pattern skipped. Base image URL does not match partner structures.");
    }

    if (!hasMatchedDirectResolver) {
      setSearchLog(prev => [...prev, `[Auto High-Res] No no-key direct upgrade was available for this image host.`]);
      setFloatingImages(prev => prev.map(f => f.id === img.id ? {
        ...f,
        isSearchInProgress: false,
        searchStatus: 'No direct higher-resolution source found'
      } : f));

      setTimeout(() => {
        setFloatingImages(prev => prev.map(f => f.id === img.id ? { ...f, searchStatus: undefined } : f));
      }, 3500);
      return;
    }

    // STAGE 3 & 4: Candidate Ranking & Validation
    setFloatingImages(prev => prev.map(f => f.id === img.id ? { ...f, searchStatus: "Comparing..." } : f));
    console.log(`[Auto High-Res Validation] Comparing and validating ${candidates.length} visual matches...`);

    interface RankedCandidate {
      url: string;
      provider: string;
      similarity: number;
      width: number;
      height: number;
      score: number;
    }

    const rankedCandidates: RankedCandidate[] = [];

    for (const cand of candidates) {
      const candUrl = cand.url;
      try {
        console.log(`[Auto High-Res Validation] Validating candidate: ${candUrl} from ${cand.provider}...`);
        
        // Load candidate and verify resolution
        const candRes = await getImageResolution(candUrl);
        if (candRes.width <= originalRes.width || candRes.height <= originalRes.height) {
          console.log(`[Candidate Rejected] ${cand.provider} - ${candUrl} has smaller/equal resolution (${candRes.width}x${candRes.height} vs original ${originalRes.width}x${originalRes.height}).`);
          setSearchLog(prev => [...prev, `[Validation Rejected] ${cand.provider} match resolution too low: ${candRes.width}x${candRes.height}`]);
          continue;
        }

        // Validate aspect ratio similarity
        const candAspect = candRes.width / candRes.height;
        const aspectSim = calculateAspectRatioSimilarity(originalAspect, candAspect);
        if (aspectSim < 0.82) { // Allow slight crop variations up to 18% difference in aspect ratio
          console.log(`[Candidate Rejected] ${cand.provider} - Aspect ratio mismatch (${candAspect.toFixed(2)} vs original ${originalAspect.toFixed(2)}, similarity: ${aspectSim.toFixed(2)}).`);
          setSearchLog(prev => [...prev, `[Validation Rejected] ${cand.provider} match aspect mismatch: sim: ${aspectSim.toFixed(2)}`]);
          continue;
        }

        // Validate Subject visual matching via pHash Hamming
        const candPHash = await calculatePHash(candUrl);
        const hamSim = calculateHammingSimilarity(pHash, candPHash);
        if (hamSim < 0.70) { // Reject mismatches (similarity must be at least 70%)
          console.log(`[Candidate Rejected] ${cand.provider} - Subject/composition visual mismatch (Hamming similarity: ${hamSim.toFixed(2)}).`);
          setSearchLog(prev => [...prev, `[Validation Rejected] ${cand.provider} visual mismatch: sim: ${hamSim.toFixed(2)}`]);
          continue;
        }

        // Validate Color matching similarity
        const candAvgColor = await getAverageColor(candUrl);
        const colorSim = calculateColorSimilarity(originalAvgColor, candAvgColor);
        if (colorSim < 0.70) {
          console.log(`[Candidate Rejected] ${cand.provider} - Color profiling mismatch (Color similarity: ${colorSim.toFixed(2)}).`);
          setSearchLog(prev => [...prev, `[Validation Rejected] ${cand.provider} color mismatch: sim: ${colorSim.toFixed(2)}`]);
          continue;
        }

        // Calculate score for Ranking: Visual similarity is highly critical (50%), area size increase (40%), color/aspect profiling (10%)
        const origArea = originalRes.width * originalRes.height || 1;
        const candArea = candRes.width * candRes.height;
        const sizeMultiplier = Math.min((candArea / origArea) / 20, 1.0); // cap size ratio boost at 20x to prevent overflows

        const finalScore = (hamSim * 0.5) + (sizeMultiplier * 0.4) + (colorSim * 0.05) + (aspectSim * 0.05);
        
        rankedCandidates.push({
          url: candUrl,
          provider: cand.provider,
          similarity: hamSim,
          width: candRes.width,
          height: candRes.height,
          score: finalScore
        });

        console.log(`[Candidate Accepted] ${candUrl} (Provider: ${cand.provider}, Similarity: ${hamSim.toFixed(2)}, Size: ${candRes.width}x${candRes.height}, Score: ${finalScore.toFixed(3)})`);
        setSearchLog(prev => [...prev, `[Validation Accepted] Match from ${cand.provider}: ${candRes.width}x${candRes.height} (score: ${finalScore.toFixed(2)})`]);
      } catch (err: any) {
        console.warn(`[Auto High-Res Validation] Skip candidate due to loading/CORS error: ${candUrl}`, err);
        setSearchLog(prev => [...prev, `[Validation Warning] Skipped matching candidate due to loading error.`]);
      }
    }

    // Sort candidates by ranking score
    rankedCandidates.sort((a, b) => b.score - a.score);

    if (rankedCandidates.length > 0) {
      const bestMatch = rankedCandidates[0];
      console.log(`[Auto High-Res Replacement] Selected best candidate with score ${bestMatch.score.toFixed(3)}: ${bestMatch.url} (${bestMatch.width}x${bestMatch.height})`);
      setSearchLog(prev => [...prev, `[Auto High-Res] Selection complete. Replacing with: ${bestMatch.width}x${bestMatch.height} via ${bestMatch.provider}.`]);

      // STAGE 5: Replacement & Downloading
      setFloatingImages(prev => prev.map(f => f.id === img.id ? { ...f, searchStatus: "Downloading..." } : f));
      
      try {
        const base64Url = await fetchImageAsBase64(bestMatch.url);
        
        setFloatingImages(prev => prev.map(f => f.id === img.id ? { ...f, searchStatus: "Replacing image..." } : f));
        await new Promise(r => setTimeout(r, 600));

        // State mutator: Keeps ALL positioning, rotation, scale, zoom, opacities, lock states intact while replacing the backing resource!
        setFloatingImages(prev => prev.map(f => f.id === img.id ? {
          ...f,
          url: base64Url,
          isHighRes: true,
          isSearchInProgress: false,
          searchStatus: undefined,
          pHash: bestMatch.similarity !== 0.5 ? pHash : f.pHash // update pHash reference if loaded correctly
        } : f));

        console.log(`[Auto High-Res] Successfully replaced low-res asset ID ${img.id} (${originalRes.width}x${originalRes.height}) with ${bestMatch.width}x${bestMatch.height} visual match!`);
      } catch (downErr: any) {
        console.error("[Auto High-Res] Downloading matching image failed:", downErr);
        setFloatingImages(prev => prev.map(f => f.id === img.id ? { 
          ...f, 
          isSearchInProgress: false, 
          searchStatus: `Download failed: ${downErr.message || downErr}` 
        } : f));
        setTimeout(() => {
          setFloatingImages(prev => prev.map(f => f.id === img.id ? { ...f, searchStatus: undefined } : f));
        }, 3500);
      }
    } else {
      console.log("[Auto High-Res] No higher resolution versions found across any reverse-search providers.");
      setSearchLog(prev => [...prev, `[Auto High-Res] Searched all enabled providers but no suitable high-resolution visual matches were validated.`]);
      
      setFloatingImages(prev => prev.map(f => f.id === img.id ? { 
        ...f, 
        isSearchInProgress: false, 
        searchStatus: "No higher resolution version found" 
      } : f));

      setTimeout(() => {
        setFloatingImages(prev => prev.map(f => f.id === img.id ? { ...f, isSearchInProgress: false, searchStatus: undefined} : f));
      }, 3500);
    }
  };

  const logWindowLockState = useCallback((windowType: 'image' | 'note' | 'sketch', windowId: string, isLocked: boolean) => {
    console.log(`[LOCK_TOGGLE] Window Type: ${windowType}, ID: ${windowId}, New Lock State (isLocked): ${isLocked}`);
  }, []);

  // Settings
  const [glassTranslucency, setGlassTranslucency] = useState<number>(() => {
    const saved = Number.parseFloat(localStorage.getItem('ref-flow-glass-translucency') || '');
    return Number.isFinite(saved) ? Math.min(0.75, Math.max(0, saved)) : 0.22;
  });
  const [alwaysOnTop, setAlwaysOnTop] = useState<boolean>(() => {
    const saved = localStorage.getItem('ref-flow-always-on-top');
    return saved ? saved === 'true' : true;
  });
  const [startOnBoot, setStartOnBoot] = useState<boolean>(() => {
    const saved = localStorage.getItem('ref-flow-start-on-boot');
    return saved ? saved === 'true' : false;
  });
  const [startOnBootStatus, setStartOnBootStatus] = useState<{
    phase: 'checking' | 'ready' | 'saving' | 'error' | 'unavailable';
    message: string;
  }>({ phase: 'checking', message: 'Checking Windows startup registration...' });
  const [launchMinimized, setLaunchMinimized] = useState<boolean>(() => {
    const saved = localStorage.getItem('ref-flow-launch-minimized');
    return saved ? saved === 'true' : false;
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('ref-flow-theme') as 'light' | 'dark') || 'dark';
  });
  
  // Search Configuration State
  const defaultProvidersOrder = ['Wikimedia Commons', 'Openverse'];
  const [providerOrder, setProviderOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('ref-flow-provider-order');
    let orderList = saved
      ? JSON.parse(saved).filter((provider: string) => defaultProvidersOrder.includes(provider))
      : [...defaultProvidersOrder];
    defaultProvidersOrder.forEach(p => {
      if (!orderList.includes(p)) {
        orderList.push(p);
      }
    });
    return orderList;
  });
  const [providerStatus, setProviderStatus] = useState<Record<string, { enabled: boolean, testStatus?: string }>>(() => {
    const saved = localStorage.getItem('ref-flow-provider-status');
    const parsed = saved ? JSON.parse(saved) : {};
    return Object.fromEntries(defaultProvidersOrder
      .filter(provider => parsed[provider])
      .map(provider => [provider, parsed[provider]]));
  });
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState<boolean>(false);
  const [searchDiagnostics, setSearchDiagnostics] = useState<{lastSearch: Date | null, reqCount: number, resCount: number, errors: string[]}>({
    lastSearch: null,
    reqCount: 0,
    resCount: 0,
    errors: []
  });

  useEffect(() => {
    localStorage.removeItem('ref-flow-api-keys');
    localStorage.removeItem('ref-flow-pill-opacity');
    localStorage.setItem('ref-flow-provider-order', JSON.stringify(providerOrder));
    localStorage.setItem('ref-flow-provider-status', JSON.stringify(providerStatus));
  }, []);

  useEffect(() => {
    if (!showSettings) setShowProviderSettings(false);
    if (!showSettings || !showProviderSettings) {
      setShowDiagnosticsModal(false);
    }
  }, [showProviderSettings, showSettings]);

  useEffect(() => {
    let mounted = true;
    const electron = (window as any).require ? (window as any).require('electron') : null;
    if (!electron?.ipcRenderer) {
      setStartOnBootStatus({
        phase: 'unavailable',
        message: 'Startup registration is available in the packaged Windows app.'
      });
      return () => { mounted = false; };
    }

    electron.ipcRenderer.invoke('get-start-on-boot-status')
      .then((result: { success?: boolean; supported?: boolean; enabled?: boolean; message?: string }) => {
        if (!mounted) return;
        if (result.success) {
          setStartOnBoot(Boolean(result.enabled));
          localStorage.setItem('ref-flow-start-on-boot', String(Boolean(result.enabled)));
        }
        setStartOnBootStatus({
          phase: result.supported === false ? 'unavailable' : result.success ? 'ready' : 'error',
          message: result.message || 'Windows startup status is unavailable.'
        });
      })
      .catch((error: Error) => {
        if (!mounted) return;
        setStartOnBootStatus({ phase: 'error', message: `Startup check failed: ${error.message}` });
      });

    return () => { mounted = false; };
  }, []);

  const changeStartOnBoot = async (enabled: boolean) => {
    const electron = (window as any).require ? (window as any).require('electron') : null;
    if (!electron?.ipcRenderer) {
      setStartOnBootStatus({
        phase: 'unavailable',
        message: 'Install the Windows test build to change Start on Boot.'
      });
      return;
    }

    setStartOnBootStatus({ phase: 'saving', message: enabled ? 'Enabling Start on Boot...' : 'Disabling Start on Boot...' });
    try {
      const result = await electron.ipcRenderer.invoke('set-start-on-boot', enabled);
      setStartOnBoot(Boolean(result.enabled));
      localStorage.setItem('ref-flow-start-on-boot', String(Boolean(result.enabled)));
      setStartOnBootStatus({
        phase: result.success ? 'ready' : 'error',
        message: result.message || 'Windows did not confirm the startup change.'
      });
    } catch (error) {
      setStartOnBootStatus({
        phase: 'error',
        message: `Could not change Start on Boot: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  };

  const updateProviderStatus = (newStatus: Record<string, { enabled: boolean, testStatus?: string }>) => {
    setProviderStatus(newStatus);
    localStorage.setItem('ref-flow-provider-status', JSON.stringify(newStatus));
  };
  const updateProviderOrder = (newOrder: string[]) => {
    setProviderOrder(newOrder);
    localStorage.setItem('ref-flow-provider-order', JSON.stringify(newOrder));
  };

  const getProviderConfig = (provider: string) => {
    const isEnabled = providerStatus[provider]?.enabled ?? true;
    return { isEnabled, badge: isEnabled ? 'Ready' : 'Disabled' };
  };

  const [shortcuts, setShortcuts] = useState(() => {
    const defaultKeys = {
      minimize: 'ctrl+alt+m',
      newNote: 'ctrl+alt+n',
      newSketch: 'ctrl+alt+s',
      manager: 'ctrl+alt+p',
      settings: 'ctrl+alt+c',
      closeApp: 'ctrl+alt+q',
      flipBoards: 'ctrl+alt+b',
      toggleWindows: 'ctrl+alt+w'
    };
    const saved = localStorage.getItem('ref-flow-shortcuts');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Preserve intentionally disabled bindings while migrating legacy single-key values.
      const migrated: any = {};
      Object.keys(defaultKeys).forEach((k) => {
        const val = parsed[k];
        if (Object.prototype.hasOwnProperty.call(parsed, k) && typeof val === 'string') {
          if (!val.trim()) {
            migrated[k] = '';
          } else if (val.includes('+')) {
            migrated[k] = buildShortcut(parseShortcut(val));
          } else {
            migrated[k] = `ctrl+alt+${val.toLowerCase()}`;
          }
        } else {
          migrated[k] = (defaultKeys as any)[k];
        }
      });
      return migrated;
    }
    return defaultKeys;
  });

  const setShortcutBinding = useCallback((actionKey: string, shortcut: string) => {
    setShortcuts(current => {
      const next = { ...current, [actionKey]: shortcut };
      localStorage.setItem('ref-flow-shortcuts', JSON.stringify(next));
      return next;
    });
  }, []);

  const selectProjectOfId = async (id: string) => {
    let p = projects.find(proj => proj.id === id);
    if (!p) return;
    p = await ensureProjectLocalDirectory(p);
    setActiveProjectIdState(p.id);
    await setActiveProjectId(p.id);
    setImages(p.images || []);
    setFloatingImages(p.floatingImages || []);
    setFloatingNotes(p.floatingNotes || []);
    setFloatingSketches(p.floatingSketches || []);
    
    if (p.directoryPath) {
        setNeedsPermission(false);
    } else if (p.directoryHandle) {
        const perm = await p.directoryHandle.queryPermission({ mode: 'readwrite' });
        setNeedsPermission(perm !== 'granted');
    } else {
        setNeedsPermission(false);
    }
  };

  const flipThroughBoards = async () => {
    if (projects.length <= 1) return;
    const currentIndex = projects.findIndex(p => p.id === activeProjectId);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % projects.length;
    const nextProject = projects[nextIndex];
    if (nextProject) {
      await selectProjectOfId(nextProject.id);
    }
  };

  const toggleAllCollapsedState = () => {
    const allCollapsed = floatingNotes.every(n => n.isCollapsed) && floatingImages.every(i => i.isCollapsed) && floatingSketches.every(s => s.isCollapsed);
    setFloatingNotes(prev => prev.map(n => ({...n, isCollapsed: !allCollapsed})));
    setFloatingImages(prev => prev.map(i => ({...i, isCollapsed: !allCollapsed})));
    setFloatingSketches(prev => prev.map(s => ({...s, isCollapsed: !allCollapsed})));
  };

  const getElectron = () => {
    const nodeRequire = getNodeRequire();
    return nodeRequire ? nodeRequire('electron') : null;
  };

  const copyPaletteColor = async (rawColor: string) => {
    const color = normalizeHexColor(rawColor);
    if (!color) {
      setCopiedColor(`error:${rawColor}`);
      return;
    }

    let copied = false;
    const electron = getElectron();
    if (electron?.clipboard) {
      try {
        electron.clipboard.writeText(color);
        copied = true;
      } catch (error) {
        console.error('Native palette copy failed:', error);
      }
    }

    if (!copied && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(color);
        copied = true;
      } catch (error) {
        console.warn('Browser palette copy failed; trying the compatibility fallback:', error);
      }
    }

    if (!copied) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = color;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy');
        textarea.remove();
      } catch (error) {
        console.error('Compatibility palette copy failed:', error);
      }
    }

    setCopiedColor(copied ? color : `error:${color}`);
    if (colorCopyTimerRef.current !== null) window.clearTimeout(colorCopyTimerRef.current);
    colorCopyTimerRef.current = window.setTimeout(() => {
      setCopiedColor(null);
      colorCopyTimerRef.current = null;
    }, 1800);
  };

  useEffect(() => () => {
    if (colorCopyTimerRef.current !== null) window.clearTimeout(colorCopyTimerRef.current);
  }, []);

  const openSupportPage = async () => {
    await openInWindowsDefaultBrowser(PATREON_URL);
  };

  const requestUpdateCheck = async () => {
    const electron = getElectron();
    if (!electron?.ipcRenderer) {
      setUpdateStatus(current => ({
        ...current,
        phase: 'development',
        message: 'Update checks are available in the installed app.'
      }));
      return;
    }

    setUpdateActionPending(true);
    try {
      const status = await electron.ipcRenderer.invoke('check-for-updates');
      if (status?.phase) setUpdateStatus(status);
    } catch (error) {
      setUpdateStatus(current => ({
        ...current,
        phase: 'error',
        message: `Update check failed: ${error instanceof Error ? error.message : String(error)}`
      }));
    } finally {
      setUpdateActionPending(false);
    }
  };

  const restartToInstallUpdate = async () => {
    const electron = getElectron();
    if (!electron?.ipcRenderer) return;
    setUpdateActionPending(true);
    try {
      const started = await electron.ipcRenderer.invoke('install-update');
      if (!started) {
        setUpdateStatus(current => ({
          ...current,
          phase: 'error',
          message: 'The update is not ready yet. Check again in a moment.'
        }));
        setUpdateActionPending(false);
      }
    } catch (error) {
      setUpdateStatus(current => ({
        ...current,
        phase: 'error',
        message: `Could not start the installer: ${error instanceof Error ? error.message : String(error)}`
      }));
      setUpdateActionPending(false);
    }
  };

  const updateIsBusy = updateActionPending || ['checking', 'available', 'downloading', 'installing'].includes(updateStatus.phase);
  const updateButtonLabel = updateStatus.phase === 'ready'
    ? `Restart to install v${updateStatus.availableVersion || 'latest'}`
    : updateStatus.phase === 'checking'
      ? 'Checking for updates...'
      : ['available', 'downloading'].includes(updateStatus.phase)
        ? `Downloading... ${Math.round(updateStatus.percent || 0)}%`
        : updateStatus.phase === 'installing'
          ? 'Restarting...'
          : 'Check for updates';

  const sanitizeProjectFolderName = (name: string) =>
    (name || 'board')
      .replace(/[^a-z0-9._-]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .slice(0, 80) || 'board';

  const getProjectFolderName = (project: Pick<Project, 'id' | 'name'>) =>
    `${sanitizeProjectFolderName(project.name)}-${project.id.slice(0, 8)}`;

  const getInstalledAutosaveRoot = async () => {
    const electron = getElectron();
    if (!electron?.ipcRenderer) return "";
    try {
      return await electron.ipcRenderer.invoke('get-default-data-directory');
    } catch (e) {
      console.warn("Could not read default data directory:", e);
      return "";
    }
  };

  const hasCompleteLocalMediaMirror = (project: Project, directoryPath: string) => {
    const nodeRequire = getNodeRequire();
    if (!nodeRequire || !directoryPath) return false;
    try {
      const fs = nodeRequire('fs');
      const path = nodeRequire('path');
      const imagesDirectory = path.join(directoryPath, 'images');
      if (!fs.existsSync(imagesDirectory)) return false;
      const backgroundFilesExist = (project.images || []).every((source, index) =>
        fs.existsSync(path.join(imagesDirectory, getBackgroundMediaFileName(source, index)))
      );
      const floatingFilesExist = (project.floatingImages || []).every(image =>
        fs.existsSync(path.join(imagesDirectory, getFloatingMediaFileName(image)))
      );
      return backgroundFilesExist && floatingFilesExist;
    } catch {
      return false;
    }
  };

  const ensureProjectLocalDirectory = async (project: Project, preferredRoot?: string): Promise<Project> => {
    if (project.directoryPath) {
      if (hasCompleteLocalMediaMirror(project, project.directoryPath)) {
        mirroredMediaSnapshotsRef.current.set(project.id, createProjectMediaSnapshot(project));
      }
      return project;
    }
    if (!getNodeRequire()) return project;
    const root = preferredRoot || defaultAutosaveRoot || await getInstalledAutosaveRoot();
    const nodeRequire = getNodeRequire();
    if (!root || !nodeRequire) return project;

    const path = nodeRequire('path');
    const directoryPath = path.join(root, getProjectFolderName(project));
    const projectWithDirectory = { ...project, directoryPath };
    await updateProject(project.id, { directoryPath });
    const syncResult = await syncBoardToPath(projectWithDirectory, directoryPath);
    if (syncResult.failed.length > 0) {
      console.warn('The board folder was created with media warnings:', syncResult.failed);
    }
    setDefaultAutosaveRoot(root);
    setProjects(await getProjects());
    return projectWithDirectory;
  };

  useEffect(() => {
    const electron = getElectron();
    if (!electron?.ipcRenderer) {
      setUpdateStatus(current => ({
        ...current,
        phase: 'development',
        message: 'Update checks are available in the installed app.'
      }));
      return;
    }

    let isMounted = true;
    const handleUpdateStatus = (_event: any, status: AppUpdateStatus) => {
      if (isMounted && status?.phase) setUpdateStatus(status);
    };

    electron.ipcRenderer.invoke('get-update-status').then((status: AppUpdateStatus) => {
      if (isMounted && status?.phase) setUpdateStatus(status);
    }).catch((error: unknown) => {
      console.warn('Could not read update status:', error);
    });
    electron.ipcRenderer.on('update-status', handleUpdateStatus);

    return () => {
      isMounted = false;
      electron.ipcRenderer.removeListener('update-status', handleUpdateStatus);
    };
  }, []);

  useEffect(() => {
    const electron = getElectron();
    if (!electron?.ipcRenderer) return;

    let isMounted = true;
    electron.ipcRenderer.invoke('get-display-layout').then((layout: DisplayLayout) => {
      if (isMounted && layout?.primary) setDisplayLayout(layout);
    }).catch((e: any) => {
      console.warn("Could not read display layout:", e);
    });

    const handleLayoutChange = (_event: any, layout: DisplayLayout) => {
      if (layout?.primary) setDisplayLayout(layout);
    };
    electron.ipcRenderer.on('display-layout-changed', handleLayoutChange);

    return () => {
      isMounted = false;
      electron.ipcRenderer.removeListener('display-layout-changed', handleLayoutChange);
    };
  }, []);

  useEffect(() => {
    const electron = getElectron();
    if (!electron?.ipcRenderer) return;
    const sendHeartbeat = () => electron.ipcRenderer.send('renderer-heartbeat');
    sendHeartbeat();
    const heartbeat = window.setInterval(sendHeartbeat, 1000);
    return () => window.clearInterval(heartbeat);
  }, []);

  useEffect(() => {
    const electron = getElectron();
    if (!electron?.ipcRenderer) return;
    let clearTimer = 0;
    const handleDragError = (_event: any, _id: string, message: string) => {
      setDragError(message || 'This reference could not be dragged into the other app.');
      window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(() => setDragError(''), 3500);
    };
    electron.ipcRenderer.on('reference-drag-error', handleDragError);
    return () => {
      window.clearTimeout(clearTimer);
      electron.ipcRenderer.removeListener('reference-drag-error', handleDragError);
    };
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    const panelStrength = Math.round((1 - glassTranslucency) * 100);
    const cardStrength = Math.round((1 - (glassTranslucency * 0.64)) * 100);
    document.documentElement.style.setProperty('--glass-panel-strength', `${panelStrength}%`);
    document.documentElement.style.setProperty('--glass-card-strength', `${cardStrength}%`);
  }, [glassTranslucency]);

  // Initialize DB
  useEffect(() => {
    async function init() {
      const installedRoot = await getInstalledAutosaveRoot();
      if (installedRoot) setDefaultAutosaveRoot(installedRoot);
      const allProjects = await getProjects();
      let currentActiveId = await getActiveProjectId();
      
      if (allProjects.length === 0) {
        const defaultProj = await createProject('Default Board');
        setProjects([defaultProj]);
        setActiveProjectIdState(defaultProj.id);
        await setActiveProjectId(defaultProj.id);
        if (installedRoot) {
          const nodeRequire = getNodeRequire();
          const path = nodeRequire ? nodeRequire('path') : null;
          const dirPath = path ? path.join(installedRoot, getProjectFolderName(defaultProj)) : "";
          if (dirPath) {
            await updateProject(defaultProj.id, { directoryPath: dirPath });
            await syncBoardToPath({ ...defaultProj, directoryPath: dirPath }, dirPath);
            setProjects(await getProjects());
          }
        }
      } else {
        setProjects(allProjects);
        if (!currentActiveId || !allProjects.find(p => p.id === currentActiveId)) {
          currentActiveId = allProjects[0].id;
          await setActiveProjectId(currentActiveId);
        }
        
        setActiveProjectIdState(currentActiveId);
        const activeProj = allProjects.find(p => p.id === currentActiveId);
        if (activeProj) {
          setImages(activeProj.images || []);
          setFloatingImages(activeProj.floatingImages || []);
          setFloatingNotes(activeProj.floatingNotes || []);
          setFloatingSketches(activeProj.floatingSketches || []);
          
          if (activeProj.directoryPath) {
             if (hasCompleteLocalMediaMirror(activeProj, activeProj.directoryPath)) {
               mirroredMediaSnapshotsRef.current.set(activeProj.id, createProjectMediaSnapshot(activeProj));
             }
             setNeedsPermission(false);
          } else if (installedRoot) {
             const nodeRequire = getNodeRequire();
             const path = nodeRequire ? nodeRequire('path') : null;
             const dirPath = path ? path.join(installedRoot, getProjectFolderName(activeProj)) : "";
             if (dirPath) {
               await updateProject(activeProj.id, { directoryPath: dirPath });
               await syncBoardToPath({ ...activeProj, directoryPath: dirPath }, dirPath);
               setProjects(await getProjects());
               setNeedsPermission(false);
             }
          } else if (activeProj.directoryHandle) {
             const perm = await activeProj.directoryHandle.queryPermission({ mode: 'readwrite' });
             setNeedsPermission(perm !== 'granted');
          } else {
             setNeedsPermission(false);
          }
        }
      }
      setIsLoading(false);
    }
    init();
  }, []);

  const syncBoardToHandle = async (project: Project, dirHandle: any, syncMedia = true) => {
    try {
      if ((await dirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
          return;
      }

      const extensionForUrl = (url: string, fallback = 'bin') => {
        const lower = (url || '').toLowerCase();
        if (lower.startsWith('data:image/png') || lower.includes('.png')) return 'png';
        if (lower.startsWith('data:image/webp') || lower.includes('.webp')) return 'webp';
        if (lower.startsWith('data:image/gif') || lower.includes('.gif')) return 'gif';
        if (lower.startsWith(`data:${DOCX_MIME_TYPE}`) || lower.includes('.docx')) return 'docx';
        if (lower.startsWith(`data:${XLSX_MIME_TYPE}`) || lower.includes('.xlsx')) return 'xlsx';
        if (lower.startsWith('data:application/pdf') || lower.includes('.pdf')) return 'pdf';
        if (lower.startsWith('data:image/jpeg') || lower.startsWith('data:image/jpg') || lower.includes('.jpg') || lower.includes('.jpeg')) return 'jpg';
        return fallback;
      };

      const writeTextFile = async (fileName: string, content: string) => {
        const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
      };
      
      const saveBase64 = async (b64: string, fileName: string) => {
        if (!b64 || !b64.startsWith('data:')) return;
        try {
          const res = await fetch(b64);
          const blob = await res.blob();
          const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        } catch (e) {
          console.error(`Failed to export image:`, e);
        }
      };

      const manifestProject = {
        ...project,
        directoryHandle: undefined,
        images: (project.images || []).map((source, index) => `background_${index + 1}.${extensionForUrl(source, 'png')}`),
        floatingImages: (project.floatingImages || []).map(image => ({
          ...image,
          url: `floating_${sanitizeExportStem(image.id)}.${extensionForUrl(image.url, image.type || 'png')}`
        })),
        exportedAt: new Date().toISOString()
      };
      await writeTextFile('board.json', JSON.stringify(manifestProject, null, 2));

      if (syncMedia && project.images && project.images.length > 0) {
        let i = 1;
        for (const img of project.images) {
          await saveBase64(img, `background_${i}.${extensionForUrl(img, 'png')}`);
          i++;
        }
      }

      if (syncMedia && project.floatingImages && project.floatingImages.length > 0) {
        for (const img of project.floatingImages) {
          await saveBase64(img.url, `floating_${sanitizeExportStem(img.id)}.${extensionForUrl(img.url, img.type || 'png')}`);
        }
      }

      let content = `# Notes for ${project.name}\n\n`;
      if (project.floatingNotes && project.floatingNotes.length > 0) {
        project.floatingNotes.forEach((n, idx) => {
          content += `## Note ${idx + 1}\n${n.text}\n\n---\n\n`;
        });
      } else {
        content += `No notes available.\n`;
      }
      await writeTextFile('notes.md', content);
      await writeTextFile('sketches.json', JSON.stringify(project.floatingSketches || [], null, 2));
      await writeTextFile('annotations.json', JSON.stringify(
        (project.floatingImages || []).map(image => ({
          imageId: image.id,
          type: image.type || 'image',
          strokes: image.annotations || [],
          pages: image.type === 'pdf' ? image.pdfAnnotations || {} : undefined
        })),
        null,
        2
      ));
      if (syncMedia) {
        mirroredMediaSnapshotsRef.current.set(project.id, createProjectMediaSnapshot(project));
      }
    } catch (err: any) {
      console.error("Auto-sync failed", err);
    }
  };

  const syncBoardToPath = async (project: Project, directoryPath: string, syncMedia = true): Promise<{ saved: number; failed: string[] }> => {
    const nodeRequire = getNodeRequire();
    if (!nodeRequire || !directoryPath) {
      return { saved: 0, failed: ['Desktop filesystem access is unavailable.'] };
    }

    try {
      const electron = nodeRequire('electron');
      const fs = nodeRequire('fs');
      const path = nodeRequire('path');
      const crypto = nodeRequire('crypto');
      const { fileURLToPath } = nodeRequire('url');
      fs.mkdirSync(directoryPath, { recursive: true });
      const imagesDirectory = path.join(directoryPath, 'images');
      fs.mkdirSync(imagesDirectory, { recursive: true });

      const writeText = (fileName: string, content: string) => {
        fs.writeFileSync(path.join(directoryPath, fileName), content, 'utf8');
      };

      const readMedia = async (source: string) => {
        if (!source) throw new Error('The image source is empty.');
        if (source.startsWith('data:')) {
          const comma = source.indexOf(',');
          if (comma < 0) throw new Error('The image data URL is malformed.');
          const metadata = source.slice(0, comma);
          const payload = source.slice(comma + 1);
          return Buffer.from(payload, /;base64/i.test(metadata) ? 'base64' : 'utf8');
        }
        if (source.startsWith('file://')) return fs.readFileSync(fileURLToPath(source));
        if (fs.existsSync(source)) return fs.readFileSync(source);

        const response = await fetch(source);
        if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`);
        return Buffer.from(await response.arrayBuffer());
      };

      const saveMedia = async (source: string, fileStem: string, type: FloatingMediaType = 'image') => {
        const sourceBuffer = await readMedia(source);
        const extension = getSavedMediaExtension(source, type);
        if (extension === 'pdf' || extension === 'docx' || extension === 'xlsx') {
          fs.writeFileSync(path.join(imagesDirectory, `${fileStem}.${extension}`), sourceBuffer);
          return;
        }

        const decodedImage = electron.nativeImage.createFromBuffer(sourceBuffer);
        if (decodedImage.isEmpty()) throw new Error('The image could not be decoded.');
        const encodedImage = extension === 'jpg' ? decodedImage.toJPEG(95) : decodedImage.toPNG();
        fs.writeFileSync(path.join(imagesDirectory, `${fileStem}.${extension}`), encodedImage);
      };

      const manifestProject = createLocalBoardManifest(project, 'images/');

      writeText('board.json', JSON.stringify(manifestProject, null, 2));
      writeText('sketches.json', JSON.stringify(project.floatingSketches || [], null, 2));
      writeText('annotations.json', JSON.stringify(
        (project.floatingImages || []).map(image => ({
          imageId: image.id,
          type: image.type || 'image',
          strokes: image.annotations || [],
          pages: image.type === 'pdf' ? image.pdfAnnotations || {} : undefined
        })),
        null,
        2
      ));

      let notes = `# Notes for ${project.name}\n\n`;
      if (project.floatingNotes && project.floatingNotes.length > 0) {
        project.floatingNotes.forEach((n, idx) => {
          notes += `## Note ${idx + 1}\n${n.text}\n\n---\n\n`;
        });
      } else {
        notes += `No notes available.\n`;
      }
      writeText('notes.md', notes);

      let saved = 0;
      const failed: string[] = [];
      if (syncMedia) {
        const previousSnapshot = mirroredMediaSnapshotsRef.current.get(project.id);
        const previousFloatingSources = new Map(
          (previousSnapshot?.floatingSources || []).map(item => [item.id, item])
        );
        const mediaIndexPath = path.join(imagesDirectory, '.refflow-media-index.json');
        let previousMediaIndex: Record<string, string> = {};
        try {
          if (fs.existsSync(mediaIndexPath)) {
            previousMediaIndex = JSON.parse(fs.readFileSync(mediaIndexPath, 'utf8'));
          }
        } catch (error) {
          console.warn('Could not read the board media index; changed files will be rebuilt.', error);
        }

        const nextMediaIndex: Record<string, string> = {};
        const expectedFileNames = new Set<string>();
        const saveIndexedMedia = async (
          source: string,
          fileStem: string,
          fileName: string,
          label: string,
          type: FloatingMediaType = 'image',
          sourceUnchanged = false
        ) => {
          expectedFileNames.add(fileName);
          const destination = path.join(imagesDirectory, fileName);
          if (sourceUnchanged && fs.existsSync(destination)) {
            nextMediaIndex[fileName] = previousMediaIndex[fileName]
              || crypto.createHash('sha256').update(source).digest('hex');
            saved++;
            return;
          }
          const fingerprint = crypto.createHash('sha256').update(source).digest('hex');
          if (previousMediaIndex[fileName] === fingerprint && fs.existsSync(destination)) {
            nextMediaIndex[fileName] = fingerprint;
            saved++;
            return;
          }
          try {
            await saveMedia(source, fileStem, type);
            nextMediaIndex[fileName] = fingerprint;
            saved++;
          } catch (error: any) {
            failed.push(`${label}: ${error?.message || String(error)}`);
          }
        };

        for (let index = 0; index < (project.images || []).length; index++) {
          const source = project.images[index];
          await saveIndexedMedia(
            source,
            `background_${index + 1}`,
            getBackgroundMediaFileName(source, index),
            `Background ${index + 1}`,
            'image',
            previousSnapshot?.backgroundSources[index] === source
          );
        }
        for (const image of project.floatingImages || []) {
          const previousImage = previousFloatingSources.get(image.id);
          const mediaType = image.type || 'image';
          await saveIndexedMedia(
            image.url,
            `floating_${sanitizeExportStem(image.id)}`,
            getFloatingMediaFileName(image),
            `${mediaType === 'image' ? 'Image' : mediaType.toUpperCase()} ${image.id}`,
            mediaType,
            previousImage?.source === image.url && previousImage.type === mediaType
          );
        }

        for (const fileName of fs.readdirSync(imagesDirectory)) {
          if (/^(background_|floating_)/i.test(fileName) && !expectedFileNames.has(fileName)) {
            fs.unlinkSync(path.join(imagesDirectory, fileName));
          }
        }
        fs.writeFileSync(mediaIndexPath, JSON.stringify(nextMediaIndex, null, 2), 'utf8');
        if (failed.length === 0) {
          mirroredMediaSnapshotsRef.current.set(project.id, createProjectMediaSnapshot(project));
        }
      }
      return { saved, failed };
    } catch (err: any) {
      console.error("Native folder sync failed", err);
      return { saved: 0, failed: [err?.message || String(err)] };
    }
  };

  const drainAutosaveQueue = useCallback(async () => {
    const queue = autosaveQueueRef.current;
    if (queue.inFlight) return;
    queue.inFlight = true;
    try {
      while (queue.pending) {
        const pendingSave = queue.pending;
        queue.pending = null;
        try {
          await pendingSave();
        } catch (error) {
          console.error('Project autosave failed:', error);
        }
      }
    } finally {
      queue.inFlight = false;
    }
  }, []);

  // Save changes automatically. Work is serialized and coalesced so a large
  // board can never build up overlapping IndexedDB and filesystem writes.
  useEffect(() => {
    if (isLoading || !activeProjectId) return;

    const queue = autosaveQueueRef.current;
    if (queue.timer) window.clearTimeout(queue.timer);
    const baseProject = projectsRef.current.find(project => project.id === activeProjectId);
    if (!baseProject) return;
    const projectSnapshot: Project = {
      ...baseProject,
      images,
      floatingImages,
      floatingNotes,
      floatingSketches
    };

    queue.timer = window.setTimeout(() => {
      queue.timer = null;
      queue.pending = async () => {
        const savedAt = Date.now();
        await updateProject(activeProjectId, {
          images: projectSnapshot.images,
          floatingImages: projectSnapshot.floatingImages,
          floatingNotes: projectSnapshot.floatingNotes,
          floatingSketches: projectSnapshot.floatingSketches
        });
        setProjects(current => {
          const next = current.map(project => project.id === activeProjectId
            ? {
                ...project,
                images: projectSnapshot.images,
                floatingImages: projectSnapshot.floatingImages,
                floatingNotes: projectSnapshot.floatingNotes,
                floatingSketches: projectSnapshot.floatingSketches,
                updatedAt: savedAt
              }
            : project
          );
          projectsRef.current = next;
          return next;
        });

        const mediaSnapshot = createProjectMediaSnapshot(projectSnapshot);
        const syncMedia = !projectMediaSnapshotsEqual(
          mirroredMediaSnapshotsRef.current.get(activeProjectId),
          mediaSnapshot
        );

        if (projectSnapshot.directoryPath) {
          const syncResult = await syncBoardToPath(projectSnapshot, projectSnapshot.directoryPath, syncMedia);
          if (syncResult.failed.length > 0) {
            console.warn('Some board media could not be mirrored locally:', syncResult.failed);
          }
        } else if (projectSnapshot.directoryHandle) {
          await syncBoardToHandle(projectSnapshot, projectSnapshot.directoryHandle, syncMedia);
        }
      };
      void drainAutosaveQueue();
    }, 1500);

    return () => {
      if (queue.timer) {
        window.clearTimeout(queue.timer);
        queue.timer = null;
      }
    };
  }, [images, floatingImages, floatingNotes, floatingSketches, activeProjectId, isLoading, drainAutosaveQueue]);

  const exportBoard = async (project: Project) => {
    try {
      const electron = getElectron();
      if (electron?.ipcRenderer) {
        const nodeRequire = getNodeRequire();
        if (!nodeRequire) throw new Error('Desktop filesystem access is unavailable.');
        const path = nodeRequire('path');
        const result = await electron.ipcRenderer.invoke('show-open-dialog', {
          title: 'Choose ReferenceFlow autosave folder',
          defaultPath: defaultAutosaveRoot || undefined,
          properties: ['openDirectory', 'createDirectory']
        });
        if (result.canceled || !result.filePaths?.[0]) return;

        const selectedRoot = result.filePaths[0];
        setDefaultAutosaveRoot(selectedRoot);
        await electron.ipcRenderer.invoke('set-default-data-directory', selectedRoot);
        const folderName = getProjectFolderName(project);
        const dirPath = path.join(selectedRoot, folderName);
        const projectSnapshot = project.id === activeProjectId ? {
          ...project,
          images,
          floatingImages,
          floatingNotes,
          floatingSketches
        } : project;
        const updatedProject = {
          ...projectSnapshot,
          directoryPath: dirPath
        };
        await updateProject(project.id, { directoryPath: dirPath });
        const updatedProjects = await getProjects();
        setProjects(updatedProjects);
        const syncResult = await syncBoardToPath(updatedProject, dirPath);
        if (project.id === activeProjectId) setNeedsPermission(false);
        if (syncResult.failed.length > 0) {
          throw new Error(`The board files were created, but ${syncResult.failed.length} media file(s) could not be saved. ${syncResult.failed[0]}`);
        }
        alert(`Export complete. ${syncResult.saved} media file(s) were saved and this board will keep syncing locally.`);
        return;
      }

      if (!('showDirectoryPicker' in window)) {
        alert("Folder export is not supported in this browser.");
        return;
      }
      
      const rootHandle = await (window as any).showDirectoryPicker();
      const folderName = getProjectFolderName(project);
      const dirHandle = await rootHandle.getDirectoryHandle(folderName, { create: true });
      
      await updateProject(project.id, { directoryHandle: dirHandle });
      const updatedProjects = await getProjects();
      setProjects(updatedProjects);
      
      // Re-find to get identical reference if needed
      const storedProject = updatedProjects.find(p => p.id === project.id) || project;
      const updatedProject = project.id === activeProjectId ? {
        ...storedProject,
        images,
        floatingImages,
        floatingNotes,
        floatingSketches
      } : storedProject;
      await syncBoardToHandle(updatedProject, dirHandle);
      
      if (project.id === activeProjectId) {
         setNeedsPermission(false);
      }
      
      alert('Export complete & Auto-save enabled for this folder!');
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error("Export failed", err);
        alert("Export failed: " + err.message);
      }
    }
  };

  // Dragging the pill around
  const [position, setPosition] = useState(() => {
    try {
      const saved = localStorage.getItem('ref-flow-pill-position');
      const parsed = saved ? JSON.parse(saved) : null;
      if (parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) return parsed;
    } catch (error) {
      console.warn('Could not restore the pill position:', error);
    }
    return { x: 50, y: 50 };
  });
  const hadSavedPillPositionRef = useRef(localStorage.getItem('ref-flow-pill-position') !== null);
  const [isDraggingPill, setIsDraggingPill] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const pillElementRef = useRef<HTMLDivElement>(null);
  const pillDragActiveRef = useRef(false);
  const pillDragMovedRef = useRef(false);
  const pillDragOriginRef = useRef({ x: 0, y: 0 });
  const pillDragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const pillFollowerOriginsRef = useRef<Array<{ element: HTMLElement; left: number; top: number }>>([]);

  const previewImperativePillMove = useCallback((candidate: { x: number; y: number }) => {
    pillDragPositionRef.current = candidate;
    const pillElement = pillElementRef.current;
    if (pillElement) {
      pillElement.style.left = `${candidate.x}px`;
      pillElement.style.top = `${candidate.y}px`;
    }

    const deltaX = candidate.x - pillDragOriginRef.current.x;
    const deltaY = candidate.y - pillDragOriginRef.current.y;
    for (const follower of pillFollowerOriginsRef.current) {
      follower.element.style.left = `${follower.left + deltaX}px`;
      follower.element.style.top = `${follower.top + deltaY}px`;
    }
  }, []);

  // Resizing the pill
  const [pillDimensions, setPillDimensions] = useState(() => {
    const saved = localStorage.getItem('ref-flow-pill-dim-vert');
    if (saved) return JSON.parse(saved);
    return { width: 216, height: 480 };
  });
  const [retractedPillSize, setRetractedPillSize] = useState(() => {
    const saved = Number(localStorage.getItem('ref-flow-retracted-pill-size'));
    return Number.isFinite(saved) && saved > 0 ? Math.min(96, Math.max(40, saved)) : 48;
  });
  const getPrimaryWorkspaceOrigin = useCallback(() => {
    const primary = displayLayout?.primary;
    if (!primary) return { x: position.x + pillDimensions.width + 20, y: position.y };
    return {
      x: Math.min(primary.x + primary.width - 460, Math.max(primary.x + 80, position.x + pillDimensions.width + 20)),
      y: Math.min(primary.y + primary.height - 260, Math.max(primary.y + 80, position.y))
    };
  }, [displayLayout, position, pillDimensions]);

  const clampPillToConnectedDisplay = useCallback((candidate: { x: number; y: number }) => {
    if (!displayLayout) return candidate;
    const displays = displayLayout.displays?.length
      ? displayLayout.displays
      : [{ bounds: displayLayout.primary, workArea: displayLayout.primary, isPrimary: true } as any];
    const pillWidth = isRetracted ? retractedPillSize : pillDimensions.width;
    const pillHeight = isRetracted ? retractedPillSize : pillDimensions.height;
    const center = { x: candidate.x + pillWidth / 2, y: candidate.y + pillHeight / 2 };
    const distanceToBounds = (bounds: { x: number; y: number; width: number; height: number }) => {
      const dx = Math.max(bounds.x - center.x, 0, center.x - (bounds.x + bounds.width));
      const dy = Math.max(bounds.y - center.y, 0, center.y - (bounds.y + bounds.height));
      return (dx * dx) + (dy * dy);
    };
    const target = displays.reduce((best, display) =>
      distanceToBounds(display.bounds) < distanceToBounds(best.bounds) ? display : best
    , displays.find(display => display.isPrimary) || displays[0]);
    const bounds = target.workArea || target.bounds;
    const margin = 12;
    const maxX = Math.max(bounds.x + margin, bounds.x + bounds.width - Math.min(pillWidth, bounds.width) - margin);
    const maxY = Math.max(bounds.y + margin, bounds.y + bounds.height - Math.min(pillHeight, bounds.height) - margin);
    return {
      x: Math.min(maxX, Math.max(bounds.x + margin, candidate.x)),
      y: Math.min(maxY, Math.max(bounds.y + margin, candidate.y))
    };
  }, [displayLayout, isRetracted, pillDimensions, retractedPillSize]);

  useEffect(() => {
    if (!displayLayout) return;
    setPosition(current => {
      const candidate = hadSavedPillPositionRef.current
        ? current
        : { x: displayLayout.primary.x + 28, y: displayLayout.primary.y + 28 };
      hadSavedPillPositionRef.current = true;
      const next = clampPillToConnectedDisplay(candidate);
      return next.x === current.x && next.y === current.y ? current : next;
    });
  }, [displayLayout, clampPillToConnectedDisplay]);

  useEffect(() => {
    localStorage.setItem('ref-flow-pill-position', JSON.stringify(position));
  }, [position]);

  useEffect(() => {
    localStorage.setItem('ref-flow-retracted-pill-size', String(retractedPillSize));
  }, [retractedPillSize]);

  useEffect(() => {
    const electron = getElectron();
    if (!electron?.ipcRenderer) return;
    electron.ipcRenderer.invoke('get-launch-context').then((context: { shouldRevealPill?: boolean }) => {
      if (context?.shouldRevealPill) {
        setIsPillVisible(true);
        setIsRetracted(false);
      }
    }).catch((error: any) => console.warn('Could not read launch context:', error));
  }, []);
  const [isResizingPill, setIsResizingPill] = useState(false);
  const resizePillStart = useRef<EdgeResizeStart & { retractedSize: number }>({
    pointerX: 0,
    pointerY: 0,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    edge: 'bottom-right',
    retractedSize: 48
  });

  // Handle Dragging global floating images
  const [draggingFloatingId, setDraggingFloatingId] = useState<string | null>(null);
  const dragFloatingOffset = useRef({ x: 0, y: 0 });
  const dragFloatingGeometry = useRef<{
    width: number;
    height: number;
    toolbarHeight: number;
    targets: WindowRect[];
    bounds: WindowRect[];
  }>({ width: 0, height: 0, toolbarHeight: 0, targets: [], bounds: [] });
  const [windowSnapGuides, setWindowSnapGuides] = useState<{ x?: number; y?: number }>({});
  const opacityFrameRef = useRef<number | null>(null);
  const pendingOpacityRef = useRef<{ id: string; opacity: number } | null>(null);

  const updateFloatingOpacity = useCallback((id: string, opacity: number) => {
    pendingOpacityRef.current = { id, opacity };
    if (opacityFrameRef.current !== null) return;

    opacityFrameRef.current = window.requestAnimationFrame(() => {
      const pending = pendingOpacityRef.current;
      opacityFrameRef.current = null;
      if (!pending) return;
      setFloatingImages(prev => prev.map(f => f.id === pending.id ? { ...f, opacity: pending.opacity } : f));
    });
  }, []);

  const updateFloatingMedia = useCallback((id: string, patch: Partial<FloatingImage>) => {
    setFloatingImages(current => current.map(image => image.id === id ? { ...image, ...patch } : image));
  }, []);

  useEffect(() => {
    return () => {
      if (opacityFrameRef.current !== null) {
        window.cancelAnimationFrame(opacityFrameRef.current);
      }
    };
  }, []);

  // Handle Resizing global floating images
  const [resizingFloatingId, setResizingFloatingId] = useState<string | null>(null);
  const resizeStart = useRef<EdgeResizeStart>({
    pointerX: 0,
    pointerY: 0,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    edge: 'right'
  });

  // Handle Dragging global floating notes
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const dragNoteOffset = useRef({ x: 0, y: 0 });

  // Handle Resizing global floating notes
  const [resizingNoteId, setResizingNoteId] = useState<string | null>(null);
  const resizeNoteStart = useRef<EdgeResizeStart & { lockAspectRatio: boolean }>({
    pointerX: 0,
    pointerY: 0,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    edge: 'bottom-right',
    lockAspectRatio: false
  });

  // Handle Dragging global floating sketches
  const [draggingSketchId, setDraggingSketchId] = useState<string | null>(null);
  const dragSketchOffset = useRef({ x: 0, y: 0 });

  // Handle Resizing global floating sketches
  const [resizingSketchId, setResizingSketchId] = useState<string | null>(null);
  const resizeSketchStart = useRef<EdgeResizeStart>({
    pointerX: 0,
    pointerY: 0,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    edge: 'bottom-right'
  });

  // Ticking ref for requestAnimationFrame throttling of mousemove events
  const ticking = useRef(false);
  const activeWindowDragElementRef = useRef<HTMLElement | null>(null);
  const pendingWindowMoveRef = useRef<{
    kind: FloatingWindowKind;
    id: string;
    x: number;
    y: number;
  } | null>(null);

  const findFloatingWindowElement = useCallback((kind: FloatingWindowKind, id: string) => {
    return Array.from(document.querySelectorAll<HTMLElement>(`.floating-window[data-window-kind="${kind}"]`))
      .find(element => element.dataset.id === id) || null;
  }, []);

  const beginImperativeWindowMove = useCallback((kind: FloatingWindowKind, id: string, x: number, y: number) => {
    activeWindowDragElementRef.current = findFloatingWindowElement(kind, id);
    pendingWindowMoveRef.current = { kind, id, x, y };
  }, [findFloatingWindowElement]);

  const previewImperativeWindowMove = useCallback((x: number, y: number) => {
    const pending = pendingWindowMoveRef.current;
    if (!pending) return;
    pending.x = x;
    pending.y = y;
    const element = activeWindowDragElementRef.current;
    if (element) {
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
    }
  }, []);

  const commitImperativeWindowMove = useCallback(() => {
    const pending = pendingWindowMoveRef.current;
    pendingWindowMoveRef.current = null;
    activeWindowDragElementRef.current = null;
    if (!pending) return;
    if (pending.kind === 'image') {
      setFloatingImages(current => current.map(image => image.id === pending.id ? { ...image, x: pending.x, y: pending.y } : image));
    } else if (pending.kind === 'note') {
      setFloatingNotes(current => current.map(note => note.id === pending.id ? { ...note, x: pending.x, y: pending.y } : note));
    } else {
      setFloatingSketches(current => current.map(sketch => sketch.id === pending.id ? { ...sketch, x: pending.x, y: pending.y } : sketch));
    }
  }, []);

  const executeShortcutAction = useCallback((actionKey: string) => {
    switch (actionKey) {
      case 'minimize':
        setIsRetracted(prev => !prev);
        break;
      case 'manager':
        setShowManager(prev => !prev);
        break;
      case 'settings':
        setShowSettings(prev => !prev);
        break;
      case 'newNote': {
        const newId = Math.random().toString(36).substr(2, 9);
        setFloatingNotes(prev => [...prev, {
          id: newId,
          text: '',
          x: position.x + pillDimensions.width + 20,
          y: position.y + 100,
          width: 320,
          height: 150,
          color: '#fef3c7',
          isCollapsed: false,
          isLocked: false
        }]);
        setTopWindowId(newId);
        break;
      }
      case 'newSketch': {
        const newId = Math.random().toString(36).substr(2, 9);
        setFloatingSketches(prev => [...prev, {
          id: newId,
          lines: [],
          x: position.x + pillDimensions.width + 20,
          y: position.y + 200,
          width: 300,
          height: 300,
          backgroundColor: '#ffffff',
          isCollapsed: false,
          isLocked: false
        }]);
        setTopWindowId(newId);
        break;
      }
      case 'closeApp': {
        const electron = (window as any).require ? (window as any).require('electron') : null;
        const ipcRenderer = electron ? electron.ipcRenderer : null;
        if (ipcRenderer) {
          ipcRenderer.send('close-app');
        } else {
          window.close();
        }
        break;
      }
      case 'flipBoards':
        flipThroughBoards();
        break;
      case 'toggleWindows':
        toggleAllCollapsedState();
        break;
      default:
        break;
    }
  }, [position, pillDimensions, flipThroughBoards, toggleAllCollapsedState]);

  // Synchronize taskbar option to Electron
  useEffect(() => {
    localStorage.setItem('ref-flow-show-in-taskbar', showInTaskbar.toString());
    const electron = (window as any).require ? (window as any).require('electron') : null;
    if (electron && electron.ipcRenderer) {
      electron.ipcRenderer.send('set-skip-taskbar', !showInTaskbar);
    }
  }, [showInTaskbar]);

  useEffect(() => {
    localStorage.setItem('ref-flow-always-on-top', alwaysOnTop.toString());
    const electron = (window as any).require ? (window as any).require('electron') : null;
    if (electron && electron.ipcRenderer) {
      electron.ipcRenderer.send('set-always-on-top', alwaysOnTop);
    }
  }, [alwaysOnTop]);

  useEffect(() => {
    localStorage.setItem('ref-flow-start-on-boot', startOnBoot.toString());
  }, [startOnBoot]);

  useEffect(() => {
    localStorage.setItem('ref-flow-launch-minimized', launchMinimized.toString());
    const electron = (window as any).require ? (window as any).require('electron') : null;
    if (electron && electron.ipcRenderer) {
      electron.ipcRenderer.send('set-launch-minimized', launchMinimized);
    }
  }, [launchMinimized]);

  // Synchronize pill visibility to local storage
  useEffect(() => {
    localStorage.setItem('ref-flow-pill-visible', isPillVisible.toString());
  }, [isPillVisible]);

  // Sync / Register active global shortcuts in Electron main process
  useEffect(() => {
    const electron = (window as any).require ? (window as any).require('electron') : null;
    if (electron && electron.ipcRenderer) {
      console.log("[IPC] Registering global shortcuts in Electron...", shortcuts);
      electron.ipcRenderer.send('register-global-shortcuts', shortcuts);
    }
  }, [shortcuts]);

  // Listen to Tray Action events from the native menu
  useEffect(() => {
    const handleTrayAction = (event: any, action: string) => {
      console.log(`[Tray Action] Received action: ${action}`);
      switch (action) {
        case 'show-pill':
          setIsPillVisible(true);
          setIsRetracted(false);
          break;
        case 'toggle-pill':
          setIsPillVisible(prev => !prev);
          break;
        case 'toggle-manager':
          setShowManager(prev => !prev);
          break;
        case 'toggle-search':
          setShowSearchComponent(prev => !prev);
          break;
        case 'toggle-settings':
          setShowSettings(prev => !prev);
          break;
        case 'show-settings':
          setIsPillVisible(true);
          setIsRetracted(false);
          setShowSearchComponent(false);
          setShowSettings(true);
          break;
        case 'show-all-references':
          setFloatingImages(prev => prev.map(i => ({ ...i, isCollapsed: false })));
          setFloatingNotes(prev => prev.map(n => ({ ...n, isCollapsed: false })));
          setFloatingSketches(prev => prev.map(s => ({ ...s, isCollapsed: false })));
          break;
        case 'hide-all-references':
          setFloatingImages(prev => prev.map(i => ({ ...i, isCollapsed: true })));
          setFloatingNotes(prev => prev.map(n => ({ ...n, isCollapsed: true })));
          setFloatingSketches(prev => prev.map(s => ({ ...s, isCollapsed: true })));
          break;
        case 'lock-all-references':
          setFloatingImages(prev => prev.map(i => ({ ...i, isLocked: true })));
          setFloatingNotes(prev => prev.map(n => ({ ...n, isLocked: true })));
          setFloatingSketches(prev => prev.map(s => ({ ...s, isLocked: true })));
          break;
        case 'unlock-all-references':
          setFloatingImages(prev => prev.map(i => ({ ...i, isLocked: false })));
          setFloatingNotes(prev => prev.map(n => ({ ...n, isLocked: false })));
          setFloatingSketches(prev => prev.map(s => ({ ...s, isLocked: false })));
          break;
        default:
          break;
      }
    };

    const electron = (window as any).require ? (window as any).require('electron') : null;
    if (electron && electron.ipcRenderer) {
      electron.ipcRenderer.on('tray-action', handleTrayAction);
    }

    return () => {
      if (electron && electron.ipcRenderer) {
        electron.ipcRenderer.removeListener('tray-action', handleTrayAction);
      }
    };
  }, []);

  // Listen to Global Shortcut triggers from the Electron main process
  useEffect(() => {
    const handleGlobalShortcutTrigger = (event: any, actionKey: string) => {
      console.log(`[Global Shortcut Trigger] Key: ${actionKey}`);
      executeShortcutAction(actionKey);
    };

    const electron = (window as any).require ? (window as any).require('electron') : null;
    if (electron && electron.ipcRenderer) {
      electron.ipcRenderer.on('global-shortcut-trigger', handleGlobalShortcutTrigger);
    }

    return () => {
      if (electron && electron.ipcRenderer) {
        electron.ipcRenderer.removeListener('global-shortcut-trigger', handleGlobalShortcutTrigger);
      }
    };
  }, [executeShortcutAction]);

  useEffect(() => {
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

      if (matchShortcut(shortcuts.minimize, e)) {
        executeShortcutAction('minimize');
      } else if (matchShortcut(shortcuts.manager, e)) {
        executeShortcutAction('manager');
      } else if (matchShortcut(shortcuts.settings, e)) {
        executeShortcutAction('settings');
      } else if (matchShortcut(shortcuts.newNote, e)) {
        executeShortcutAction('newNote');
      } else if (matchShortcut(shortcuts.newSketch, e)) {
        executeShortcutAction('newSketch');
      } else if (matchShortcut(shortcuts.closeApp, e)) {
        executeShortcutAction('closeApp');
      } else if (matchShortcut(shortcuts.flipBoards, e)) {
        executeShortcutAction('flipBoards');
      } else if (matchShortcut(shortcuts.toggleWindows, e)) {
        executeShortcutAction('toggleWindows');
      }
    };
    window.addEventListener('keydown', handleGlobalKeydown);
    
    const handleGlobalClick = () => {
       setSearchContextMenu(null);
       setFloatingContextMenu(null);
    };
    window.addEventListener('click', handleGlobalClick);

    return () => {
      window.removeEventListener('keydown', handleGlobalKeydown);
      window.removeEventListener('click', handleGlobalClick);
    };
  }, [shortcuts, projects, activeProjectId, floatingImages, floatingNotes, floatingSketches, position, pillDimensions, topWindowId, executeShortcutAction]);

  // Pre-cache context menu target file
  useEffect(() => {
    if (floatingContextMenu) {
      console.log(`[Context Menu] Pre-caching file for ID: ${floatingContextMenu.id}`);
      ensureTempLocalFile(floatingContextMenu.url, floatingContextMenu.id).then(path => {
        if (path) {
          console.log(`[Context Menu] Pre-cached successfully to: ${path}`);
          setContextMenuTempPath(path);
        }
      }).catch(err => {
        console.error(`[Context Menu] Failed to pre-cache file:`, err);
      });
    } else {
      setContextMenuTempPath('');
    }
  }, [floatingContextMenu]);

  // Centralized interaction state references and definitions
  const lastAppliedIgnoreRef = useRef<boolean | null>(null);

  const applyCentralizedIgnoreMouseEvents = useCallback((ignore: boolean, options?: any) => {
    if (lastAppliedIgnoreRef.current === ignore) return;
    lastAppliedIgnoreRef.current = ignore;
    console.log(`setIgnoreMouseEvents(${ignore})`);
    
    if ((window as any).electronAPI && (window as any).electronAPI.setIgnoreMouseEvents) {
      (window as any).electronAPI.setIgnoreMouseEvents(ignore, options);
    } else {
      const electron = (window as any).require ? (window as any).require('electron') : null;
      const ipcRenderer = electron ? electron.ipcRenderer : null;
      if (ipcRenderer) {
        try {
          ipcRenderer.send('set-ignore-mouse-events', ignore, options);
        } catch (e) {
          console.warn("[Interaction State] Failed to send set-ignore-mouse-events through ipcRenderer:", e);
        }
      }
    }
  }, []);

  const prevActivePanelsRef = useRef<Record<string, boolean>>({});
  const lastInteractiveRegionsPayloadRef = useRef('');

  // Effect to log opens and closes of panels
  useEffect(() => {
    const panels = {
      "Quick Reference Search": !!showSearchComponent,
      "Settings": !!showSettings,
      "Search Providers": !!showProviderSettings,
      "Project Manager": !!showManager,
      "Diagnostics Modal": !!showDiagnosticsModal,
      "Search Context Menu": !!searchContextMenu,
      "Floating Context Menu": !!floatingContextMenu,
      "Rename Board": !!editingProjectId,
      "Managing Project": !!managingProjectId,
      "Note Editing": Object.values(editingNotes).some(v => v)
    };

    for (const [name, isOpen] of Object.entries(panels)) {
      const wasOpen = !!prevActivePanelsRef.current[name];
      if (isOpen && !wasOpen) {
        console.log(`Panel opened: ${name}`);
      } else if (!isOpen && wasOpen) {
        console.log(`Panel closed: ${name}`);
      }
    }
    prevActivePanelsRef.current = panels;
  }, [
    showSearchComponent,
    showSettings,
    showProviderSettings,
    showManager,
    showDiagnosticsModal,
    searchContextMenu,
    floatingContextMenu,
    editingProjectId,
    managingProjectId,
    editingNotes
  ]);

  // Publish real interactive rectangles to the main process. The main process
  // polls the native cursor, so click-through can recover even when Chromium no
  // longer receives normal pointer events over a transparent desktop area.
  const interactiveWindowModeKey = [
    floatingImages.map(image => `i:${image.id}:${image.isLocked ? 1 : 0}:${image.isCollapsed ? 1 : 0}`).join(','),
    floatingNotes.map(note => `n:${note.id}:${note.isLocked ? 1 : 0}:${note.isCollapsed ? 1 : 0}`).join(','),
    floatingSketches.map(sketch => `s:${sketch.id}:${sketch.isLocked ? 1 : 0}:${sketch.isCollapsed ? 1 : 0}`).join(',')
  ].join('|');

  useEffect(() => {
    const isDragActive = !!(
      isDraggingPill || 
      draggingFloatingId || 
      draggingNoteId || 
      draggingSketchId || 
      resizingFloatingId || 
      resizingNoteId || 
      resizingSketchId || 
      isResizingPill
    );

    const electron = getElectron();
    const ipcRenderer = electron?.ipcRenderer;
    if (!ipcRenderer) return;

    let animationFrame = 0;
    const publishInteractiveRegions = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        if (isDragActive) {
          const payloadFingerprint = 'drag-active';
          if (payloadFingerprint !== lastInteractiveRegionsPayloadRef.current) {
            lastInteractiveRegionsPayloadRef.current = payloadFingerprint;
            ipcRenderer.send('update-interactive-regions', { regions: [], forceInteractive: true });
          }
          return;
        }
        const elements = Array.from(document.querySelectorAll<HTMLElement>('.pointer-events-auto, [data-native-interactive="true"]'));
        const regions: Array<{ x: number; y: number; width: number; height: number }> = [];
        const dragHandleSelector = '.floating-drag-handle, .floating-office-drag-handle, .floating-note-drag-handle, .floating-sketch-drag-handle';
        for (const element of elements) {
          const floatingWindow = element.closest<HTMLElement>('.floating-window');
          if (floatingWindow?.dataset.collapsed === 'true') continue;

          if (floatingWindow) {
            const dragHandle = element.closest<HTMLElement>(dragHandleSelector);
            const isWindowSurface = element === floatingWindow;
            const isDragHandleSurface = dragHandle === element;
            if (floatingWindow.dataset.clickThrough === 'true') {
              if (!isDragHandleSurface) continue;
            } else if (!isWindowSurface && !isDragHandleSurface) {
              // Child buttons and images are already covered by the window and
              // handle rectangles. Measuring every descendant scales badly on
              // boards with dozens of references.
              continue;
            }
          } else {
            const interactiveAncestor = element.parentElement?.closest<HTMLElement>('.pointer-events-auto, [data-native-interactive="true"]');
            if (interactiveAncestor) continue;
          }

          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
          const rect = element.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) continue;
          const left = Math.max(0, rect.left);
          const top = Math.max(0, rect.top);
          regions.push({
            x: Math.round(left),
            y: Math.round(top),
            width: Math.round(Math.min(window.innerWidth, rect.right) - left),
            height: Math.round(Math.min(window.innerHeight, rect.bottom) - top)
          });
        }

        const payloadFingerprint = `0:${regions.map(region => `${region.x},${region.y},${region.width},${region.height}`).join('|')}`;
        if (payloadFingerprint === lastInteractiveRegionsPayloadRef.current) return;
        lastInteractiveRegionsPayloadRef.current = payloadFingerprint;
        ipcRenderer.send('update-interactive-regions', { regions, forceInteractive: false });
      });
    };

    publishInteractiveRegions();
    const interval = window.setInterval(publishInteractiveRegions, 250);
    window.addEventListener('resize', publishInteractiveRegions);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearInterval(interval);
      window.removeEventListener('resize', publishInteractiveRegions);
    };
  }, [
    isDraggingPill, 
    draggingFloatingId, 
    draggingNoteId, 
    draggingSketchId, 
    resizingFloatingId, 
    resizingNoteId, 
    resizingSketchId, 
    isResizingPill,
    interactiveWindowModeKey,
    isPillVisible,
    isRetracted,
    showSearchComponent,
    showSettings,
    showProviderSettings,
    showManager,
    showDiagnosticsModal,
    searchContextMenu,
    floatingContextMenu,
    editingProjectId,
    managingProjectId
  ]);

  const handlePillResizeMouseDown = (e: React.MouseEvent, edge: WindowResizeEdge) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizingPill(true);
    resizePillStart.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      x: position.x,
      y: position.y,
      width: isRetracted ? retractedPillSize : pillDimensions.width,
      height: isRetracted ? retractedPillSize : pillDimensions.height,
      edge,
      retractedSize: retractedPillSize,
    };
  };

  const handlePillMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (!isRetracted && (e.target as HTMLElement).closest('button')) {
      return;
    }
    if ((e.target as HTMLElement).closest('.drag-handle')) {
      e.preventDefault();
      e.stopPropagation();
      pillDragActiveRef.current = true;
      pillDragMovedRef.current = false;
      pillDragOriginRef.current = { ...position };
      pillDragPositionRef.current = { ...position };
      pillFollowerOriginsRef.current = Array.from(document.querySelectorAll<HTMLElement>('[data-pill-position-follower="true"]')).map(element => {
        const rect = element.getBoundingClientRect();
        const inlineLeft = Number.parseFloat(element.style.left);
        const inlineTop = Number.parseFloat(element.style.top);
        return {
          element,
          left: Number.isFinite(inlineLeft) ? inlineLeft : rect.left,
          top: Number.isFinite(inlineTop) ? inlineTop : rect.top
        };
      });
      setIsDraggingPill(true);
      dragStartPos.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y
      };
    }
  };

  const prepareFloatingWindowSnap = (
    kind: FloatingWindowKind,
    id: string,
    fallbackWidth: number,
    fallbackBodyHeight: number
  ) => {
    const visibleRects: Array<{ kind: FloatingWindowKind; id: string; rect: WindowRect }> = [];
    const windowElements = Array.from(document.querySelectorAll<HTMLElement>('.floating-window[data-window-kind]'));

    windowElements.forEach(element => {
      const windowKind = element.dataset.windowKind;
      if (windowKind !== 'image' && windowKind !== 'note' && windowKind !== 'sketch') return;

      const rect = element.getBoundingClientRect();
      const toolbarHeight = getFloatingWindowToolbarHeight(windowKind);
      visibleRects.push({
        kind: windowKind,
        id: element.dataset.id || '',
        rect: {
          x: rect.left,
          y: rect.top - toolbarHeight,
          width: rect.width,
          height: rect.height + toolbarHeight
        }
      });
    });

    const toolbarHeight = getFloatingWindowToolbarHeight(kind);
    const movingRect = visibleRects.find(item => item.kind === kind && item.id === id)?.rect;
    const viewportBounds = [{ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }];

    dragFloatingGeometry.current = {
      width: movingRect?.width || fallbackWidth,
      height: movingRect?.height || fallbackBodyHeight + toolbarHeight,
      toolbarHeight,
      targets: visibleRects
        .filter(item => item.id && (item.kind !== kind || item.id !== id))
        .map(item => item.rect),
      bounds: displayLayout?.displays?.length
        ? displayLayout.displays.map(display => display.workArea)
        : viewportBounds
    };
    setWindowSnapGuides({});
  };

  const handleSketchMouseDown = (e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (!target.closest('.floating-sketch-drag-handle')) return;
    if (target.closest('button, input, textarea, select, a, [role="button"], [contenteditable="true"]')) return;
    const sketch = floatingSketches.find(s => s.id === id);
    if (!sketch || sketch.isLocked) return;

    e.preventDefault();
    e.stopPropagation();
    prepareFloatingWindowSnap('sketch', sketch.id, sketch.width, sketch.height);
    setTopWindowId(id);
    setDraggingSketchId(id);
    dragSketchOffset.current = {
      x: e.clientX - sketch.x,
      y: e.clientY - sketch.y
    };
    beginImperativeWindowMove('sketch', sketch.id, sketch.x, sketch.y);
  };

  const handleSketchResizeMouseDown = (e: React.MouseEvent, id: string, edge: WindowResizeEdge) => {
    if (e.button !== 0) return;
    const sketch = floatingSketches.find(s => s.id === id);
    if (!sketch || sketch.isLocked) return;

    e.preventDefault();
    e.stopPropagation();
    setResizingSketchId(id);
    setTopWindowId(id);
    resizeSketchStart.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      x: sketch.x,
      y: sketch.y,
      width: sketch.width,
      height: sketch.height,
      edge
    };
  };

  const beginFloatingImageWindowDrag = (clientX: number, clientY: number, img: FloatingImage) => {
    prepareFloatingWindowSnap(
      'image',
      img.id,
      img.width,
      img.height || (isOfficeDocument(img.type) ? OFFICE_DOCUMENT_DEFAULT_HEIGHT : FLOATING_MEDIA_FALLBACK_HEIGHT)
    );
    dragFloatingOffset.current = {
      x: clientX - img.x,
      y: clientY - img.y
    };
    beginImperativeWindowMove('image', img.id, img.x, img.y);
    setTopWindowId(img.id);
    setDraggingFloatingId(img.id);
  };

  const handleFloatingMouseDown = (e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (!target.closest('.floating-drag-handle, .floating-office-drag-handle')) return;
    if (target.closest('button, input, textarea, select, a, [role="button"], [contenteditable="true"], [data-window-drag-block="true"]')) return;

    const img = floatingImages.find(f => f.id === id);
    if (!img || img.isLocked) return;

    e.preventDefault();
    e.stopPropagation();
    beginFloatingImageWindowDrag(e.clientX, e.clientY, img);
  };

  const startFloatingImageDrag = (e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, .no-window-drag')) return;
    const img = floatingImages.find(f => f.id === id);
    if (!img || img.isLocked || (img.type || 'image') !== 'image') return;

    e.preventDefault();
    e.stopPropagation();
    beginFloatingImageWindowDrag(e.clientX, e.clientY, img);
  };

  const handleNoteMouseDown = (e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (!target.closest('.floating-note-drag-handle')) return;
    if (target.closest('button, input, textarea, select, a, [role="button"], [contenteditable="true"]')) return;
    const note = floatingNotes.find(n => n.id === id);
    if (!note || note.isLocked) return;

    e.preventDefault();
    e.stopPropagation();
    prepareFloatingWindowSnap('note', note.id, note.width, note.height);
    setTopWindowId(id);
    setDraggingNoteId(id);
    dragNoteOffset.current = {
      x: e.clientX - note.x,
      y: e.clientY - note.y
    };
    beginImperativeWindowMove('note', note.id, note.x, note.y);
  };

  const handleFloatingResizeMouseDown = (e: React.MouseEvent, id: string, edge: WindowResizeEdge) => {
    if (e.button !== 0) return;
    const img = floatingImages.find(f => f.id === id);
    if (!img || img.isLocked) return;

    e.preventDefault();
    e.stopPropagation();
    setResizingFloatingId(id);
    setTopWindowId(id);
    setWindowSnapGuides({});
    const windowRect = findFloatingWindowElement('image', id)?.getBoundingClientRect();
    resizeStart.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      x: img.x,
      y: img.y,
      width: img.width,
      height: img.height || windowRect?.height || (isOfficeDocument(img.type) ? OFFICE_DOCUMENT_DEFAULT_HEIGHT : FLOATING_MEDIA_FALLBACK_HEIGHT),
      edge
    };
  };

  const handleNoteResizeMouseDown = (e: React.MouseEvent, id: string, edge: WindowResizeEdge) => {
    if (e.button !== 0) return;
    const note = floatingNotes.find(n => n.id === id);
    if (!note || note.isLocked) return;

    e.preventDefault();
    e.stopPropagation();
    setResizingNoteId(id);
    setTopWindowId(id);
    resizeNoteStart.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      x: note.x,
      y: note.y,
      width: note.width,
      height: note.height,
      edge,
      lockAspectRatio: Boolean(note.lockAspectRatio)
    };
  };

  useEffect(() => {
    let latestMouseEvent: MouseEvent | null = null;
    let interactionFinished = false;

    const finishGlobalInteraction = () => {
      interactionFinished = true;
      // Save pill dimensions if they were changed.
      if (isResizingPill) {
        localStorage.setItem('ref-flow-pill-dim-vert', JSON.stringify(pillDimensions));
      }
      if (pillDragActiveRef.current) {
        const shouldExpandRetractedPill = isRetracted && !pillDragMovedRef.current;
        pillDragActiveRef.current = false;
        const nextPosition = clampPillToConnectedDisplay(pillDragPositionRef.current || pillDragOriginRef.current);
        previewImperativePillMove(nextPosition);
        setPosition(nextPosition);
        pillDragPositionRef.current = null;
        pillFollowerOriginsRef.current = [];
        if (shouldExpandRetractedPill) setIsRetracted(false);
      } else if (isResizingPill) {
        setPosition(current => clampPillToConnectedDisplay(current));
      }

      commitImperativeWindowMove();
      setIsResizingPill(false);
      setIsDraggingPill(false);
      setDraggingFloatingId(null);
      setResizingFloatingId(null);
      setWindowSnapGuides({});
      setDraggingNoteId(null);
      setResizingNoteId(null);
      setDraggingSketchId(null);
      setResizingSketchId(null);
      latestMouseEvent = null;
      ticking.current = false;
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
      // A mouse-up can be delivered to another app or display surface. The
      // buttons bitmask lets the next move recover instead of leaving a drag
      // permanently latched.
      if (e.buttons === 0) {
        finishGlobalInteraction();
        return;
      }
      latestMouseEvent = e;
      if (ticking.current) return;
      ticking.current = true;

      requestAnimationFrame(() => {
        ticking.current = false;
        if (interactionFinished) return;
        const moveEvent = latestMouseEvent || e;
        latestMouseEvent = null;

        if (isResizingPill) {
          const start = resizePillStart.current;
          if (isRetracted) {
            const resized = resizeWindowWithAspectRatio(start, moveEvent.clientX, moveEvent.clientY, 40, 40);
            const size = Math.min(96, Math.max(40, Math.round(resized.width)));
            const edge = start.edge;
            const fromLeft = edge.endsWith('left');
            const fromRight = edge.endsWith('right');
            const fromTop = edge.startsWith('top');
            const fromBottom = edge.startsWith('bottom');
            setRetractedPillSize(size);
            setPosition({
              x: fromLeft
                ? start.x + start.width - size
                : (fromRight ? start.x : start.x + (start.width - size) / 2),
              y: fromTop
                ? start.y + start.height - size
                : (fromBottom ? start.y : start.y + (start.height - size) / 2)
            });
          } else {
            const resized = resizeWindowFromEdge(start, moveEvent.clientX, moveEvent.clientY, 160, 200);
            setPillDimensions({ width: resized.width, height: resized.height });
            setPosition({ x: resized.x, y: resized.y });
          }
        }

        if (isDraggingPill && pillDragActiveRef.current) {
          const newX = moveEvent.clientX - dragStartPos.current.x;
          const newY = moveEvent.clientY - dragStartPos.current.y;
          if (Math.hypot(newX - pillDragOriginRef.current.x, newY - pillDragOriginRef.current.y) >= 4) {
            pillDragMovedRef.current = true;
          }
          previewImperativePillMove({ x: newX, y: newY });
        }

        const previewSnappedWindowMove = (rawX: number, rawY: number) => {
          const geometry = dragFloatingGeometry.current;
          const movingRect = {
            x: rawX,
            y: rawY - geometry.toolbarHeight,
            width: geometry.width,
            height: geometry.height
          };
          const snapped = moveEvent.altKey
            ? { ...movingRect, guideX: undefined, guideY: undefined }
            : snapWindowRect(
                movingRect,
                geometry.targets,
                geometry.bounds,
                FLOATING_WINDOW_SNAP_THRESHOLD,
                FLOATING_WINDOW_SNAP_GAP
              );
          const snappedY = snapped.y + geometry.toolbarHeight;
          setWindowSnapGuides(current => (
            current.x === snapped.guideX && current.y === snapped.guideY
              ? current
              : { x: snapped.guideX, y: snapped.guideY }
          ));
          previewImperativeWindowMove(snapped.x, snappedY);
        };

        if (draggingFloatingId) {
          const rawX = moveEvent.clientX - dragFloatingOffset.current.x;
          const rawY = moveEvent.clientY - dragFloatingOffset.current.y;
          previewSnappedWindowMove(rawX, rawY);
        }

        if (draggingNoteId) {
          const rawX = moveEvent.clientX - dragNoteOffset.current.x;
          const rawY = moveEvent.clientY - dragNoteOffset.current.y;
          previewSnappedWindowMove(rawX, rawY);
        }

        if (draggingSketchId) {
          const rawX = moveEvent.clientX - dragSketchOffset.current.x;
          const rawY = moveEvent.clientY - dragSketchOffset.current.y;
          previewSnappedWindowMove(rawX, rawY);
        }

        if (resizingFloatingId) {
          setFloatingImages(prev => prev.map(img => {
            if (img.id === resizingFloatingId) {
              const minimumWidth = isOfficeDocument(img.type) ? OFFICE_DOCUMENT_MIN_WIDTH : FLOATING_MEDIA_MIN_WIDTH;
              const minimumHeight = isOfficeDocument(img.type) ? OFFICE_DOCUMENT_MIN_HEIGHT : FLOATING_MEDIA_MIN_HEIGHT;
              return {
                ...img,
                ...resizeWindowFromEdge(resizeStart.current, moveEvent.clientX, moveEvent.clientY, minimumWidth, minimumHeight)
              };
            }
            return img;
          }));
        }

        if (resizingNoteId) {
          setFloatingNotes(prev => prev.map(note => {
            if (note.id === resizingNoteId) {
              // Shift temporarily switches the saved resize mode, so both
              // free and proportional sizing are always available.
              const keepAspectRatio = resizeNoteStart.current.lockAspectRatio !== moveEvent.shiftKey;
              return {
                ...note,
                ...(keepAspectRatio
                  ? resizeWindowWithAspectRatio(resizeNoteStart.current, moveEvent.clientX, moveEvent.clientY, FLOATING_NOTE_MIN_WIDTH, FLOATING_NOTE_MIN_HEIGHT)
                  : resizeWindowFromEdge(resizeNoteStart.current, moveEvent.clientX, moveEvent.clientY, FLOATING_NOTE_MIN_WIDTH, FLOATING_NOTE_MIN_HEIGHT))
              };
            }
            return note;
          }));
        }

        if (resizingSketchId) {
          setFloatingSketches(prev => prev.map(sketch => {
            if (sketch.id === resizingSketchId) {
              return {
                ...sketch,
                ...resizeWindowFromEdge(resizeSketchStart.current, moveEvent.clientX, moveEvent.clientY, 200, 200)
              };
            }
            return sketch;
          }));
        }
      });
    };
    const handleWindowMouseLeave = (event: MouseEvent) => {
      if (event.buttons === 0) finishGlobalInteraction();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) finishGlobalInteraction();
    };

    if (isResizingPill || isDraggingPill || draggingFloatingId || resizingFloatingId || draggingNoteId || resizingNoteId || draggingSketchId || resizingSketchId) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', finishGlobalInteraction);
      window.addEventListener('blur', finishGlobalInteraction);
      window.addEventListener('mouseleave', handleWindowMouseLeave);
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      interactionFinished = true;
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', finishGlobalInteraction);
      window.removeEventListener('blur', finishGlobalInteraction);
      window.removeEventListener('mouseleave', handleWindowMouseLeave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isResizingPill, isDraggingPill, draggingFloatingId, resizingFloatingId, draggingNoteId, resizingNoteId, draggingSketchId, resizingSketchId, pillDimensions, clampPillToConnectedDisplay, isRetracted, commitImperativeWindowMove, previewImperativeWindowMove, previewImperativePillMove]);

  // Handle Drag & Drop of Images
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    const handleGlobalDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(true);
    };

    const handleGlobalDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (!e.relatedTarget) {
        setIsDragOver(false);
      }
    };

    const handleGlobalDrop = async (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      
      const refUrl = e.dataTransfer?.getData('application/x-reference-url');
      if (refUrl && e.dataTransfer?.getData('text/plain')) {
        const urlParams = e.dataTransfer.getData('text/plain');
        fetchAndAddImage(urlParams);
        return;
      }
      
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        try {
          const files = Array.from(e.dataTransfer.files) as File[];
          await importMediaFiles(files, { x: e.clientX, y: e.clientY });
        } catch (error) {
          console.error("Failed to load media", error);
        }
      }
    };

    window.addEventListener('dragover', handleGlobalDragOver);
    window.addEventListener('dragleave', handleGlobalDragLeave);
    window.addEventListener('drop', handleGlobalDrop);

    return () => {
      window.removeEventListener('dragover', handleGlobalDragOver);
      window.removeEventListener('dragleave', handleGlobalDragLeave);
      window.removeEventListener('drop', handleGlobalDrop);
    };
  }, [position, pillDimensions]);

  const triggerNativeFilePicker = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = SUPPORTED_MEDIA_ACCEPT;
    input.multiple = true;
    input.onchange = async (e: any) => {
      if (e.target.files) {
        const files = Array.from(e.target.files) as File[];
        try {
          await importMediaFiles(files, getPrimaryWorkspaceOrigin());
        } catch (error) {
          console.error("Failed to load media", error);
        }
      }
    };
    input.click();
  };

  const removeImage = (idxToRemove: number) => {
    setImages(prev => prev.filter((_, idx) => idx !== idxToRemove));
  };

  const popOutImage = (idxToRemove: number) => {
    const url = images[idxToRemove];
    const newId = Math.random().toString(36).substr(2, 9);
    setFloatingImages(prev => [
      ...prev,
      {
        id: newId,
        url,
        fileName: getSourceFileName(url) || undefined,
        x: position.x + pillDimensions.width + 20,
        y: position.y,
        width: 300,
        opacity: 1,
        isLocked: false,
        rotation: 0,
        isCollapsed: true
      }
    ]);
  };

  const closeFloatingImage = (idToClose: string) => {
    setFloatingImages(prev => prev.map(img => img.id === idToClose ? { ...img, isCollapsed: true } : img));
  };

  const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  const restorePdfViewportPosition = (image: FloatingImage, persistClampedPosition = false) => {
    const viewport = pdfViewportRefs.current.get(image.id);
    if (!viewport || pdfPanSessionRef.current?.id === image.id) return;
    viewport.scrollLeft = Math.max(0, image.panX || 0);
    viewport.scrollTop = Math.max(0, image.panY || 0);
    if (!persistClampedPosition) return;

    const panX = viewport.scrollLeft;
    const panY = viewport.scrollTop;
    if (Math.abs(panX - (image.panX || 0)) < 0.5 && Math.abs(panY - (image.panY || 0)) < 0.5) return;
    setFloatingImages(prev => prev.map(item => item.id === image.id ? { ...item, panX, panY } : item));
  };

  const pdfViewportPositionKey = floatingImages
    .filter(image => image.type === 'pdf')
    .map(image => `${image.id}:${image.documentPage || 1}:${image.width}:${image.zoom || 1}:${image.panX || 0}:${image.panY || 0}`)
    .join('|');

  useEffect(() => {
    for (const image of floatingImages) {
      if (image.type === 'pdf') restorePdfViewportPosition(image);
    }
  }, [pdfViewportPositionKey]);

  const handlePdfWheelZoom = (event: React.WheelEvent<HTMLDivElement>, image: FloatingImage) => {
    event.preventDefault();
    event.stopPropagation();
    const viewport = event.currentTarget;
    const previousZoom = image.zoom || 1;
    const limitedDelta = clampNumber(event.deltaY, -120, 120);
    const rawZoom = clampNumber(previousZoom * Math.exp(-limitedDelta * 0.0025), 0.5, 5);
    const nextZoom = Math.round(rawZoom * 20) / 20;
    if (Math.abs(nextZoom - previousZoom) < 0.001) return;

    const bounds = viewport.getBoundingClientRect();
    const cursorX = event.clientX - bounds.left;
    const cursorY = event.clientY - bounds.top;
    const ratio = nextZoom / previousZoom;
    const panX = Math.max(0, ((viewport.scrollLeft + cursorX) * ratio) - cursorX);
    const panY = Math.max(0, ((viewport.scrollTop + cursorY) * ratio) - cursorY);

    setFloatingImages(prev => prev.map(item => item.id === image.id
      ? { ...item, zoom: nextZoom, panX, panY }
      : item));
    setTopWindowId(image.id);
  };

  const handlePdfPanPointerDown = (event: React.PointerEvent<HTMLDivElement>, image: FloatingImage) => {
    if (event.button !== 1) return;
    const viewport = event.currentTarget;
    if (viewport.scrollWidth <= viewport.clientWidth && viewport.scrollHeight <= viewport.clientHeight) return;
    event.preventDefault();
    event.stopPropagation();
    viewport.setPointerCapture(event.pointerId);
    pdfPanSessionRef.current = {
      id: image.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop
    };
    setTopWindowId(image.id);
  };

  const handlePdfPanPointerMove = (event: React.PointerEvent<HTMLDivElement>, id: string) => {
    const session = pdfPanSessionRef.current;
    if (!session || session.id !== id || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.scrollLeft = session.scrollLeft - (event.clientX - session.startX);
    event.currentTarget.scrollTop = session.scrollTop - (event.clientY - session.startY);
  };

  const endPdfPan = (event: React.PointerEvent<HTMLDivElement>, id: string) => {
    const session = pdfPanSessionRef.current;
    if (!session || session.id !== id || session.pointerId !== event.pointerId) return;
    const viewport = event.currentTarget;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    pdfPanSessionRef.current = null;
    const panX = viewport.scrollLeft;
    const panY = viewport.scrollTop;
    setFloatingImages(prev => prev.map(image => image.id === id ? { ...image, panX, panY } : image));
  };

  const handleImageWheelZoom = (event: React.WheelEvent<HTMLDivElement>, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    const viewport = event.currentTarget.getBoundingClientRect();
    const cursorFromCenterX = event.clientX - viewport.left - (viewport.width / 2);
    const cursorFromCenterY = event.clientY - viewport.top - (viewport.height / 2);
    const limitedDelta = clampNumber(event.deltaY, -120, 120);

    setFloatingImages(prev => prev.map(image => {
      if (image.id !== id) return image;
      const previousZoom = image.zoom || 1;
      const nextZoom = clampNumber(previousZoom * Math.exp(-limitedDelta * 0.0025), 0.5, 5);
      if (Math.abs(nextZoom - previousZoom) < 0.001) return image;
      if (nextZoom <= 1) {
        return { ...image, zoom: nextZoom, panX: 0, panY: 0 };
      }

      const ratio = nextZoom / previousZoom;
      const currentPanX = image.panX || 0;
      const currentPanY = image.panY || 0;
      const anchoredPanX = currentPanX + (1 - ratio) * (cursorFromCenterX - currentPanX);
      const anchoredPanY = currentPanY + (1 - ratio) * (cursorFromCenterY - currentPanY);
      const maxPanX = viewport.width * (nextZoom - 1) / 2;
      const maxPanY = viewport.height * (nextZoom - 1) / 2;
      return {
        ...image,
        zoom: nextZoom,
        panX: clampNumber(anchoredPanX, -maxPanX, maxPanX),
        panY: clampNumber(anchoredPanY, -maxPanY, maxPanY)
      };
    }));
  };

  const handleImagePanPointerDown = (event: React.PointerEvent<HTMLDivElement>, image: FloatingImage) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    if ((image.zoom || 1) <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    imagePanSessionRef.current = { id: image.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setTopWindowId(image.id);
  };

  const handleImagePanPointerMove = (event: React.PointerEvent<HTMLDivElement>, id: string) => {
    const session = imagePanSessionRef.current;
    if (!session || session.id !== id || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const deltaX = event.clientX - session.x;
    const deltaY = event.clientY - session.y;
    session.x = event.clientX;
    session.y = event.clientY;
    const viewport = event.currentTarget.getBoundingClientRect();

    setFloatingImages(prev => prev.map(image => {
      if (image.id !== id) return image;
      const zoom = image.zoom || 1;
      const maxPanX = Math.max(0, viewport.width * (zoom - 1) / 2);
      const maxPanY = Math.max(0, viewport.height * (zoom - 1) / 2);
      return {
        ...image,
        panX: clampNumber((image.panX || 0) + deltaX, -maxPanX, maxPanX),
        panY: clampNumber((image.panY || 0) + deltaY, -maxPanY, maxPanY)
      };
    }));
  };

  const endImagePan = (event: React.PointerEvent<HTMLDivElement>, id: string) => {
    const session = imagePanSessionRef.current;
    if (!session || session.id !== id || session.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    imagePanSessionRef.current = null;
  };

  const getAnnotationPoint = (svg: SVGSVGElement, clientX: number, clientY: number): ImageAnnotationPoint | null => {
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const localPoint = point.matrixTransform(matrix.inverse());
    return {
      x: clampNumber(localPoint.x, 0, 1000),
      y: clampNumber(localPoint.y, 0, 1000)
    };
  };

  const startImageAnnotation = (event: React.PointerEvent<SVGSVGElement>, id: string) => {
    if (event.button !== 0) return;
    const point = getAnnotationPoint(event.currentTarget, event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const targetImage = floatingImages.find(image => image.id === id);
    const pageKey = targetImage?.type === 'pdf' ? getAnnotationPageKey(targetImage) : undefined;
    annotationSessionRef.current = { id, pointerId: event.pointerId, pageKey };
    const color = annotationColors[id] || '#ff3b30';
    setFloatingImages(prev => prev.map(image => image.id === id
      ? replaceVisibleAnnotations(
          image,
          [...getVisibleAnnotations(image, pageKey), { color, width: 8, points: [point] }],
          pageKey
        )
      : image));
  };

  const continueImageAnnotation = (event: React.PointerEvent<SVGSVGElement>, id: string) => {
    const session = annotationSessionRef.current;
    if (!session || session.id !== id || session.pointerId !== event.pointerId) return;
    const coalescedEvents = typeof event.nativeEvent.getCoalescedEvents === 'function'
      ? event.nativeEvent.getCoalescedEvents()
      : [event.nativeEvent];
    const points = coalescedEvents
      .map(pointerEvent => getAnnotationPoint(event.currentTarget, pointerEvent.clientX, pointerEvent.clientY))
      .filter((point): point is ImageAnnotationPoint => point !== null);
    if (points.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    setFloatingImages(prev => prev.map(image => {
      if (image.id !== id) return image;
      const annotations = [...getVisibleAnnotations(image, session.pageKey)];
      if (annotations.length === 0) return image;
      const lastStroke = annotations[annotations.length - 1];
      const nextPoints = [...lastStroke.points];
      for (const point of points) {
        const previousPoint = nextPoints[nextPoints.length - 1];
        if (!previousPoint || Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) >= 0.75) {
          nextPoints.push(point);
        }
      }
      if (nextPoints.length === lastStroke.points.length) return image;
      annotations[annotations.length - 1] = { ...lastStroke, points: nextPoints };
      return replaceVisibleAnnotations(image, annotations, session.pageKey);
    }));
  };

  const endImageAnnotation = (event: React.PointerEvent<SVGSVGElement>, id: string) => {
    const session = annotationSessionRef.current;
    if (!session || session.id !== id || session.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    annotationSessionRef.current = null;
  };

  const createSketch = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    const origin = getPrimaryWorkspaceOrigin();
    setFloatingSketches(prev => [
      ...prev,
      {
        id: newId,
        name: `Sketch ${floatingSketches.length + 1}`,
        lines: [],
        x: origin.x,
        y: origin.y + 200,
        width: 300,
        height: 300,
        backgroundColor: '#ffffff',
        isCollapsed: false
      }
    ]);
    setTopWindowId(newId);
  };

  const closeSketch = (idToClose: string) => {
    setFloatingSketches(prev => prev.map(s => s.id === idToClose ? { ...s, isCollapsed: true } : s));
  };

  const createNote = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    const origin = getPrimaryWorkspaceOrigin();
    setFloatingNotes(prev => [
      ...prev,
      {
        id: newId,
        name: `Note ${floatingNotes.length + 1}`,
        text: '',
        x: origin.x,
        y: origin.y + 100,
        width: 320,
        height: 150,
        color: '#fef3c7',
        isCollapsed: false
      }
    ]);
    setTopWindowId(newId);
  };

  const closeNote = (idToClose: string) => {
    setFloatingNotes(prev => prev.map(n => n.id === idToClose ? { ...n, isCollapsed: true } : n));
  };

  const updateNoteText = (id: string, text: string) => {
    setFloatingNotes(prev => prev.map(n => n.id === id ? { ...n, text } : n));
  };

  const extractPaletteForImage = async (id: string, url: string) => {
    const palette = await extractPalette(url);
    if (palette.length > 0) {
      setFloatingImages(prev => prev.map(img => img.id === id ? { ...img, palette } : img));
    }
  };

  const beginProjectRename = (project: Project, surface: 'card' | 'sidebar' = 'card') => {
    setEditingProjectId(project.id);
    setEditingProjectSurface(surface);
    setEditingProjectName(project.name || 'Untitled Board');
  };

  const commitProjectRename = async (project: Project) => {
    if (editingProjectId !== project.id) return;
    const nextName = editingProjectName.trim() || 'Untitled Board';
    await updateProject(project.id, { name: nextName });
    if (project.directoryPath) {
      await syncBoardToPath({ ...project, name: nextName }, project.directoryPath);
    }
    setProjects(await getProjects());
    setEditingProjectId(null);
    setEditingProjectSurface(null);
    setEditingProjectName('');
  };

  const beginMediaRename = (media: FloatingImage, projectId: string | null = null) => {
    setEditingMediaId(media.id);
    setEditingMediaProjectId(projectId);
    setEditingMediaName(getMediaDisplayName(media));
  };

  const cancelMediaRename = () => {
    setEditingMediaId(null);
    setEditingMediaProjectId(null);
    setEditingMediaName('');
  };

  const commitMediaRename = async (media: FloatingImage, project: Project | null = null) => {
    const expectedProjectId = project?.id || null;
    if (editingMediaId !== media.id || editingMediaProjectId !== expectedProjectId) return;
    const nextName = editingMediaName.trim() || getMediaDisplayName(media);

    if (project) {
      const updatedMedia = (project.floatingImages || []).map(item => item.id === media.id ? { ...item, fileName: nextName } : item);
      await updateProject(project.id, { floatingImages: updatedMedia });
      if (project.directoryPath) {
        await syncBoardToPath({ ...project, floatingImages: updatedMedia }, project.directoryPath);
      }
      setProjects(await getProjects());
      if (project.id === activeProjectId) setFloatingImages(updatedMedia);
    } else {
      setFloatingImages(current => current.map(item => item.id === media.id ? { ...item, fileName: nextName } : item));
    }

    cancelMediaRename();
  };

  const beginCanvasItemRename = (
    kind: 'note' | 'sketch',
    id: string,
    name: string,
    projectId: string | null = null
  ) => {
    setEditingCanvasItem({ kind, id, projectId, name });
  };

  const cancelCanvasItemRename = () => setEditingCanvasItem(null);

  const commitCanvasItemRename = async (
    kind: 'note' | 'sketch',
    item: FloatingNote | FloatingSketch,
    project: Project | null = null
  ) => {
    const expectedProjectId = project?.id || null;
    if (!editingCanvasItem
      || editingCanvasItem.kind !== kind
      || editingCanvasItem.id !== item.id
      || editingCanvasItem.projectId !== expectedProjectId) return;

    const fallbackName = kind === 'note'
      ? getNoteDisplayName(item as FloatingNote)
      : getSketchDisplayName(item as FloatingSketch);
    const nextName = editingCanvasItem.name.trim() || fallbackName;

    if (kind === 'note') {
      if (project) {
        const updatedNotes = (project.floatingNotes || []).map(note => note.id === item.id ? { ...note, name: nextName } : note);
        await updateProject(project.id, { floatingNotes: updatedNotes });
        if (project.directoryPath) {
          await syncBoardToPath({ ...project, floatingNotes: updatedNotes }, project.directoryPath);
        }
        setProjects(await getProjects());
        if (project.id === activeProjectId) setFloatingNotes(updatedNotes);
      } else {
        setFloatingNotes(current => current.map(note => note.id === item.id ? { ...note, name: nextName } : note));
      }
    } else if (project) {
      const updatedSketches = (project.floatingSketches || []).map(sketch => sketch.id === item.id ? { ...sketch, name: nextName } : sketch);
      await updateProject(project.id, { floatingSketches: updatedSketches });
      if (project.directoryPath) {
        await syncBoardToPath({ ...project, floatingSketches: updatedSketches }, project.directoryPath);
      }
      setProjects(await getProjects());
      if (project.id === activeProjectId) setFloatingSketches(updatedSketches);
    } else {
      setFloatingSketches(current => current.map(sketch => sketch.id === item.id ? { ...sketch, name: nextName } : sketch));
    }

    cancelCanvasItemRename();
  };

  const createNewProjectBoard = async () => {
    const project = await createProject(`Board ${projects.length + 1}`);
    let createdProject = project;
    const autosaveRoot = defaultAutosaveRoot || await getInstalledAutosaveRoot();
    if (autosaveRoot) {
      setDefaultAutosaveRoot(autosaveRoot);
      const nodeRequire = getNodeRequire();
      const path = nodeRequire ? nodeRequire('path') : null;
      const directoryPath = path ? path.join(autosaveRoot, getProjectFolderName(project)) : '';
      if (directoryPath) {
        createdProject = { ...project, directoryPath };
        await updateProject(project.id, { directoryPath });
        await syncBoardToPath(createdProject, directoryPath);
      }
    }
    const allProjects = await getProjects();
    setProjects(allProjects);
    setActiveProjectIdState(project.id);
    await setActiveProjectId(project.id);
    setImages([]);
    setFloatingImages([]);
    setFloatingNotes([]);
    setFloatingSketches([]);
  };

  const openProjectManager = () => {
    setShowManager(true);
    setIsRetracted(true);
    setFloatingImages(prev => prev.map(img => ({ ...img, isCollapsed: true })));
    setFloatingNotes(prev => prev.map(note => ({ ...note, isCollapsed: true })));
    setFloatingSketches(prev => prev.map(sketch => ({ ...sketch, isCollapsed: true })));
  };

  const emptyBoardBounds = displayLayout?.primary;
  const managerBounds = displayLayout?.primary;
  const visibleReferenceCount = floatingImages.filter(image => !image.isCollapsed).length
    + floatingNotes.filter(note => !note.isCollapsed).length
    + floatingSketches.filter(sketch => !sketch.isCollapsed).length;
  const totalReferenceCount = floatingImages.length + floatingNotes.length + floatingSketches.length;
  const pillPreviewColumnCount = pillDimensions.width >= 520
    ? 4
    : pillDimensions.width >= 360
      ? 3
      : pillDimensions.width >= 200
        ? 2
        : 1;
  const reduceLargeBoardEffects = visibleReferenceCount >= 12;

  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={150}>
    <div className={`w-screen h-screen overflow-hidden pointer-events-none relative ${reduceLargeBoardEffects ? 'large-board-performance' : ''}`} style={{ WebkitAppRegion: 'no-drag' } as any}>
      {(draggingFloatingId || draggingNoteId || draggingSketchId) && windowSnapGuides.x !== undefined && (
        <div
          data-window-snap-guide="x"
          className="absolute inset-y-0 z-[89990] w-px bg-sky-400/90 shadow-[0_0_8px_rgba(56,189,248,0.9)] pointer-events-none"
          style={{ left: windowSnapGuides.x }}
        />
      )}
      {(draggingFloatingId || draggingNoteId || draggingSketchId) && windowSnapGuides.y !== undefined && (
        <div
          data-window-snap-guide="y"
          className="absolute inset-x-0 z-[89990] h-px bg-sky-400/90 shadow-[0_0_8px_rgba(56,189,248,0.9)] pointer-events-none"
          style={{ top: windowSnapGuides.y }}
        />
      )}

      {/* Global Drag Overlay to prevent mouse events being swallowed by canvas/iframes/pill while dragging */}
      {(isDraggingPill || draggingFloatingId || draggingNoteId || draggingSketchId || resizingFloatingId || resizingNoteId || resizingSketchId || isResizingPill) && (
        <div className={`absolute inset-0 z-[100000] pointer-events-auto ${
          resizingFloatingId
            ? getWindowResizeCursorClass(resizeStart.current.edge)
            : resizingNoteId
              ? getWindowResizeCursorClass(resizeNoteStart.current.edge)
              : resizingSketchId
                ? getWindowResizeCursorClass(resizeSketchStart.current.edge)
                : isResizingPill
                  ? getWindowResizeCursorClass(resizePillStart.current.edge)
                  : 'cursor-move'
        }`} />
      )}

      {!isLoading && !hasAnyWorkspaceContent && !isEmptyBoardPromptDismissed && !showManager && !showSearchComponent && !showSettings && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`absolute z-10 flex items-center justify-center px-6 pointer-events-none ${emptyBoardBounds ? '' : 'inset-0'}`}
          style={emptyBoardBounds ? {
            left: emptyBoardBounds.x,
            top: emptyBoardBounds.y,
            width: emptyBoardBounds.width,
            height: emptyBoardBounds.height
          } : undefined}
        >
          <div
            className="rf-panel pointer-events-auto relative w-full max-w-2xl overflow-hidden rounded-3xl p-8"
            data-empty-board-prompt
          >
            <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/10 blur-3xl" />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setIsEmptyBoardPromptDismissed(true)}
              className="absolute right-4 top-4 z-10 text-muted-foreground"
              title="Close start board menu"
              aria-label="Close start board menu"
            >
              <X className="h-4 w-4" />
            </Button>
            <div className="relative flex items-start gap-5 pr-8">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/14 text-primary shadow-[0_10px_30px_rgba(94,107,255,0.18)]">
                <Sparkles className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="rf-kicker mb-2 text-primary">Your visual workspace</div>
                <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.025em] text-foreground">Start a reference board</h2>
                <p className="mt-2 max-w-lg text-sm leading-6 text-secondary">
                  Bring images, PDFs, Word documents, spreadsheets, notes, and sketches together in one focused canvas.
                </p>
              </div>
            </div>
            <div className="relative mt-7 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <Button onClick={triggerNativeFilePicker} variant="primary" size="lg" className="w-full">
                <Plus className="w-4 h-4" /> Add media
              </Button>
              <Button onClick={createNote} variant="secondary" size="lg" className="w-full">
                <FileText className="w-4 h-4" /> New note
              </Button>
              <Button onClick={createSketch} variant="secondary" size="lg" className="w-full">
                <PenTool className="w-4 h-4" /> Sketch
              </Button>
            </div>
            <p className="relative mt-4 text-center text-xs text-muted-foreground">You can also drop supported files anywhere on the desktop.</p>
          </div>
        </motion.div>
      )}

      {/* 
        ============================================================
        THE FLOATING PILL UI
        ============================================================
      */}
      <AnimatePresence initial={false}>
      {isPillVisible && (
        <motion.div 
          ref={pillElementRef}
          initial={{ opacity: 0, scale: 0.92, y: 10 }}
          animate={{
            width: isRetracted ? retractedPillSize : pillDimensions.width,
            height: isRetracted ? retractedPillSize : pillDimensions.height,
            opacity: 1,
            scale: 1,
            y: 0,
          }}
          exit={{ opacity: 0, scale: 0.92, y: 8 }}
          transition={isResizingPill ? { duration: 0 } : { type: "tween", duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="absolute floating-window floating-pill pill-shell pointer-events-auto"
          data-id="pill"
          data-pill-drag-rendering="imperative"
          style={{
            left: position.x,
            top: position.y,
            zIndex: 90000,
            contain: 'layout style',
            willChange: 'width, height, opacity, transform',
          }}
        >
          <div 
             className={`rf-panel relative h-full w-full overflow-hidden pointer-events-auto ${isDragOver ? 'ring-2 ring-primary shadow-[0_0_42px_rgba(94,107,255,0.42)]' : ''} ${isRetracted ? 'drag-handle flex cursor-move items-center justify-center rounded-full' : 'group flex flex-col items-center rounded-3xl p-2'}`}
             style={{ transition: 'border-radius 180ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 180ms ease, background-color 180ms ease' }}
             onMouseDown={handlePillMouseDown}
          >
            <AnimatePresence initial={false}>
              {isRetracted ? (
                  <motion.div 
                    key="retracted"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.12 }}
                    className="drag-handle group flex h-full w-full cursor-move items-center justify-center rounded-full bg-[radial-gradient(circle_at_35%_28%,rgba(94,107,255,0.2),transparent_58%)] transition-colors hover:bg-primary/10"
                    title="Drag pill"
                  >
                    <button 
                      onClick={() => {
                        if (pillDragMovedRef.current) {
                          pillDragMovedRef.current = false;
                          return;
                        }
                        setIsRetracted(false);
                      }}
                      className="pointer-events-auto flex cursor-move items-center justify-center rounded-full border border-transparent text-primary transition-all duration-200 hover:scale-105 hover:border-primary/20 hover:bg-primary/12 hover:text-foreground active:scale-95"
                      style={{ width: Math.max(32, retractedPillSize - 8), height: Math.max(32, retractedPillSize - 8) }}
                      title="Expand Pill"
                      aria-label="Expand Pill"
                    >
                      <Sparkles className="pointer-events-none size-4" />
                    </button>
                  </motion.div>
              ) : (
                <motion.div 
                  key="expanded"
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }} 
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14, delay: 0.04 }}
                  className="w-full h-full flex flex-col relative"
                >
                  {/* Compact brand header doubles as the reliable drag surface. */}
                  <div className="drag-handle flex h-11 w-full shrink-0 cursor-move items-center gap-2 rounded-2xl px-2">
                    <div className="pointer-events-none flex min-w-0 flex-1 items-center" data-expanded-pill-brand>
                      <div className="min-w-0 leading-none">
                        <div className="truncate text-[11px] font-semibold tracking-[-0.01em] text-foreground">RefFlow</div>
                        <div className="mt-1 truncate text-[9px] text-muted-foreground">{totalReferenceCount} {totalReferenceCount === 1 ? 'reference' : 'references'}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5" onMouseDown={(event) => event.stopPropagation()}>
                      <ToolbarButton
                        label="Quick Minimize / Restore All"
                        tooltipSide="bottom"
                        onClick={() => {
                          const allCollapsed = floatingNotes.every(n => n.isCollapsed) && floatingImages.every(i => i.isCollapsed) && floatingSketches.every(s => s.isCollapsed);
                          setFloatingNotes(prev => prev.map(n => ({...n, isCollapsed: !allCollapsed})));
                          setFloatingImages(prev => prev.map(i => ({...i, isCollapsed: !allCollapsed})));
                          setFloatingSketches(prev => prev.map(s => ({...s, isCollapsed: !allCollapsed})));
                        }}
                      >
                        <EyeOff className="size-3.5" />
                      </ToolbarButton>
                      <ToolbarButton
                        label="Retract"
                        tooltipSide="bottom"
                        onClick={() => setIsRetracted(true)}
                      >
                        <ChevronLeft className="size-3.5" />
                      </ToolbarButton>
                      <ToolbarButton
                        label="Close Control Pill (Hides to Tray)"
                        danger
                        tooltipSide="bottom"
                        onClick={() => setIsPillVisible(false)}
                      >
                        <X className="size-3.5" />
                      </ToolbarButton>
                    </div>
                  </div>

                 {/* The Image Viewer / List */}
                 <div 
                    className="pill-preview-grid grid min-h-0 w-full flex-1 content-start items-start gap-3 overflow-y-auto overflow-x-hidden px-1 py-2"
                    style={{
                      gridTemplateColumns: `repeat(${pillPreviewColumnCount}, minmax(0, 1fr))`,
                      gridAutoRows: 'max-content'
                    }}
                    data-pill-preview-columns={pillPreviewColumnCount}
                 >
                   {!isPillContentReady ? (
                     <div
                       className="pointer-events-none col-span-full grid gap-3 py-2"
                       style={{ gridTemplateColumns: `repeat(${pillPreviewColumnCount}, minmax(0, 1fr))` }}
                       aria-hidden="true"
                     >
                       <Skeleton className="aspect-square" />
                       <Skeleton className="aspect-square opacity-70" />
                       <Skeleton className="aspect-square opacity-50" />
                     </div>
                   ) : floatingImages.length === 0 && floatingNotes.length === 0 && floatingSketches.length === 0 ? (
                     <div className="drag-handle col-span-full flex min-h-40 w-full cursor-move flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-elevated/35 px-4 py-6 text-center">
                       <div className="mb-3 flex size-9 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                         <Plus className="size-4" />
                       </div>
                       <div className="text-[11px] font-medium text-secondary">Drop references here</div>
                       <div className="mt-1 text-[9px] leading-4 text-muted-foreground">Images, documents, notes, and sketches</div>
                     </div>
                   ) : (
                     <>
                       {floatingImages.map((img, mediaIndex) => {
                         const previewType = img.type || 'image';
                         const mediaLabel = getMediaDisplayName(img, mediaIndex);
                         return (
                           <div
                             key={img.id}
                             className={`rf-card rf-preview-card relative group aspect-square w-full min-w-0 self-start cursor-pointer overflow-hidden flex items-center justify-center ${img.isCollapsed ? 'border-dashed' : 'hover:border-primary/60 hover:-translate-y-0.5'}`}
                             data-pill-preview-card
                             data-pill-preview-type={previewType}
                             data-pill-label={mediaLabel}
                             title={mediaLabel}
                             onClick={() => {
                               setFloatingImages(prev => prev.map(f => f.id === img.id ? { ...f, isCollapsed: false } : f));
                               setTopWindowId(img.id);
                             }}
                           >
                             {img.type === 'pdf' ? (
                               <PillPdfPreview media={img} />
                             ) : isOfficeDocument(img.type) ? (
                               <PillOfficePreview media={img} />
                             ) : (
                               <img
                                 src={img.url}
                                 className="w-full h-full object-cover"
                                 alt={`${mediaLabel} preview`}
                                 loading="lazy"
                                 decoding="async"
                                 draggable={false}
                               />
                             )}
                             <div
                               className="pill-preview-caption"
                               onMouseDown={(event) => event.stopPropagation()}
                               onClick={(event) => event.stopPropagation()}
                             >
                               {editingMediaId === img.id && editingMediaProjectId === null ? (
                                 <input
                                   autoFocus
                                   value={editingMediaName}
                                   onChange={(event) => setEditingMediaName(event.target.value)}
                                   onBlur={() => { void commitMediaRename(img); }}
                                   onKeyDown={(event) => {
                                     event.stopPropagation();
                                     if (event.key === 'Enter') event.currentTarget.blur();
                                     if (event.key === 'Escape') cancelMediaRename();
                                   }}
                                   className="h-5 w-full rounded-md border border-white/20 bg-black/25 px-1.5 text-center text-[8px] font-medium text-white outline-none focus:border-primary"
                                   aria-label={`Rename ${mediaLabel}`}
                                   data-pill-media-name-input
                                 />
                               ) : (
                                 <button
                                   type="button"
                                   className="block w-full truncate rounded text-[8px] font-medium text-white/95 outline-none transition-colors hover:text-primary focus-visible:text-primary"
                                   onClick={() => beginMediaRename(img)}
                                   title="Click to rename reference"
                                   data-pill-media-name
                                 >
                                   {mediaLabel}
                                 </button>
                               )}
                             </div>
                             {img.isCollapsed && (
                               <div className="pointer-events-none absolute left-1.5 top-1.5 z-20 rounded-md border border-primary/30 bg-primary/90 px-1 py-0.5 text-[6px] font-semibold uppercase tracking-wide text-white">Hidden</div>
                             )}
                             <div className="absolute top-1 right-1 z-30 opacity-0 group-hover:opacity-100 transition-opacity flex space-x-1">
                               <button
                                 onClick={(e) => { e.stopPropagation(); setFloatingImages(prev => prev.filter(f => f.id !== img.id)); }}
                                 className="rounded-lg border border-white/10 bg-black/65 p-1.5 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-danger"
                                 title="Delete Permanently"
                               >
                                 <Trash2 className="w-3 h-3" />
                               </button>
                             </div>
                           </div>
                         );
                       })}

                       {floatingNotes.map((note, noteIndex) => {
                         const noteLabel = getNoteDisplayName(note, noteIndex);
                         const notePreview = note.text.replace(/\s+/g, ' ').trim();
                         return (
                           <div
                             key={note.id}
                             className={`rf-card rf-preview-card relative group aspect-square w-full min-w-0 self-start cursor-pointer overflow-hidden ${note.isCollapsed ? 'border-dashed' : 'hover:border-primary/60 hover:-translate-y-0.5'}`}
                             style={{ backgroundColor: note.color || '#fef3c7' }}
                             data-pill-preview-card
                             data-pill-preview-type="note"
                             data-pill-label={noteLabel}
                             title={notePreview ? `${noteLabel}: ${notePreview}` : noteLabel}
                             onClick={() => {
                               setFloatingNotes(prev => prev.map(f => f.id === note.id ? { ...f, isCollapsed: false } : f));
                               setTopWindowId(note.id);
                             }}
                           >
                             <div className="h-full w-full overflow-hidden px-2 pb-6 pt-2 text-left text-[7px] font-medium leading-[9px] text-slate-800">
                               {notePreview || (
                                 <div className="flex h-full flex-col items-center justify-center gap-1 text-slate-500">
                                   <FileText className="h-5 w-5" />
                                   <span>Empty note</span>
                                 </div>
                               )}
                             </div>
                             <div
                               className="pill-preview-caption"
                               onMouseDown={(event) => event.stopPropagation()}
                               onClick={(event) => event.stopPropagation()}
                             >
                               {editingCanvasItem?.kind === 'note' && editingCanvasItem.id === note.id && editingCanvasItem.projectId === null ? (
                                 <input
                                   autoFocus
                                   value={editingCanvasItem.name}
                                   onChange={(event) => setEditingCanvasItem(current => current ? { ...current, name: event.target.value } : current)}
                                   onBlur={() => { void commitCanvasItemRename('note', note); }}
                                   onKeyDown={(event) => {
                                     event.stopPropagation();
                                     if (event.key === 'Enter') event.currentTarget.blur();
                                     if (event.key === 'Escape') cancelCanvasItemRename();
                                   }}
                                   className="h-5 w-full rounded-md border border-white/20 bg-black/25 px-1.5 text-center text-[8px] font-medium text-white outline-none focus:border-primary"
                                   aria-label={`Rename ${noteLabel}`}
                                   data-pill-note-name-input
                                 />
                               ) : (
                                 <button
                                   type="button"
                                   className="block w-full truncate rounded text-[8px] font-medium text-white/95 outline-none transition-colors hover:text-primary focus-visible:text-primary"
                                   onClick={() => beginCanvasItemRename('note', note.id, noteLabel)}
                                   title="Click to rename note"
                                   data-pill-note-name
                                 >
                                   {noteLabel}
                                 </button>
                               )}
                             </div>
                             {note.isCollapsed && (
                               <div className="pointer-events-none absolute left-1.5 top-1.5 z-20 rounded-md border border-primary/30 bg-primary/90 px-1 py-0.5 text-[6px] font-semibold uppercase tracking-wide text-white">Hidden</div>
                             )}
                             <div className="absolute top-1 right-1 z-30 opacity-0 group-hover:opacity-100 transition-opacity flex space-x-1">
                               <button
                                 onClick={(e) => { e.stopPropagation(); setFloatingNotes(prev => prev.filter(f => f.id !== note.id)); }}
                                 className="rounded-lg border border-white/10 bg-black/65 p-1.5 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-danger"
                                 title="Delete Permanently"
                               >
                                 <Trash2 className="w-3 h-3" />
                               </button>
                             </div>
                           </div>
                         );
                       })}

                       {floatingSketches.map((sketch, sketchIndex) => {
                         const sketchLabel = getSketchDisplayName(sketch, sketchIndex);
                         return (
                           <div
                             key={sketch.id}
                             className={`rf-card rf-preview-card relative group aspect-square w-full min-w-0 self-start cursor-pointer overflow-hidden flex items-center justify-center ${sketch.isCollapsed ? 'border-dashed' : 'hover:border-primary/60 hover:-translate-y-0.5'}`}
                             data-pill-preview-card
                             data-pill-preview-type="sketch"
                             data-pill-label={sketchLabel}
                             title={sketchLabel}
                             onClick={() => {
                               setFloatingSketches(prev => prev.map(f => f.id === sketch.id ? { ...f, isCollapsed: false } : f));
                               setTopWindowId(sketch.id);
                             }}
                           >
                             <svg
                               viewBox={`0 0 ${Math.max(1, sketch.width)} ${Math.max(1, sketch.height)}`}
                               preserveAspectRatio="xMidYMid meet"
                               className="h-full w-full pb-5"
                               style={{ backgroundColor: sketch.backgroundColor }}
                               aria-label={`${sketchLabel} preview`}
                             >
                               {sketch.lines.map((line, lineIndex) => line.points.length === 1 ? (
                                 <circle
                                   key={lineIndex}
                                   cx={line.points[0].x}
                                   cy={line.points[0].y}
                                   r={line.width / 2}
                                   fill={line.isEraser ? sketch.backgroundColor : line.color}
                                 />
                               ) : (
                                 <path
                                   key={lineIndex}
                                   d={getSmoothStrokePath(line.points)}
                                   fill="none"
                                   stroke={line.isEraser ? sketch.backgroundColor : line.color}
                                   strokeWidth={line.width}
                                   strokeLinecap="round"
                                   strokeLinejoin="round"
                                 />
                               ))}
                             </svg>
                             {sketch.lines.length === 0 && <PenTool className="absolute h-5 w-5 text-primary" />}
                             <div
                               className="pill-preview-caption"
                               onMouseDown={(event) => event.stopPropagation()}
                               onClick={(event) => event.stopPropagation()}
                             >
                               {editingCanvasItem?.kind === 'sketch' && editingCanvasItem.id === sketch.id && editingCanvasItem.projectId === null ? (
                                 <input
                                   autoFocus
                                   value={editingCanvasItem.name}
                                   onChange={(event) => setEditingCanvasItem(current => current ? { ...current, name: event.target.value } : current)}
                                   onBlur={() => { void commitCanvasItemRename('sketch', sketch); }}
                                   onKeyDown={(event) => {
                                     event.stopPropagation();
                                     if (event.key === 'Enter') event.currentTarget.blur();
                                     if (event.key === 'Escape') cancelCanvasItemRename();
                                   }}
                                   className="h-5 w-full rounded-md border border-white/20 bg-black/25 px-1.5 text-center text-[8px] font-medium text-white outline-none focus:border-primary"
                                   aria-label={`Rename ${sketchLabel}`}
                                   data-pill-sketch-name-input
                                 />
                               ) : (
                                 <button
                                   type="button"
                                   className="block w-full truncate rounded text-[8px] font-medium text-white/95 outline-none transition-colors hover:text-primary focus-visible:text-primary"
                                   onClick={() => beginCanvasItemRename('sketch', sketch.id, sketchLabel)}
                                   title="Click to rename sketch"
                                   data-pill-sketch-name
                                 >
                                   {sketchLabel}
                                 </button>
                               )}
                             </div>
                             {sketch.isCollapsed && (
                               <div className="pointer-events-none absolute left-1.5 top-1.5 z-20 rounded-md border border-primary/30 bg-primary/90 px-1 py-0.5 text-[6px] font-semibold uppercase tracking-wide text-white">Hidden</div>
                             )}
                             <div className="absolute top-1 right-1 z-30 opacity-0 group-hover:opacity-100 transition-opacity flex space-x-1">
                               <button
                                 onClick={(e) => { e.stopPropagation(); setFloatingSketches(prev => prev.filter(f => f.id !== sketch.id)); }}
                                 className="rounded-lg border border-white/10 bg-black/65 p-1.5 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-danger"
                                 title="Delete Permanently"
                               >
                                 <Trash2 className="w-3 h-3" />
                               </button>
                             </div>
                           </div>
                         );
                       })}
                     </>
                   )}
                 </div>

                {/* Actions are grouped by purpose: create, navigate, then utilities. */}
                <div className="drag-handle mt-2 w-full shrink-0 cursor-move border-t border-border pt-2">
                  <div className="grid grid-cols-4 gap-1 rounded-2xl border border-border bg-surface-elevated/65 p-1">
                  <ToolbarButton
                    label="Full Screen Manager"
                    tooltipSide="top"
                    onClick={openProjectManager}
                    className="pill-main-action w-full"
                    data-pill-main-action
                  >
                    <Monitor className="size-4" />
                  </ToolbarButton>
                  <ToolbarButton
                    label="Add Floating Sketch"
                    tooltipSide="top"
                    onClick={createSketch}
                    className="pill-main-action w-full"
                    data-pill-main-action
                  >
                    <PenTool className="size-4" />
                  </ToolbarButton>
                  <ToolbarButton
                    label="Add Floating Note"
                    tooltipSide="top"
                    onClick={createNote}
                    className="pill-main-action w-full"
                    data-pill-main-action
                  >
                    <FileText className="size-4" />
                  </ToolbarButton>
                  <ToolbarButton
                    label="Add Media / Drop Zone"
                    tooltipSide="top"
                    onClick={triggerNativeFilePicker}
                    className="pill-main-action w-full"
                    data-pill-main-action
                  >
                    <Plus className="size-4" />
                  </ToolbarButton>
                  </div>

                  <div className="mt-2 flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={showSearchComponent ? 'primary' : 'outline'}
                    onClick={() => {
                      setShowSearchComponent(!showSearchComponent);
                      setShowSettings(false);
                      setShowProviderSettings(false);
                    }}
                    title="Quick Reference Search"
                    className="min-w-0 flex-1 justify-start px-3"
                  >
                    <Search className="size-3.5" />
                    <span className="truncate">Search references</span>
                  </Button>

                  <ToolbarButton
                    label="Settings"
                    tooltipSide="top"
                    active={showSettings}
                    className="relative size-8"
                    onClick={() => {
                      const nextShowSettings = !showSettings;
                      setShowSettings(nextShowSettings);
                      setShowProviderSettings(false);
                      setShowSearchComponent(false);
                    }}
                  >
                    <Settings className="size-4" />
                    {updateStatus.phase === 'ready' && (
                      <span className="absolute right-0.5 top-0.5 size-2 rounded-full border border-surface bg-success" />
                    )}
                  </ToolbarButton>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        <InvisibleResizeFrame
          kind="pill"
          toolbarHeight={0}
          onResizeMouseDown={handlePillResizeMouseDown}
        />
      </motion.div>
      )}
      </AnimatePresence>

      {/* 
        ============================================================
        THE SETTINGS APP (Attached to Pill)
        ============================================================
      */}
      <AnimatePresence>
        {showSettings && !showProviderSettings && (
          <motion.div 
            initial={{ opacity: 0, x: -10, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="settings-panel light-contrast-panel rf-panel absolute z-[99999] w-[420px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-3xl p-0 text-sm font-sans pointer-events-auto"
            data-pill-position-follower="true"
            style={{
              top: position.y,
              left: position.x + (isRetracted ? retractedPillSize : pillDimensions.width) + 16,
            }}
          >
          <div className="drag-handle flex cursor-move items-center justify-between border-b border-border px-5 py-4" onMouseDown={handlePillMouseDown}>
            <div>
              <div className="text-sm font-semibold tracking-[-0.015em] text-foreground">Settings</div>
              <div className="mt-1 text-[10px] text-muted-foreground">Tune RefFlow to your workflow.</div>
            </div>
            <ToolbarButton label="Close Settings" tooltipSide="bottom" onClick={() => { setShowSettings(false); setShowProviderSettings(false); }}>
              <X className="size-4" />
            </ToolbarButton>
          </div>
          
          <div className="max-h-[82vh] space-y-3 overflow-y-auto p-4">
            
            <section className="rf-card p-4">
              <div className="rf-kicker mb-3">Appearance</div>
              <div className="flex gap-1 rounded-xl border border-border bg-background/45 p-1">
              <Button
                type="button"
                size="sm"
                variant={theme === 'light' ? 'primary' : 'ghost'}
                onClick={() => {
                  setTheme('light');
                  localStorage.setItem('ref-flow-theme', 'light');
                }}
                className="flex-1"
              >
                Light
              </Button>
              <Button
                type="button"
                size="sm"
                variant={theme === 'dark' ? 'primary' : 'ghost'}
                onClick={() => {
                  setTheme('dark');
                  localStorage.setItem('ref-flow-theme', 'dark');
                }}
                className="flex-1"
              >
                Dark
              </Button>
              </div>
              <div className="mt-4 space-y-2 border-t border-border pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold text-foreground">Glass translucency</div>
                    <div className="mt-0.5 text-[9px] text-muted-foreground">Adjust shared panels, cards, and floating toolbars.</div>
                  </div>
                  <span className="shrink-0 text-[10px] font-medium tabular-nums text-secondary">{Math.round(glassTranslucency * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.75"
                  step="0.01"
                  value={glassTranslucency}
                  aria-label="Glass translucency"
                  data-glass-translucency
                  className="smooth-range w-full"
                  onChange={(event) => {
                    const nextValue = Number.parseFloat(event.target.value);
                    setGlassTranslucency(nextValue);
                    localStorage.setItem('ref-flow-glass-translucency', nextValue.toString());
                  }}
                />
              </div>
            </section>

            <section className="rf-card overflow-hidden">
              <div className="rf-kicker border-b border-border px-4 py-3">Window behavior</div>
              <div className="divide-y divide-border">
                <SettingsToggle
                  label="Always on top"
                  description="Keep references visible above your creative apps."
                  checked={alwaysOnTop}
                  onCheckedChange={setAlwaysOnTop}
                />
                <div>
                  <SettingsToggle
                    label="Start on boot"
                    description="Launch RefFlow when you sign in to Windows."
                    checked={startOnBoot}
                    disabled={startOnBootStatus.phase === 'checking' || startOnBootStatus.phase === 'saving' || startOnBootStatus.phase === 'unavailable'}
                    onCheckedChange={(checked) => { void changeStartOnBoot(checked); }}
                    compatibilityAriaLabel="Start on Boot"
                  />
                  <p className={`-mt-2 px-4 pb-3 text-[9px] leading-4 ${startOnBootStatus.phase === 'error' ? 'text-danger' : startOnBootStatus.phase === 'saving' ? 'text-primary' : 'text-muted-foreground'}`} data-start-on-boot-status>
                    {startOnBootStatus.message}
                  </p>
                </div>
                <SettingsToggle
                  label="Start in tray"
                  description="Open quietly without showing the pill immediately."
                  checked={launchMinimized}
                  onCheckedChange={setLaunchMinimized}
                />
                <SettingsToggle
                  label="Show in taskbar"
                  description="Keep a standard RefFlow button in the Windows taskbar."
                  checked={showInTaskbar}
                  onCheckedChange={setShowInTaskbar}
                />
              </div>
            </section>

            <div className="rf-card space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="rf-kicker">App updates</span>
                <span className="rounded-full border border-border bg-background/50 px-2 py-0.5 text-[9px] font-mono text-muted-foreground">
                  {updateStatus.currentVersion ? `v${updateStatus.currentVersion}` : 'installed build'}
                </span>
              </div>
              <p className={`text-[10px] leading-4 ${updateStatus.phase === 'error' ? 'text-danger' : updateStatus.phase === 'ready' ? 'text-success' : 'text-muted-foreground'}`}>
                {updateStatus.message || 'Updates are checked automatically.'}
              </p>
              {['available', 'downloading'].includes(updateStatus.phase) && (
                <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={false}
                    animate={{ width: `${Math.max(0, Math.min(100, updateStatus.percent || 0))}%` }}
                    transition={{ duration: 0.2 }}
                  />
                </div>
              )}
              <Button
                type="button"
                variant={updateStatus.phase === 'ready' ? 'primary' : 'secondary'}
                size="sm"
                onClick={updateStatus.phase === 'ready' ? restartToInstallUpdate : requestUpdateCheck}
                disabled={updateIsBusy || updateStatus.phase === 'development'}
                className="w-full"
              >
                {updateIsBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : updateStatus.phase === 'ready' ? <Check className="w-3.5 h-3.5" /> : <RotateCw className="w-3.5 h-3.5" />}
                {updateButtonLabel}
              </Button>
              <p className="text-[9px] leading-4 text-muted-foreground">
                Updates come from the official GitHub Releases page. Your boards and settings stay in place.
              </p>
            </div>

            <div className="rf-card space-y-3 p-4">
              <div className="space-y-2">
                <span className="rf-kicker block">Local board folder</span>
                {defaultAutosaveRoot && (
                  <div className="break-all rounded-xl border border-border bg-background/50 px-3 py-2 text-[9px] leading-4 text-secondary">
                    {defaultAutosaveRoot}
                  </div>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const active = projects.find(p => p.id === activeProjectId);
                    if (active) exportBoard(active);
                  }}
                  className="w-full"
                >
                  <Download className="w-3.5 h-3.5" /> Choose / Change Autosave Folder
                </Button>
                <p className="text-[10px] leading-4 text-muted-foreground">
                  Saves board JSON, media, notes, and sketches into an editable local folder.
                </p>
              </div>
            </div>

            <div className="rf-card p-2">
              <button
                type="button"
                onClick={() => setShowProviderSettings(true)}
                className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-surface-elevated"
                title="Manage no-key search sources"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/12 text-primary">
                  <Search className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold text-foreground">Search providers</span>
                  <span className="block text-[9px] leading-4 text-muted-foreground">No-key sources, fallback order, and diagnostics</span>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </div>

            <div className="rf-card space-y-2 p-4">
              <span className="rf-kicker block">Keyboard shortcuts</span>
              <p className="pb-1 text-[9px] leading-4 text-muted-foreground">Focus a binding and press the full combination you want, such as Shift + M. Unassign disables it.</p>
              {[
                { key: 'minimize', label: 'Minimize/Expand pill' },
                { key: 'newNote', label: 'New Note' },
                { key: 'newSketch', label: 'New Sketch' },
                { key: 'manager', label: 'Project Manager' },
                { key: 'settings', label: 'Settings' },
                { key: 'closeApp', label: 'Close Application' },
                { key: 'flipBoards', label: 'Flip Boards' },
                { key: 'toggleWindows', label: 'Show/Hide Windows' },
              ].map(({ key, label }) => {
                const combo = (shortcuts as Record<string, string>)[key] || '';
                const parsed = parseShortcut(combo);
                const displayValue = combo
                  ? [parsed.ctrl && 'Ctrl', parsed.alt && 'Alt', parsed.shift && 'Shift', parsed.meta && 'Win', shortcutKeyLabel(parsed.key)].filter(Boolean).join(' + ')
                  : 'Unassigned';
                return (
                  <div key={key} className="grid grid-cols-[minmax(0,1fr)_10rem] items-center gap-3 py-1.5" data-shortcut-row>
                    <span className="min-w-0 break-words text-[10px] leading-4 text-secondary" data-shortcut-label>{label}</span>
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1" data-shortcut-controls>
                      <input
                        type="text"
                        readOnly
                        value={displayValue}
                        onKeyDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (event.key === 'Backspace' || event.key === 'Delete') {
                            setShortcutBinding(key, '');
                            return;
                          }
                          const capturedKey = normalizeShortcutKey(event);
                          if (!capturedKey || (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey)) return;
                          setShortcutBinding(key, buildShortcut({
                            ctrl: event.ctrlKey,
                            alt: event.altKey,
                            shift: event.shiftKey,
                            meta: event.metaKey,
                            key: capturedKey
                          }));
                        }}
                        className={`h-8 w-full min-w-0 cursor-pointer rounded-lg border px-2 text-center font-mono text-[9px] font-semibold outline-none focus:border-primary ${combo ? 'border-primary/25 bg-primary/8 text-primary' : 'border-dashed border-border bg-background/45 text-muted-foreground'}`}
                        title="Click, then press the complete shortcut combination"
                        aria-label={`${label} shortcut`}
                      />
                      <button
                        type="button"
                        onClick={() => setShortcutBinding(key, '')}
                        disabled={!combo}
                        className="rounded-lg px-1.5 py-1 text-[9px] text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-30"
                        title={`Unassign ${label}`}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rf-card p-4">
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={openSupportPage}
                className="w-full border-primary/20 bg-primary/8 text-primary hover:border-primary/35 hover:bg-primary/14 hover:text-primary"
                title="Support RefFlow Studio on Patreon"
              >
                <Heart className="w-3.5 h-3.5" /> Support RefFlow Studio
              </Button>
              <p className="mt-2 text-center text-[10px] leading-4 text-muted-foreground">
                Help fund bug fixes, improvements, and new features.
              </p>
            </div>
            
            <div 
              className="drag-handle cursor-move pb-1 pt-2 text-center text-[9px] text-muted-foreground"
              onMouseDown={handlePillMouseDown}
            >
              Drag this panel from the header.
            </div>
          </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettings && showProviderSettings && (
          <motion.div
            initial={{ opacity: 0, x: 10, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 10, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="settings-panel provider-settings-panel light-contrast-panel rf-panel absolute z-[99999] w-80 overflow-hidden rounded-3xl p-0 text-sm font-sans pointer-events-auto"
            data-pill-position-follower="true"
            style={{
              top: position.y,
              left: position.x + (isRetracted ? retractedPillSize : pillDimensions.width) + 16,
            }}
            data-settings-section="providers"
          >
            <div className="drag-handle flex cursor-move items-center gap-2 border-b border-border px-4 py-4" onMouseDown={handlePillMouseDown}>
              <ToolbarButton
                label="Back to Settings"
                tooltipSide="bottom"
                onClick={() => setShowProviderSettings(false)}
              >
                <ChevronLeft className="w-4 h-4" />
              </ToolbarButton>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold tracking-[-0.015em] text-foreground">Search providers</h3>
                <p className="mt-1 text-[9px] text-muted-foreground">No-key sources and fallback order</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowDiagnosticsModal(true)}
                className="h-7 px-2 text-[9px] text-primary"
                title="Open Search Diagnostics"
              >
                Diagnostics
              </Button>
              <ToolbarButton
                label="Close Search Providers"
                tooltipSide="bottom"
                onClick={() => { setShowSettings(false); setShowProviderSettings(false); }}
              >
                <X className="w-4 h-4" />
              </ToolbarButton>
            </div>

            <p className="px-4 pt-4 text-[10px] leading-4 text-muted-foreground">
              RefFlow now uses only no-key in-app sources. Enable them or change their fallback order here.
            </p>

            <div className="max-h-[70vh] space-y-2 overflow-y-auto p-4">
              {providerOrder.map((provider, index) => {
                const conf = getProviderConfig(provider);
                const providerLabel = provider;
                return (
                  <div key={provider} className="rf-card flex flex-col gap-2 p-3" data-provider={provider}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex w-5 shrink-0 flex-col items-center justify-center">
                          <button
                            type="button"
                            aria-label={`Move ${providerLabel} up`}
                            className={`rounded text-muted-foreground hover:bg-surface-elevated hover:text-primary ${index === 0 ? 'pointer-events-none opacity-0' : ''}`}
                            onClick={() => {
                              const newOrder = [...providerOrder];
                              [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
                              updateProviderOrder(newOrder);
                            }}
                          >
                            <ChevronUp className="size-3" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${providerLabel} down`}
                            className={`rounded text-muted-foreground hover:bg-surface-elevated hover:text-primary ${index === providerOrder.length - 1 ? 'pointer-events-none opacity-0' : ''}`}
                            onClick={() => {
                              const newOrder = [...providerOrder];
                              [newOrder[index + 1], newOrder[index]] = [newOrder[index], newOrder[index + 1]];
                              updateProviderOrder(newOrder);
                            }}
                          >
                            <ChevronDown className="size-3" />
                          </button>
                        </div>
                        <span className="truncate text-[11px] font-semibold text-foreground">{providerLabel}</span>
                      </div>
                      <Switch
                        checked={conf.isEnabled}
                        aria-label={`${conf.isEnabled ? 'Disable' : 'Enable'} ${providerLabel}`}
                        onCheckedChange={(enabled) => {
                          updateProviderStatus({ ...providerStatus, [provider]: { ...providerStatus[provider], enabled } });
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 pl-6">
                      <span className={`text-[9px] font-mono ${
                        conf.badge === 'Ready'
                          ? 'text-success'
                          : 'text-muted-foreground'
                      }`}>
                        {conf.badge}
                      </span>
                      <span className="text-[8px] uppercase tracking-wide text-primary">No API key</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>


      <AnimatePresence>
        {showDiagnosticsModal && showSettings && showProviderSettings && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="rf-panel absolute z-[100000] flex w-80 flex-col overflow-hidden rounded-3xl p-0 text-sm font-sans pointer-events-auto"
            data-pill-position-follower="true"
            style={{
              top: position.y,
              left: position.x + (isRetracted ? retractedPillSize : pillDimensions.width) + 16 + 280,
            }}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Search diagnostics</h3>
                <p className="mt-1 text-[9px] text-muted-foreground">Provider health and recent activity</p>
              </div>
              <ToolbarButton label="Close diagnostics" tooltipSide="bottom" onClick={() => setShowDiagnosticsModal(false)}>
                <X className="size-4" />
              </ToolbarButton>
            </div>
            
            <div className="space-y-4 p-4 text-xs">
              <div>
                <span className="text-[10px] uppercase text-slate-500 block mb-1">Active Providers</span>
                <div className="space-y-1 font-mono text-[10px] text-secondary">
                    {providerOrder.filter(p => getProviderConfig(p).isEnabled).map(p => (
                        <div key={p}>- {p}</div>
                    ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center text-[10px] font-mono">
                <div className="rf-card p-2.5">
                    <div className="text-slate-500 mb-1">Total Req</div>
                    <div className="text-slate-800 dark:text-slate-200 text-sm">{searchDiagnostics.reqCount}</div>
                </div>
                <div className="rf-card p-2.5">
                    <div className="text-slate-500 mb-1">Total Res</div>
                    <div className="text-slate-800 dark:text-slate-200 text-sm">{searchDiagnostics.resCount}</div>
                </div>
              </div>
              <div>
                <span className="text-[10px] uppercase text-slate-500 block mb-1">Last Search</span>
                <div className="text-slate-700 dark:text-slate-300 text-[10px] font-mono">{searchDiagnostics.lastSearch ? searchDiagnostics.lastSearch.toLocaleTimeString() : 'Never'}</div>
              </div>

              {searchDiagnostics.errors.length > 0 && (
              <div>
                <span className="text-[10px] uppercase text-red-500/70 block mb-1">Errors Encountered</span>
                <div className="max-h-24 overflow-y-auto space-y-1 text-red-400 font-mono text-[9px] bg-red-500/10 p-2 rounded border border-red-500/20">
                    {searchDiagnostics.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 
        ============================================================
        THE SEARCH APP (Attached to Pill)
        ============================================================
      */}
      <AnimatePresence>
        {showSearchComponent && (
          <motion.div 
            initial={{ opacity: 0, x: -10, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="rf-panel absolute z-[99999] flex max-h-[86vh] w-[520px] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-3xl p-0 text-sm font-sans pointer-events-auto"
            data-pill-position-follower="true"
            style={{
              top: position.y,
              left: position.x + (isRetracted ? retractedPillSize : pillDimensions.width) + 16,
            }}
            onClick={() => setSearchContextMenu(null)}
          >
            <div className="drag-handle flex shrink-0 cursor-move items-center justify-between border-b border-border px-5 py-4" onMouseDown={handlePillMouseDown}>
              <div>
                <div className="text-sm font-semibold tracking-[-0.015em] text-foreground">Reference search</div>
                <div className="mt-1 text-[10px] text-muted-foreground">Discover and add visual inspiration.</div>
              </div>
              <ToolbarButton label="Close Search" tooltipSide="bottom" onClick={() => setShowSearchComponent(false)}>
                <X className="size-4" />
              </ToolbarButton>
            </div>
            
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
                <div className="flex gap-2 w-full shrink-0">
                    <input 
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && performSearch()}
                        placeholder="Search images..."
                        className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background/55 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
                    />
                    <Button
                        type="button"
                        variant="primary"
                        size="icon"
                        onClick={() => performSearch()}
                        aria-label="Search references"
                    >
                        {searchStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    </Button>
                </div>

                {searchHistory.length > 0 && (
                    <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-1 pb-3">
                        <span className="rf-kicker">Recent searches</span>
                        <div className="flex flex-wrap gap-1">
                            {searchHistory.map((hist, i) => (
                                <button
                                    key={i}
                                    onClick={() => {
                                        setSearchQuery(hist);
                                        setTimeout(() => {
                                          performSearch();
                                        }, 100);
                                    }}
                                    className="rounded-lg border border-border bg-surface-elevated/60 px-2 py-1 text-[10px] text-secondary transition-colors hover:border-primary/35 hover:bg-primary/10 hover:text-primary"
                                >
                                    {hist}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-2 shrink-0">
                    <div>
                        <span className="rf-kicker mb-1.5 block">In-app sources</span>
                        <div className="flex flex-wrap gap-1.5 shrink-0">
                            {NATIVE_PROVIDERS.map(p => {
                                let statusLabel = '';
                                if (p !== 'All Native') {
                                    const conf = getProviderConfig(p);
                                    if (!conf.isEnabled) statusLabel = '[off]';
                                }
                                
                                return (
                                <button
                                    key={p}
                                    onClick={() => setSearchProvider(p)}
                                    className={`flex items-center justify-center gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-medium transition-colors ${searchProvider === p ? 'border-primary bg-primary text-white' : 'border-border bg-surface-elevated/55 text-secondary hover:border-primary/30 hover:bg-primary/8 hover:text-primary'} ${statusLabel === '[off]' ? 'opacity-45' : ''}`}
                                    title={statusLabel === '[off]' ? 'Disabled in Settings' : 'Ready without an API key'}
                                    disabled={statusLabel === '[off]'}
                                >
                                    {p} {statusLabel}
                                </button>
                                );
                            })}
                        </div>
                    </div>
                    <div>
                        <span className="rf-kicker mb-1.5 block">Open in default browser</span>
                        <div className="flex flex-wrap gap-1.5 shrink-0">
                            {BROWSER_PROVIDERS.map(p => (
                                <button
                                    key={p}
                                    onClick={() => setSearchProvider(p)}
                                    className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-medium transition-colors ${searchProvider === p ? 'border-warning bg-warning text-white' : 'border-border bg-surface-elevated/55 text-secondary hover:border-warning/35 hover:bg-warning/10 hover:text-warning'}`}
                                >
                                    {p}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                
                <div className="rf-card grid shrink-0 grid-cols-4 gap-1.5 p-2.5 font-mono text-[9px] text-muted-foreground">
                    <div className="flex flex-col">
                        <span className="text-[8px] uppercase tracking-wider text-muted-foreground">Searching</span>
                        <span className="truncate font-semibold text-secondary">{activeProviderSearching}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[8px] uppercase tracking-wider text-muted-foreground">Response</span>
                        <span className="font-semibold text-secondary">+{lastResultsCount} hits</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[8px] uppercase tracking-wider text-muted-foreground">Page</span>
                        <span className="font-semibold text-secondary">#{searchPage}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[8px] uppercase tracking-wider text-muted-foreground">Loaded</span>
                        <span className="font-semibold text-secondary">{searchResults.length} items</span>
                    </div>
                </div>

                <div className="mb-1 flex shrink-0 flex-wrap gap-1.5 border-b border-border py-1 pb-3">
                    {FILTER_OPTIONS.map(f => (
                        <button
                            key={f}
                            onClick={() => setSearchFilters(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])}
                            className={`rounded-full border px-2.5 py-1 text-[9px] transition-colors ${searchFilters.includes(f) ? 'border-primary/55 bg-primary/12 text-primary' : 'border-border text-muted-foreground hover:border-border-strong hover:text-foreground'}`}
                        >
                            {f}
                        </button>
                    ))}
                </div>

                <div 
                    className="flex-1 overflow-y-auto w-full pr-1 no-scrollbar min-h-[200px]"
                    onScroll={handleSearchScroll}
                >
                    {searchStatus === 'loading' && (
                        <div className="grid grid-cols-2 gap-2 pb-2" aria-label="Loading search results">
                          {Array.from({ length: 6 }, (_, index) => (
                            <Skeleton key={index} className="rf-skeleton aspect-square" />
                          ))}
                        </div>
                    )}
                    
                    {searchStatus === 'no-results' && (
                        <div className="mx-2 my-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-elevated/30 p-6 text-center text-xs text-muted-foreground">
                             <Search className="mb-2 size-5 text-primary" />
                             <span className="font-medium text-secondary">No usable results found</span>
                             <span className="mt-1 text-[10px]">Try a broader phrase or another source.</span>
                        </div>
                    )}
                    
                    {searchResults.length > 0 && (
                        <div className="grid grid-cols-2 gap-2 pb-2">
                            {searchResults.map((res, idx) => (
                                <div key={idx} className="rf-card rf-preview-card relative group aspect-square overflow-hidden">
                                    <img 
                                        src={res.thumbnail || res.url} 
                                        alt={res.title || "Search result"} 
                                        className="h-full w-full scale-[1.01] object-cover opacity-0 transition-[opacity,transform] duration-200 group-hover:scale-105"
                                        loading="lazy"
                                        decoding="async"
                                        onLoad={(event) => event.currentTarget.classList.add('opacity-100')}
                                        draggable="true"
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData("text/plain", res.url);
                                            e.dataTransfer.setData("application/x-reference-url", "true");
                                        }}
                                        onDoubleClick={() => fetchAndAddImage(res.url, res.title)}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setSearchContextMenu({ x: e.clientX, y: e.clientY, result: res });
                                        }}
                                    />
                                    <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/70 via-black/10 to-black/80 p-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                                        <div className="flex w-full justify-between truncate font-mono text-[9px] text-white/80">
                                            <span>{res.provider}</span>
                                            {res.width && <span>{res.width}x{res.height}</span>}
                                        </div>
                                        <div className="flex flex-wrap gap-1 justify-end">
                                            <button
                                                onClick={() => fetchAndAddImage(res.url, res.title)}
                                                className="rounded-lg bg-primary p-2 text-white shadow-lg transition-all hover:-translate-y-px hover:bg-primary/90"
                                                title="Add to Workspace"
                                            >
                                                <Plus className="w-3 h-3" />
                                            </button>
                                            <button
                                                onClick={() => void openInWindowsDefaultBrowser(res.url)}
                                                className="rounded-lg border border-white/15 bg-black/55 p-2 text-white backdrop-blur transition-all hover:-translate-y-px hover:bg-white/15"
                                                title="Open Original"
                                            >
                                                <LinkIcon className="w-3 h-3" />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(res.url);
                                                }}
                                                className="rounded-lg border border-white/15 bg-black/55 p-2 text-white backdrop-blur transition-all hover:-translate-y-px hover:bg-white/15"
                                                title="Copy URL"
                                            >
                                                <FileText className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    
                    {searchStatus === 'loading-more' && (
                        <div className="flex justify-center py-4">
                            <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        </div>
                    )}
                </div>

                <div className="h-20 shrink-0 overflow-y-auto rounded-xl border border-border bg-background/45 p-2 font-mono text-[9px] text-muted-foreground">
                    {searchLog.map((log, i) => (
                        <div key={i}>{log}</div>
                    ))}
                </div>
            </div>

            {searchContextMenu && (
              <div 
                  className="rf-panel fixed z-[100000] w-52 overflow-hidden rounded-xl p-1.5"
                  style={{ top: searchContextMenu.y, left: searchContextMenu.x }}
                  onClick={(e) => e.stopPropagation()}
              >
                  <button 
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-secondary transition-colors hover:bg-primary hover:text-white"
                      onClick={() => { fetchAndAddImage(searchContextMenu.result.url, searchContextMenu.result.title); setSearchContextMenu(null); }}
                  >
                      <Plus className="w-3 h-3" /> Add Reference
                  </button>
                  <button 
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-secondary transition-colors hover:bg-primary hover:text-white"
                      onClick={() => { void openInWindowsDefaultBrowser(searchContextMenu.result.url); setSearchContextMenu(null); }}
                  >
                      <LinkIcon className="w-3 h-3" /> Open Original Page
                  </button>
                  <button 
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-secondary transition-colors hover:bg-primary hover:text-white"
                      onClick={() => {
                          const a = document.createElement('a');
                          a.href = searchContextMenu.result.url;
                          a.download = 'reference_image';
                          a.target = '_blank';
                          a.click();
                          setSearchContextMenu(null);
                      }}
                  >
                      <Download className="w-3 h-3" /> Download Original
                  </button>
                  <button 
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-secondary transition-colors hover:bg-primary hover:text-white"
                      onClick={() => { navigator.clipboard.writeText(searchContextMenu.result.url); setSearchContextMenu(null); }}
                  >
                      <FileText className="w-3 h-3" /> Copy Image URL
                  </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
         {floatingContextMenu && (() => {
           const hasElectron = !!((window as any).require);
           const isTextDocument = floatingContextMenu.type === 'pdf' || isOfficeDocument(floatingContextMenu.type);
           const canCopySelection = Boolean(floatingContextMenu.selectedText?.length);
           return (
              <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="rf-panel fixed z-[100000] w-56 overflow-hidden rounded-xl p-1.5 pointer-events-auto"
                  style={{ top: floatingContextMenu.y, left: floatingContextMenu.x }}
                  onContextMenu={(e) => e.preventDefault()}
                  onPointerDownCapture={(e) => {
                    e.stopPropagation();
                    applyCentralizedIgnoreMouseEvents(false);
                  }}
                  onMouseDownCapture={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
              >
                  {isTextDocument && (
                    <>
                      <button
                        type="button"
                        disabled={!canCopySelection}
                        className="context-menu-button w-full text-left px-4 py-2 hover:bg-sky-500 hover:text-white transition-colors text-xs flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit"
                        title="Copy selected text"
                        data-document-context-copy
                        onClick={async () => {
                          if (!floatingContextMenu.selectedText) return;
                          await writeTextToSystemClipboard(floatingContextMenu.selectedText);
                          setFloatingContextMenu(null);
                        }}
                      >
                        <Copy className="h-3 w-3" /> Copy selected text
                      </button>
                      <div className={`my-1 border-t ${theme === 'light' ? 'border-black/10' : 'border-white/10'}`} />
                    </>
                  )}

                  {/* Reveal in Explorer */}
                  <button 
                      className={`w-full text-left px-4 py-2 transition-colors text-xs flex items-center gap-2 ${
                          hasElectron
                          ? 'context-menu-button hover:bg-sky-500 hover:text-white cursor-pointer' 
                          : 'opacity-40 cursor-not-allowed text-slate-500'
                      }`}
                      onClick={async () => { 
                         if (!hasElectron) return;
                         const electron = (window as any).require ? (window as any).require('electron') : null;
                         if (!electron) return;
                         const targetPath = contextMenuTempPath || await ensureTempLocalFile(floatingContextMenu.url, floatingContextMenu.id);
                         if (targetPath) await electron.ipcRenderer.invoke('reveal-in-folder', targetPath);
                         setFloatingContextMenu(null); 
                      }}
                  >
                      <span>Reveal in Explorer</span>
                      {!hasElectron && <span className="ml-auto text-[8px] italic opacity-70 font-mono">Coming Soon</span>}
                  </button>

                  <div className={`my-1 border-t ${theme === 'light' ? 'border-black/10' : 'border-white/10'}`} />

                  {/* Save As... */}
                  <button 
                      className="context-menu-button w-full text-left px-4 py-2 hover:bg-sky-500 hover:text-white transition-colors text-xs flex items-center gap-2"
                      onClick={async () => {
                          const nodeRequire = getNodeRequire();
                          const electron = nodeRequire ? nodeRequire('electron') : null;
                          if (electron && nodeRequire) {
                              const extension = getSavedMediaExtension(floatingContextMenu.url, floatingContextMenu.type || 'image');
                              const filename = floatingContextMenu.fileName || `reference_${floatingContextMenu.id}.${extension}`;
                              const filterName = extension === 'docx'
                                ? 'Word Document'
                                : extension === 'xlsx'
                                  ? 'Excel Workbook'
                                  : extension === 'pdf'
                                    ? 'PDF Document'
                                    : 'Image';
                              
                              const result = await electron.ipcRenderer.invoke('show-save-dialog', {
                                  title: isOfficeDocument(floatingContextMenu.type) ? 'Save Original Document' : 'Save Reference',
                                  defaultPath: filename,
                                  filters: [{ name: filterName, extensions: [extension] }, { name: 'All Files', extensions: ['*'] }]
                              });
                              if (!result.canceled && result.filePath) {
                                  const fs = nodeRequire('fs');
                                  const tempPath = contextMenuTempPath || await ensureTempLocalFile(floatingContextMenu.url, floatingContextMenu.id);
                                  if (tempPath && fs.existsSync(tempPath)) {
                                      fs.writeFileSync(result.filePath, fs.readFileSync(tempPath));
                                      console.log(`[Save As] Saved file to chosen path: ${result.filePath}`);
                                  }
                              }
                          } else {
                              // standard browser download fallback
                              const a = document.createElement('a');
                              a.href = floatingContextMenu.url;
                              a.download = 'reference_image';
                              a.click();
                          }
                          setFloatingContextMenu(null);
                      }}
                  >
                      {isOfficeDocument(floatingContextMenu.type) ? 'Save Original As…' : 'Save As…'}
                  </button>

                  {(floatingContextMenu.type || 'image') === 'image' && (
                    <>
                      <button 
                          className="context-menu-button w-full text-left px-4 py-2 hover:bg-sky-500 hover:text-white transition-colors text-xs flex items-center gap-2"
                          onClick={() => {
                              exportOriginalImage(floatingContextMenu.url, floatingContextMenu.id, 'png');
                              setFloatingContextMenu(null);
                          }}
                      >
                          Export PNG
                      </button>

                      <button 
                          className="context-menu-button w-full text-left px-4 py-2 hover:bg-sky-500 hover:text-white transition-colors text-xs flex items-center gap-2"
                          onClick={() => {
                              exportOriginalImage(floatingContextMenu.url, floatingContextMenu.id, 'jpg');
                              setFloatingContextMenu(null);
                          }}
                      >
                          Export JPG
                      </button>

                      <button 
                          className="context-menu-button w-full text-left px-4 py-2 hover:bg-sky-500 hover:text-white transition-colors text-xs flex items-center gap-2"
                          onClick={() => {
                              exportOriginalImage(floatingContextMenu.url, floatingContextMenu.id, 'webp');
                              setFloatingContextMenu(null);
                          }}
                      >
                          Export WebP
                      </button>
                    </>
                  )}
              </motion.div>
           );
         })()}
      </AnimatePresence>

      {/* 
        ============================================================
        FLOATING IMAGE WINDOWS
        ============================================================
      */}
      <AnimatePresence>
        {floatingImages.filter(img => !img.isCollapsed).map(img => (
          <motion.div 
            key={img.id}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ 
              opacity: img.isCollapsed ? 0 : 1, 
              scale: img.isCollapsed ? 0.95 : 1, 
              y: img.isCollapsed ? 10 : 0
            }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={(reduceLargeBoardEffects || draggingFloatingId === img.id || resizingFloatingId === img.id) ? { type: "tween", duration: 0 } : { type: "tween", duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={`absolute bg-transparent flex flex-col group pointer-events-auto floating-window`}
            data-id={img.id}
            data-window-kind="image"
            data-active={topWindowId === img.id ? 'true' : 'false'}
            data-click-through={img.isLocked ? 'true' : 'false'}
            data-collapsed={img.isCollapsed ? 'true' : 'false'}
            onMouseDown={(e) => {
              setTopWindowId(img.id);
              startFloatingImageDrag(e, img.id);
            }}
            onContextMenu={(e) => {
               e.preventDefault();
               e.stopPropagation();
               setTopWindowId(img.id);
               setContextMenuTempPath('');
               applyCentralizedIgnoreMouseEvents(false);
               setFloatingContextMenu({
                 x: e.clientX,
                 y: e.clientY,
                 id: img.id,
                 url: img.url,
                 type: img.type || 'image',
                 fileName: img.fileName,
                 selectedText: getSelectedDocumentText(e.target)
               });
            }}
            style={{
              left: img.x,
              top: img.y,
              zIndex: topWindowId === img.id ? 6500 : 6000,
            }}
          >
            {/* Drag Handle Overlay */}
            <div 
               className={`rf-window-toolbar absolute bottom-full left-0 flex h-[34px] w-full min-w-0 cursor-move items-center justify-start gap-1 overflow-hidden rounded-t-xl px-1.5 pointer-events-auto transition-[opacity,border-color,box-shadow] duration-200 ${img.isCollapsed ? 'opacity-100' : topWindowId === img.id ? 'border-primary/35 opacity-100' : (img.isLocked ? 'opacity-45 hover:opacity-100' : 'opacity-75 hover:opacity-100 group-hover:opacity-100')} floating-drag-handle`}
               onMouseDown={(e) => {
                 if (!img.isLocked) handleFloatingMouseDown(e, img.id);
               }}
               title={img.isLocked ? 'Unlock to move this window' : 'Drag an empty toolbar area to move. Hold Alt to temporarily disable snapping.'}
            >
              <div className="flex items-center gap-1 shrink-0 min-w-0">
                <Move className={`w-3 h-3 shrink-0 ${img.isLocked ? 'text-slate-600' : 'text-slate-400'}`} />
                <input 
                   type="range" 
                   min="0.05" max="1" step="0.01" 
                   value={img.opacity}
                   onInput={(e) => updateFloatingOpacity(img.id, parseFloat((e.target as HTMLInputElement).value))}
                   onChange={(e) => updateFloatingOpacity(img.id, parseFloat(e.target.value))}
                   onMouseDown={(e) => e.stopPropagation()} 
                   className="smooth-range text-xs shrink-0"
                   style={{ width: Math.max(36, Math.min(96, img.width * 0.32)) }}
                />
              </div>
              
              <div
                className="flex min-w-0 flex-1 flex-nowrap gap-1 items-center justify-start overflow-x-auto no-scrollbar overscroll-contain"
                onWheel={(event) => {
                  event.stopPropagation();
                  event.currentTarget.scrollLeft += event.deltaY || event.deltaX;
                }}
                title="Scroll to reveal more image controls"
                data-media-toolbar-controls
              >
                {!isOfficeDocument(img.type) && (
                  <>
                <button 
                  onClick={() => setFloatingImages(prev => prev.map(f => f.id === img.id ? {...f, zoom: Math.min((f.zoom || 1) + 0.25, 5)} : f))}
                  className="hover:bg-black/10 dark:hover:bg-white/10 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3 h-3 text-sky-400" />
                </button>
                <button 
                  onClick={() => setFloatingImages(prev => prev.map(f => {
                    if (f.id !== img.id) return f;
                    const zoom = Math.max((f.zoom || 1) - 0.25, 0.5);
                    return { ...f, zoom, panX: zoom <= 1 ? 0 : f.panX, panY: zoom <= 1 ? 0 : f.panY };
                  }))}
                  className="hover:bg-black/10 dark:hover:bg-white/10 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3 h-3" />
                </button>
                <button 
                  onClick={() => setFloatingImages(prev => prev.map(f => f.id === img.id ? {...f, zoom: 1, panX: 0, panY: 0} : f))}
                  className="hover:bg-black/10 dark:hover:bg-white/10 px-1.5 py-1 rounded transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-[9px] font-bold"
                  title="Reset zoom and position"
                  data-control="reset-view"
                >
                  Reset
                </button>
                <button
                  onClick={() => {
                    const willDraw = !annotationModes[img.id];
                    setAnnotationModes(prev => ({ ...prev, [img.id]: willDraw }));
                    if (willDraw && img.isLocked) {
                      setFloatingImages(prev => prev.map(f => f.id === img.id ? { ...f, isLocked: false } : f));
                    }
                  }}
                  className={`p-1 rounded transition-colors ${annotationModes[img.id] ? 'bg-rose-500 text-white' : 'hover:bg-black/10 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                  title={annotationModes[img.id]
                    ? 'Stop drawing'
                    : img.type === 'pdf'
                      ? `Draw on PDF page ${img.documentPage || 1}`
                      : 'Draw on image'}
                >
                  <PenTool className="w-3 h-3" />
                </button>
                {annotationModes[img.id] && (
                  <input
                    type="color"
                    value={annotationColors[img.id] || '#ff3b30'}
                    onChange={(event) => setAnnotationColors(prev => ({ ...prev, [img.id]: event.target.value }))}
                    className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent p-0"
                    title="Drawing color"
                  />
                )}
                {getVisibleAnnotations(img).length > 0 && (
                  <>
                    <button
                      onClick={() => setFloatingImages(prev => prev.map(f => f.id === img.id
                        ? replaceVisibleAnnotations(f, getVisibleAnnotations(f).slice(0, -1))
                        : f))}
                      className="hover:bg-black/10 dark:hover:bg-white/10 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                      title={img.type === 'pdf' ? 'Undo last drawing on this page' : 'Undo last drawing'}
                    >
                      <Eraser className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setFloatingImages(prev => prev.map(f => f.id === img.id
                        ? replaceVisibleAnnotations(f, [])
                        : f))}
                      className="hover:bg-red-500/80 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 hover:text-white"
                      title={img.type === 'pdf' ? 'Clear drawings on this page' : 'Clear all drawings'}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
                <button 
                  onClick={() => extractPaletteForImage(img.id, img.url)}
                  className="hover:bg-black/10 dark:hover:bg-white/10 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  title="Extract Color Palette"
                >
                  <Palette className="w-3 h-3 text-fuchsia-400" />
                </button>
                {img.type === 'image' && (
                  <button
                    onClick={() => setFloatingImages(prev => prev.map(f => f.id === img.id ? {...f, rotation: (f.rotation + 90) % 360} : f))}
                    className="hover:bg-black/10 dark:hover:bg-white/10 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    title="Rotate image 90 degrees"
                    data-control="rotate"
                  >
                    <RotateCw className="w-3 h-3" />
                  </button>
                )}
                  </>
                )}
                <button 
                  onClick={() => {
                    const nextLocked = !img.isLocked;
                    setFloatingImages(prev => prev.map(f => f.id === img.id ? {...f, isLocked: nextLocked} : f));
                    if (nextLocked) {
                      setAnnotationModes(prev => ({ ...prev, [img.id]: false }));
                    }
                    logWindowLockState('image', img.id, nextLocked);
                  }}
                  className="hover:bg-black/10 dark:hover:bg-white/10 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  title={img.isLocked ? "Unlock Window" : "Lock in Place (Click Through)"}
                >
                  {img.isLocked ? <Lock className="w-3 h-3 text-sky-400" /> : <Unlock className="w-3 h-3" />}
                </button>
                <button 
                  onClick={() => setFloatingImages(prev => prev.map(f => f.id === img.id ? {...f, isCollapsed: !f.isCollapsed} : f))}
                  className="hover:bg-black/10 dark:hover:bg-white/10 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  title={img.isCollapsed ? "Expand Image" : "Collapse Image"}
                >
                  {img.isCollapsed ? <ChevronDown className="w-3 h-3 text-sky-400" /> : <ChevronUp className="w-3 h-3" />}
                </button>
                <button 
                  onClick={() => closeFloatingImage(img.id)}
                  className="hover:bg-red-500/80 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 hover:text-white"
                  title="Close"
                >
                  <X className="w-3 h-3" />
                </button>
                <div
                  className="min-w-4 flex-1 self-stretch cursor-move"
                  data-media-drag-space
                  aria-hidden="true"
                />
              </div>
            </div>
            
            <motion.div 
              animate={{
                height: img.isCollapsed
                  ? 0
                  : img.height || (isOfficeDocument(img.type) ? OFFICE_DOCUMENT_DEFAULT_HEIGHT : 'auto'),
                borderWidth: img.isCollapsed ? 0 : 1
              }}
              transition={(reduceLargeBoardEffects || resizingFloatingId === img.id) ? { duration: 0 } : { duration: 0.2, ease: "easeInOut" }}
              className={`relative flex flex-col overflow-hidden rounded-b-xl rounded-t-none border border-border bg-black/35 shadow-[var(--window-shadow)] transition-[box-shadow,border-color] duration-200 ${topWindowId === img.id ? 'border-primary/45 ring-1 ring-primary/35' : ''} ${img.isLocked ? 'pointer-events-none' : 'pointer-events-auto'}`}
              style={{ width: img.width, opacity: img.isCollapsed ? 0 : img.opacity }}
            >
              <div className="flex flex-col relative w-full h-full">
                  {img.searchStatus && (
                    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                      <div className="rf-panel flex max-w-xs flex-col items-center justify-center rounded-2xl p-6 text-center transition-opacity duration-200">
                        {img.isSearchInProgress ? (
                          <div className="relative">
                            <Loader2 className="mb-3 size-6 animate-spin text-primary" />
                            <div className="absolute inset-0 animate-pulse bg-primary opacity-20 blur-md"></div>
                          </div>
                        ) : (
                          img.searchStatus.includes('failed') || img.searchStatus.includes('Missing') || img.searchStatus.includes('No better') ? 
                            <X className="w-6 h-6 text-red-400 mb-3" /> : 
                            <Check className="w-6 h-6 text-green-400 mb-3" />
                        )}
                        <p className="text-sm font-medium text-foreground">{img.searchStatus}</p>
                      </div>
                    </div>
                  )}

                  {img.type === 'pdf' ? (
                    <div className={`relative flex w-full flex-col items-center justify-center bg-slate-800/50 ${img.height ? 'h-full min-h-0' : ''}`}>
                      <div
                        ref={(element) => {
                          if (element) pdfViewportRefs.current.set(img.id, element);
                          else pdfViewportRefs.current.delete(img.id);
                        }}
                        data-pdf-viewport={img.id}
                        className={`overflow-auto no-scrollbar w-full no-window-drag touch-none ${img.height ? 'h-full min-h-0 max-h-none' : 'max-h-[75vh] min-h-32'} ${annotationModes[img.id] ? 'cursor-crosshair' : ((img.zoom || 1) > 1 ? 'cursor-grab' : 'cursor-default')}`}
                        onWheel={(event) => handlePdfWheelZoom(event, img)}
                        onPointerDown={(event) => handlePdfPanPointerDown(event, img)}
                        onPointerMove={(event) => handlePdfPanPointerMove(event, img.id)}
                        onPointerUp={(event) => endPdfPan(event, img.id)}
                        onPointerCancel={(event) => endPdfPan(event, img.id)}
                        onAuxClick={(event) => {
                          if (event.button === 1) event.preventDefault();
                        }}
                        title={annotationModes[img.id]
                          ? `Draw on PDF page ${img.documentPage || 1}. Scroll to zoom.`
                          : 'Scroll to zoom. Middle-click and drag to pan.'}
                      >
                        <div className="inline-flex min-w-full justify-center">
                          <PdfCanvas
                            url={img.url}
                            pageNumber={img.documentPage || 1}
                            width={img.width}
                            scale={img.zoom || 1}
                            onLoadSuccess={(numPages) => setFloatingImages(prev => prev.map(f => {
                              if (f.id !== img.id || f.documentNumPages === numPages) return f;
                              return { ...f, documentNumPages: numPages };
                            }))}
                            onLoadError={(error) => {
                              console.error("PDF load failed:", error);
                              setFloatingImages(prev => prev.map(f => f.id === img.id ? { ...f, searchStatus: `PDF failed to load: ${error.message}` } : f));
                            }}
                            onRenderSuccess={() => restorePdfViewportPosition(img, true)}
                          >
                            <svg
                              viewBox="0 0 1000 1000"
                              preserveAspectRatio="none"
                              className={`absolute inset-0 z-10 w-full h-full touch-none ${annotationModes[img.id] ? 'pointer-events-auto' : 'pointer-events-none'}`}
                              onPointerDown={(event) => startImageAnnotation(event, img.id)}
                              onPointerMove={(event) => continueImageAnnotation(event, img.id)}
                              onPointerUp={(event) => endImageAnnotation(event, img.id)}
                              onPointerCancel={(event) => endImageAnnotation(event, img.id)}
                            >
                              {getVisibleAnnotations(img).map((stroke, strokeIndex) => stroke.points.length === 1 ? (
                                <circle
                                  key={strokeIndex}
                                  cx={stroke.points[0].x}
                                  cy={stroke.points[0].y}
                                  r={stroke.width / 2}
                                  fill={stroke.color}
                                />
                              ) : (
                                <path
                                  key={strokeIndex}
                                  d={getSmoothStrokePath(stroke.points)}
                                  fill="none"
                                  stroke={stroke.color}
                                  strokeWidth={stroke.width}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              ))}
                            </svg>
                          </PdfCanvas>
                        </div>
                      </div>
                      {annotationModes[img.id] && (
                        <div className="absolute left-2 top-2 z-40 rounded-md bg-slate-950/75 px-2 py-1 text-[9px] font-medium text-white pointer-events-none">
                          Drawing on page {img.documentPage || 1}
                        </div>
                      )}
                      {/* Page Controls */}
                      {(img.documentNumPages || 0) > 1 && (
                        <div className="rf-panel pointer-events-auto absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full px-2 py-1">
                          <button 
                            onClick={(e) => { e.stopPropagation(); setFloatingImages(prev => prev.map(f => f.id === img.id ? {...f, documentPage: Math.max(1, (f.documentPage || 1) - 1), panX: 0, panY: 0} : f)); }}
                            className="p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded-full text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                            title="Previous PDF page"
                          >
                            <ChevronLeft className="w-4 h-4"/>
                          </button>
                          <span className="text-slate-900 dark:text-white text-xs font-medium font-mono">{img.documentPage || 1} / {img.documentNumPages}</span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setFloatingImages(prev => prev.map(f => f.id === img.id ? {...f, documentPage: Math.min((f.documentNumPages || 1), (f.documentPage || 1) + 1), panX: 0, panY: 0} : f)); }}
                            className="p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded-full text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                            title="Next PDF page"
                          >
                            <ChevronRight className="w-4 h-4"/>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : isOfficeDocument(img.type) ? (
                    <OfficeDocumentWindow
                      media={img}
                      theme={theme}
                      onUpdate={updateFloatingMedia}
                      onMoveMouseDown={handleFloatingMouseDown}
                    />
                  ) : (
                    <div
                      className={`relative w-full overflow-hidden no-window-drag touch-none ${img.height ? 'flex min-h-0 flex-1 items-center justify-center' : ''} ${annotationModes[img.id] ? 'cursor-crosshair' : (imagePanSessionRef.current?.id === img.id ? 'cursor-grabbing' : ((img.zoom || 1) > 1 ? 'cursor-grab' : 'cursor-default'))}`}
                      onWheel={(event) => handleImageWheelZoom(event, img.id)}
                      onPointerDown={(event) => handleImagePanPointerDown(event, img)}
                      onPointerMove={(event) => handleImagePanPointerMove(event, img.id)}
                      onPointerUp={(event) => endImagePan(event, img.id)}
                      onPointerCancel={(event) => endImagePan(event, img.id)}
                      onAuxClick={(event) => {
                        if (event.button === 1) event.preventDefault();
                      }}
                      title={annotationModes[img.id]
                        ? 'Draw to highlight. Use the toolbar to undo or clear.'
                        : 'Scroll to zoom. Middle-click and drag to pan when zoomed.'}
                    >
                      <div
                        className={`relative w-full ${img.height ? 'flex h-full items-center justify-center' : ''} ${imagePanSessionRef.current?.id === img.id ? '' : 'transition-transform duration-150'}`}
                        style={{
                          transform: `translate3d(${img.panX || 0}px, ${img.panY || 0}px, 0) rotate(${img.rotation}deg) scale(${img.zoom || 1})`,
                          transformOrigin: 'center center'
                        }}
                      >
                        <ReferenceImagePreview
                          src={img.url}
                          targetWidth={getReferencePreviewWidth(img.width, img.zoom || 1)}
                          className={`block w-full pointer-events-auto select-none no-window-drag ${img.height ? 'h-full max-h-full object-contain' : ''}`}
                          style={{ objectFit: 'contain', height: img.height ? '100%' : undefined }}
                          draggable={!img.isLocked && !annotationModes[img.id]}
                          title={img.isLocked ? 'Unlock this reference to drag it out' : 'Drag into Photoshop or another desktop app'}
                          onMouseDown={(event) => event.stopPropagation()}
                          onMouseEnter={() => {
                            if (dragFilePathsRef.current.has(img.id)) return;
                            ensureTempLocalFile(img.url, img.id).then(filePath => {
                              if (filePath) dragFilePathsRef.current.set(img.id, filePath);
                            });
                          }}
                          onDragStart={(event) => {
                            event.stopPropagation();
                            const electron = getElectron();
                            if (electron?.ipcRenderer) {
                              // Electron's native file drag replaces Chromium's HTML5
                              // drag operation. Keeping both alive can leave Chromium
                              // stuck in a drag session when a desktop app rejects or
                              // cancels the drop, which makes the cursor and window
                              // interactions appear permanently grabbed.
                              event.preventDefault();
                              electron.ipcRenderer.send('start-reference-drag', {
                                id: img.id,
                                source: img.url,
                                cachedPath: dragFilePathsRef.current.get(img.id) || '',
                                type: img.type || 'image'
                              });
                              return;
                            }

                            // Preserve ordinary browser drag behavior outside Electron.
                            event.dataTransfer.effectAllowed = 'copy';
                            event.dataTransfer.setData('text/uri-list', img.url);
                          }}
                        />
                        <svg
                          viewBox="0 0 1000 1000"
                          preserveAspectRatio="none"
                          className={`absolute inset-0 w-full h-full ${annotationModes[img.id] ? 'pointer-events-auto' : 'pointer-events-none'}`}
                          onPointerDown={(event) => startImageAnnotation(event, img.id)}
                          onPointerMove={(event) => continueImageAnnotation(event, img.id)}
                          onPointerUp={(event) => endImageAnnotation(event, img.id)}
                          onPointerCancel={(event) => endImageAnnotation(event, img.id)}
                        >
                          {getVisibleAnnotations(img).map((stroke, strokeIndex) => stroke.points.length === 1 ? (
                            <circle
                              key={strokeIndex}
                              cx={stroke.points[0].x}
                              cy={stroke.points[0].y}
                              r={stroke.width / 2}
                              fill={stroke.color}
                            />
                          ) : (
                            <path
                              key={strokeIndex}
                              d={getSmoothStrokePath(stroke.points)}
                              fill="none"
                              stroke={stroke.color}
                              strokeWidth={stroke.width}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          ))}
                        </svg>
                      </div>
                      {annotationModes[img.id] && (
                        <div className="absolute left-2 bottom-2 rounded-md bg-slate-950/75 px-2 py-1 text-[9px] font-medium text-white pointer-events-none">
                          Drawing mode
                        </div>
                      )}
                    </div>
                  )}
                  {img.palette && img.palette.length > 0 && (
                    <div className="mt-auto flex h-6 w-full shrink-0" style={{ width: img.width }}>
                      {img.palette.map((color, i) => {
                        const normalizedColor = normalizeHexColor(color) || color;
                        const copyFailed = copiedColor === `error:${normalizedColor}` || copiedColor === `error:${color}`;
                        return (
                          <button
                            type="button"
                            key={`${normalizedColor}-${i}`}
                            className="flex-1 h-full cursor-pointer hover:scale-110 focus-visible:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white origin-bottom transition-transform group/color relative"
                            style={{ backgroundColor: normalizedColor }}
                            onClick={(event) => {
                              event.stopPropagation();
                              void copyPaletteColor(normalizedColor);
                            }}
                            title={`Copy ${normalizedColor}`}
                            aria-label={`Copy color ${normalizedColor}`}
                          >
                            <span className="absolute opacity-0 group-hover/color:opacity-100 group-focus-visible/color:opacity-100 bottom-full left-1/2 -translate-x-1/2 mb-2 bg-black/90 text-white text-[9px] px-1.5 py-0.5 rounded pointer-events-none whitespace-nowrap">
                              {copiedColor === normalizedColor ? `Copied ${normalizedColor}` : copyFailed ? 'Copy failed' : normalizedColor}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
              </div>
            </motion.div>
            {!img.isLocked && (
              <InvisibleResizeFrame
                kind="media"
                toolbarHeight={FLOATING_IMAGE_TOOLBAR_HEIGHT}
                onResizeMouseDown={(event, edge) => handleFloatingResizeMouseDown(event, img.id, edge)}
              />
            )}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* 
        ============================================================
        FLOATING NOTES
        ============================================================
      */}
      <AnimatePresence>
        {floatingNotes.map(note => {
          const isEditing = editingNotes[note.id];
          const noteControlsVisible = note.isCollapsed
            || topWindowId === note.id
            || isEditing
            || resizingNoteId === note.id;
          return (
          <motion.div 
            key={note.id}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ 
              opacity: note.isCollapsed ? 0 : 1, 
              scale: note.isCollapsed ? 0.95 : 1, 
              y: note.isCollapsed ? 10 : 0
            }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={(reduceLargeBoardEffects || draggingNoteId === note.id || resizingNoteId === note.id) ? { type: "tween", duration: 0 } : { type: "tween", duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
             className="absolute flex flex-col bg-transparent group pointer-events-auto floating-window"
             data-id={note.id}
             data-window-kind="note"
            data-active={topWindowId === note.id ? 'true' : 'false'}
            data-click-through={note.isLocked ? 'true' : 'false'}
            data-collapsed={note.isCollapsed ? 'true' : 'false'}
            onMouseDown={() => setTopWindowId(note.id)}
            style={{
              left: note.x,
              top: note.y,
              width: note.width,
              zIndex: topWindowId === note.id ? 6500 : 6000,
            }}
          >
            {/* Note Drag Handle Overlay */}
            <div 
               className={`note-toolbar rf-window-toolbar absolute bottom-full left-0 z-10 flex h-[32px] w-full items-center gap-1 rounded-t-xl px-1.5 pointer-events-auto transition-opacity duration-200 ${!note.isLocked ? 'cursor-move' : 'cursor-default'} ${noteControlsVisible ? (topWindowId === note.id ? 'border-primary/35 opacity-100' : 'opacity-100') : 'opacity-0 group-hover:opacity-100'} floating-note-drag-handle`}
               onMouseDown={(e) => {
                 setTopWindowId(note.id);
                 if (!note.isLocked) handleNoteMouseDown(e, note.id);
               }}
            >
              <div className="flex w-5 shrink-0 items-center justify-center">
                <Move className={`w-3 h-3 shrink-0 ${note.isLocked ? 'text-slate-600' : 'text-slate-400'}`} />
              </div>
              <div className="h-full w-8 shrink-0 cursor-move" data-note-drag-space aria-hidden="true" />
              <div
                className="note-toolbar-controls flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto overscroll-contain no-scrollbar"
                onWheel={(event) => {
                  event.stopPropagation();
                  event.currentTarget.scrollLeft += event.deltaY || event.deltaX;
                }}
                title="Scroll to reveal more note controls"
              >
                  <div className={`flex shrink-0 items-center space-x-1 border-r border-slate-700 pr-1 mr-1 ${note.isLocked ? 'opacity-40' : ''}`}>
                    {['#fef08a', '#bfdbfe', '#fbcfe8', '#bbf7d0', '#e2e8f0'].map(c => (
                      <button
                        key={c}
                        disabled={note.isLocked}
                        onClick={() => setFloatingNotes(prev => prev.map(n => n.id === note.id ? {...n, color: c} : n))}
                        className={`w-3 h-3 shrink-0 rounded-full border border-black/20 enabled:hover:scale-125 transition-transform disabled:cursor-not-allowed ${note.color === c ? 'ring-1 ring-white/50' : ''}`}
                        style={{ backgroundColor: c }}
                        title={note.isLocked ? 'Unlock note to change color' : 'Change Color'}
                      />
                    ))}
                  </div>
                
                  <div className={`flex shrink-0 items-center space-x-1 border-r border-slate-700 pr-1 mr-1 ${(!isEditing || note.isLocked) ? 'opacity-40' : ''}`}>
                    <button 
                      disabled={!isEditing || note.isLocked}
                      onClick={() => updateNoteText(note.id, note.text + '**bold**')}
                      className="enabled:hover:bg-black/10 dark:enabled:hover:bg-white/10 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 enabled:hover:text-slate-900 dark:enabled:hover:text-white disabled:cursor-not-allowed"
                      title={note.isLocked ? 'Unlock note to format text' : isEditing ? 'Bold' : 'Edit the note to use formatting'}
                      data-note-format="bold"
                    >
                      <Bold className="w-3 h-3" />
                    </button>
                    <button 
                      disabled={!isEditing || note.isLocked}
                      onClick={() => updateNoteText(note.id, note.text + '*italic*')}
                      className="enabled:hover:bg-black/10 dark:enabled:hover:bg-white/10 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 enabled:hover:text-slate-900 dark:enabled:hover:text-white disabled:cursor-not-allowed"
                      title={note.isLocked ? 'Unlock note to format text' : isEditing ? 'Italic' : 'Edit the note to use formatting'}
                      data-note-format="italic"
                    >
                      <Italic className="w-3 h-3" />
                    </button>
                    <button 
                      disabled={!isEditing || note.isLocked}
                      onClick={() => updateNoteText(note.id, note.text + '\n- list item')}
                      className="enabled:hover:bg-black/10 dark:enabled:hover:bg-white/10 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 enabled:hover:text-slate-900 dark:enabled:hover:text-white disabled:cursor-not-allowed"
                      title={note.isLocked ? 'Unlock note to format text' : isEditing ? 'List' : 'Edit the note to use formatting'}
                      data-note-format="list"
                    >
                      <List className="w-3 h-3" />
                    </button>
                  </div>
                
                <button 
                  disabled={note.isLocked}
                  onClick={() => setEditingNotes(prev => ({...prev, [note.id]: !isEditing}))}
                  className="shrink-0 enabled:hover:bg-black/10 dark:enabled:hover:bg-white/10 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 enabled:hover:text-slate-900 dark:enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  title={note.isLocked ? 'Unlock note to edit' : isEditing ? "Preview Markdown" : "Edit Markdown"}
                >
                  {isEditing ? <Eye className="w-3 h-3" /> : <Edit3 className="w-3 h-3" />}
                </button>
                <button
                  aria-pressed={Boolean(note.lockAspectRatio)}
                  onClick={() => setFloatingNotes(prev => prev.map(n => n.id === note.id
                    ? { ...n, lockAspectRatio: !n.lockAspectRatio }
                    : n))}
                  className={`shrink-0 rounded px-1.5 py-1 text-[9px] font-semibold transition-colors ${note.lockAspectRatio ? 'bg-sky-500 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-black/10 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white'}`}
                  title={note.lockAspectRatio
                    ? 'Resize mode: proportional. Click for free resize; hold Shift to temporarily switch.'
                    : 'Resize mode: free. Click for proportional resize; hold Shift to temporarily switch.'}
                  data-note-resize-mode
                >
                  {note.lockAspectRatio ? 'Ratio' : 'Free'}
                </button>
                <button 
                  onClick={() => setFloatingNotes(prev => prev.map(n => n.id === note.id ? {...n, isCollapsed: !n.isCollapsed} : n))}
                  className="shrink-0 hover:bg-black/10 dark:hover:bg-white/10 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  title={note.isCollapsed ? "Expand Note" : "Collapse Note"}
                >
                  {note.isCollapsed ? <ChevronDown className="w-3 h-3 text-sky-400" /> : <ChevronUp className="w-3 h-3" />}
                </button>
                <button 
                  onClick={() => {
                    const nextLocked = !note.isLocked;
                    setFloatingNotes(prev => prev.map(n => n.id === note.id ? {...n, isLocked: nextLocked} : n));
                    logWindowLockState('note', note.id, nextLocked);
                  }}
                  className="shrink-0 hover:bg-black/10 dark:hover:bg-white/10 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  title={note.isLocked ? "Unpin Note" : "Pin to Background"}
                >
                  {note.isLocked ? <Pin className="w-3 h-3 text-sky-400" /> : <PinOff className="w-3 h-3" />}
                </button>
                <button 
                  onClick={() => closeNote(note.id)}
                  className="shrink-0 hover:bg-red-500/80 p-1 rounded transition-colors text-slate-500 dark:text-slate-400 hover:text-white"
                  title="Close Note"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
            
            <motion.div 
              animate={{
                height: note.isCollapsed ? 0 : note.height,
                opacity: note.isCollapsed ? 0 : 1,
                borderWidth: note.isCollapsed ? 0 : 1
              }}
              transition={resizingNoteId === note.id ? { duration: 0 } : { duration: 0.2, ease: "easeInOut" }}
              className={`relative flex flex-col overflow-hidden rounded-b-xl rounded-t-none border border-black/10 shadow-[var(--window-shadow)] transition-[box-shadow,border-color] duration-200 ${topWindowId === note.id ? 'ring-1 ring-primary/45' : ''} ${note.isLocked ? 'pointer-events-none' : 'pointer-events-auto'}`}
              style={{ backgroundColor: note.color }}
            >
              <div className="w-full h-full relative" onMouseDown={(e) => { if (note.isLocked) e.stopPropagation(); }}>
                  {isEditing ? (
                    <textarea 
                      value={note.text}
                      onChange={(e) => updateNoteText(note.id, e.target.value)}
                      onMouseDown={(e) => e.stopPropagation()}
                      placeholder="Type a note here (Markdown works!)..."
                      className="absolute inset-0 w-full h-full bg-transparent p-4 pt-6 resize-none outline-none text-black/80 font-medium placeholder-black/30 font-sans text-sm"
                      spellCheck={false}
                    />
                  ) : (
                    <div 
                      className="absolute inset-0 overflow-y-auto p-4 pt-6 prose prose-sm max-w-none text-black/80 font-medium break-words"
                      onMouseDown={(e) => e.stopPropagation()}
                      onDoubleClick={() => setEditingNotes(prev => ({...prev, [note.id]: true}))}
                    >
                      <Markdown remarkPlugins={[remarkGfm]}>{note.text || '*Empty note (double-click to edit)*'}</Markdown>
                    </div>
                  )}
                </div>
              
            </motion.div>
            {!note.isLocked && (
              <InvisibleResizeFrame
                kind="note"
                toolbarHeight={FLOATING_NOTE_TOOLBAR_HEIGHT}
                onResizeMouseDown={(event, edge) => handleNoteResizeMouseDown(event, note.id, edge)}
              />
            )}
          </motion.div>
        )})}
      </AnimatePresence>

      {/* 
        ============================================================
        FLOATING SKETCHES
        ============================================================
      */}
      <AnimatePresence>
        {floatingSketches.map(sketch => (
          <FloatingSketchWindow
            key={sketch.id}
            sketch={sketch}
            updateSketch={(id, updates) => setFloatingSketches(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))}
            closeSketch={closeSketch}
            onMouseDown={handleSketchMouseDown}
            onResizeMouseDown={handleSketchResizeMouseDown}
            isActive={topWindowId === sketch.id}
            onInteraction={() => setTopWindowId(sketch.id)}
            logWindowLockState={logWindowLockState}
            isDragging={draggingSketchId === sketch.id}
            isResizing={resizingSketchId === sketch.id}
          />
        ))}
      </AnimatePresence>

      {needsPermission && (
        <div className="rf-panel absolute bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border-danger/35 px-4 py-3 pointer-events-auto">
           <div className="flex-1">
             <p className="text-sm font-semibold text-danger">Auto-save paused</p>
             <p className="mt-1 text-xs text-muted-foreground">Permission is needed to write to the board folder.</p>
           </div>
           <Button
             type="button"
             variant="danger"
             size="sm"
             onClick={async () => {
               const p = projects.find(proj => proj.id === activeProjectId);
               if (p && p.directoryHandle) {
                 try {
                   const perm = await p.directoryHandle.requestPermission({ mode: 'readwrite' });
                   if (perm === 'granted') {
                     setNeedsPermission(false);
                     syncBoardToHandle(p, p.directoryHandle);
                   }
                 } catch (e) {
                   console.error("Permission request failed", e);
                 }
               }
             }}
           >
             Resume
           </Button>
        </div>
      )}

      <AnimatePresence>
        {dragError && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            data-native-interactive="true"
            className="rf-panel absolute bottom-6 left-1/2 z-[100001] max-w-sm -translate-x-1/2 rounded-2xl border-warning/40 px-4 py-3 text-sm text-foreground pointer-events-auto"
          >
            {dragError}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
      {showManager && (
        <motion.div 
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={`light-contrast-panel absolute z-[999] pointer-events-auto flex overflow-hidden bg-background/96 p-3 backdrop-blur-xl ${managerBounds ? '' : 'inset-0'}`}
            style={managerBounds ? {
              left: managerBounds.x,
              top: managerBounds.y,
              width: managerBounds.width,
              height: managerBounds.height
            } : undefined}
        >
          <aside data-manager-sidebar className={`rf-panel mr-3 flex h-full shrink-0 flex-col overflow-hidden rounded-3xl transition-[width] duration-200 ${isManagerSidebarCollapsed ? 'w-[72px]' : 'w-64'}`}>
            <div className={`flex h-[72px] shrink-0 items-center border-b border-border ${isManagerSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4'}`}>
              {isManagerSidebarCollapsed ? (
                <ToolbarButton
                  label="Expand sidebar"
                  tooltipSide="right"
                  onClick={() => setIsManagerSidebarCollapsed(false)}
                  className="size-10 border-primary/25 bg-primary/12 text-primary hover:border-primary/40 hover:bg-primary/18 hover:text-primary"
                  data-manager-sidebar-expand
                >
                  <PanelLeftOpen className="size-4" />
                </ToolbarButton>
              ) : (
                <>
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/12 text-primary">
                    <Sparkles className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold tracking-[-0.015em] text-foreground">RefFlow Studio</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">Visual workspace</div>
                  </div>
                  <ToolbarButton
                    label="Collapse sidebar"
                    tooltipSide="right"
                    onClick={() => setIsManagerSidebarCollapsed(true)}
                  >
                    <PanelLeftClose className="size-4" />
                  </ToolbarButton>
                </>
              )}
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-4">
              {!isManagerSidebarCollapsed && <div className="rf-kicker mb-2 px-2">Workspace</div>}
              <button
                type="button"
                onClick={() => setManagingProjectId(null)}
                className={`flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-xs font-medium transition-colors ${!managingProjectId ? 'bg-primary/14 text-primary' : 'text-muted-foreground hover:bg-surface-elevated hover:text-foreground'} ${isManagerSidebarCollapsed ? 'justify-center px-0' : ''}`}
                title="All Boards"
              >
                <LayoutGrid className="size-4 shrink-0" />
                {!isManagerSidebarCollapsed && <span className="truncate">All Boards</span>}
              </button>

              {!isManagerSidebarCollapsed && <div className="rf-kicker mb-2 mt-6 px-2">Boards</div>}
              <div className={`${isManagerSidebarCollapsed ? 'mt-3' : ''} space-y-1`}>
                {projects.map(project => {
                  const projectLabel = project.name || 'Untitled Board';
                  const isEditingSidebarName = editingProjectId === project.id && editingProjectSurface === 'sidebar' && !isManagerSidebarCollapsed;
                  return (
                    <div
                      key={project.id}
                      className={`group/sidebar flex min-h-10 w-full items-center rounded-xl text-xs transition-colors ${project.id === activeProjectId ? 'bg-surface-elevated text-foreground' : 'text-muted-foreground hover:bg-surface-elevated/70 hover:text-foreground'} ${isManagerSidebarCollapsed ? 'justify-center' : 'gap-1 px-1.5'}`}
                      data-sidebar-board-row={project.id}
                    >
                      {isEditingSidebarName ? (
                        <>
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/12 text-primary">
                            <FolderOpen className="size-3.5" />
                          </div>
                          <input
                            autoFocus
                            type="text"
                            value={editingProjectName}
                            onChange={(event) => setEditingProjectName(event.target.value)}
                            onBlur={() => { void commitProjectRename(project); }}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                              if (event.key === 'Enter') event.currentTarget.blur();
                              if (event.key === 'Escape') {
                                setEditingProjectId(null);
                                setEditingProjectSurface(null);
                                setEditingProjectName('');
                              }
                            }}
                            className="h-7 min-w-0 flex-1 rounded-lg border border-primary/60 bg-background px-2 text-[10px] font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                            aria-label={`Rename ${projectLabel} from sidebar`}
                            data-sidebar-board-name-input
                          />
                          <ToolbarButton
                            label="Save board name"
                            tooltipSide="right"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => { void commitProjectRename(project); }}
                            className="size-7 text-primary hover:text-primary"
                          >
                            <Check className="size-3.5" />
                          </ToolbarButton>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={async () => {
                              if (project.id !== activeProjectId) await selectProjectOfId(project.id);
                            }}
                            onDoubleClick={() => setManagingProjectId(project.id)}
                            className={`flex h-10 min-w-0 items-center gap-3 rounded-xl text-left ${isManagerSidebarCollapsed ? 'w-10 justify-center' : 'flex-1 px-1.5'}`}
                            title={projectLabel}
                            data-sidebar-board-name
                          >
                            <div className={`flex size-7 shrink-0 items-center justify-center rounded-lg border ${project.id === activeProjectId ? 'border-primary/30 bg-primary/12 text-primary' : 'border-border bg-card text-muted-foreground'}`}>
                              <FolderOpen className="size-3.5" />
                            </div>
                            {!isManagerSidebarCollapsed && (
                              <>
                                <span className="min-w-0 flex-1 truncate font-medium">{projectLabel}</span>
                                {project.id === activeProjectId && <span className="size-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_8px_rgba(94,107,255,0.8)]" />}
                              </>
                            )}
                          </button>
                          {!isManagerSidebarCollapsed && (
                            <ToolbarButton
                              label={`Rename ${projectLabel} from sidebar`}
                              tooltipSide="right"
                              onClick={() => beginProjectRename(project, 'sidebar')}
                              className="size-7 opacity-55 transition-opacity hover:text-primary group-hover/sidebar:opacity-100 focus-visible:opacity-100"
                              data-sidebar-board-rename
                            >
                              <Edit2 className="size-3.5" />
                            </ToolbarButton>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </nav>

            <div className="shrink-0 border-t border-border p-3">
              <Button
                type="button"
                variant="primary"
                size={isManagerSidebarCollapsed ? 'icon' : 'md'}
                onClick={() => { void createNewProjectBoard(); }}
                className={isManagerSidebarCollapsed ? 'w-full' : 'w-full'}
                title="New Board"
              >
                <Plus className="size-4" />
                {!isManagerSidebarCollapsed && <span>New Board</span>}
              </Button>
            </div>
          </aside>

          <main data-manager-main className="rf-panel flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-8 py-5">
            <div className="min-w-0">
              <div className="rf-kicker mb-1">Workspace / Boards</div>
              <h1 className="truncate text-2xl font-semibold tracking-[-0.025em] text-foreground">
                {managingProjectId ? (projects.find(project => project.id === managingProjectId)?.name || 'Board contents') : 'Project Boards'}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {managingProjectId ? 'Review and organize this board’s saved content.' : `${projects.length} ${projects.length === 1 ? 'board' : 'boards'} in your local workspace`}
              </p>
            </div>
            <Button onClick={() => setShowManager(false)} variant="outline" size="sm" title="Close Manager">
               <span>Close</span> <X className="size-4"/>
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
          
          {!managingProjectId ? (
            <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-5 pb-12 md:grid-cols-2 xl:grid-cols-3">
              {projects.map(p => (
                <div 
                  key={p.id} 
                  className={`rf-card group flex min-h-[220px] cursor-pointer flex-col p-5 ${p.id === activeProjectId ? 'border-primary/60 ring-1 ring-primary/25 shadow-[0_18px_44px_rgba(94,107,255,0.14)]' : ''}`}
                  onClick={async () => {
                    if (p.id !== activeProjectId) {
                       await selectProjectOfId(p.id);
                    }
                  }}
                >
                   <div className="flex justify-between items-start mb-4">
                     {editingProjectId === p.id && editingProjectSurface === 'card' ? (
                       <div className="flex items-center flex-1 pr-2">
                         <input 
                           autoFocus
                           type="text" 
                           value={editingProjectName}
                           onChange={(e) => setEditingProjectName(e.target.value)}
                           aria-label={`Rename ${p.name || 'Untitled Board'}`}
                           onBlur={() => { void commitProjectRename(p); }}
                           onKeyDown={(e) => {
                             e.stopPropagation();
                             if (e.key === 'Enter') {
                               e.currentTarget.blur();
                             } else if (e.key === 'Escape') {
                               setEditingProjectId(null);
                               setEditingProjectSurface(null);
                               setEditingProjectName('');
                             }
                           }}
                           onMouseDown={(e) => e.stopPropagation()}
                           onClick={(e) => e.stopPropagation()}
                           className="h-9 w-full rounded-xl border border-primary bg-background px-3 text-sm text-foreground outline-none"
                         />
                         <button
                           onMouseDown={(e) => e.preventDefault()}
                           onClick={(e) => {
                             e.stopPropagation();
                             void commitProjectRename(p);
                           }}
                           className="rf-icon-button ml-2 text-primary"
                           title="Save board name"
                         >
                           <Check className="w-4 h-4"/>
                         </button>
                       </div>
                     ) : (
                       <button
                         type="button"
                         className="min-w-0 flex-1 truncate rounded-lg pr-2 text-left text-lg font-semibold tracking-[-0.02em] text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                         onClick={(event) => {
                           event.stopPropagation();
                           beginProjectRename(p);
                         }}
                         title="Click to rename board"
                       >
                         {p.name || 'Untitled Board'}
                       </button>
                     )}
                     <div className="flex space-x-1 shrink-0">
                       {editingProjectId !== p.id && (
                         <button 
                           onClick={(e) => {
                             e.stopPropagation();
                             beginProjectRename(p);
                           }}
                           className="rf-icon-button"
                           title="Rename Board"
                         >
                           <Edit2 className="w-4 h-4"/>
                         </button>
                       )}
                       {p.id !== activeProjectId && projects.length > 1 && (
                         <button 
                           onClick={async (e) => { 
                             e.stopPropagation(); 
                             await deleteProject(p.id); 
                             setProjects(await getProjects()); 
                           }} 
                           className="rf-icon-button hover:border-danger/20 hover:bg-danger/10 hover:text-danger"
                           title="Delete Board"
                         >
                           <Trash2 className="w-4 h-4"/>
                         </button>
                       )}
                     </div>
                   </div>
                   <div className="mt-2 grid grid-cols-3 gap-2">
                     {[
                       { label: 'Media', value: p.floatingImages?.length || 0 },
                       { label: 'Notes', value: p.floatingNotes?.length || 0 },
                       { label: 'Sketches', value: p.floatingSketches?.length || 0 },
                     ].map(stat => (
                       <div key={stat.label} className="rounded-xl border border-border bg-surface-elevated/55 px-3 py-2.5">
                         <div className="text-base font-semibold text-foreground">{stat.value}</div>
                         <div className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{stat.label}</div>
                       </div>
                     ))}
                   </div>
                   <div className="mt-3 text-xs text-muted-foreground">Updated {new Date(p.updatedAt).toLocaleDateString()}</div>
                   
                   <div className="mt-auto flex items-center justify-between pt-5">
                     {p.id === activeProjectId ? (
                        <div className="rounded-full border border-primary/25 bg-primary/12 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-primary">
                          Active
                        </div>
                     ) : <div />}
                     <div className="flex gap-2">
                       <Button
                         type="button"
                         variant="ghost"
                         size="sm"
                         onClick={(e) => {
                           e.stopPropagation();
                           exportBoard(p);
                         }}
                         title="Export to Folder"
                       >
                         <Download className="size-3.5"/><span>Export</span>
                       </Button>
                       <Button
                         type="button"
                         variant="secondary"
                         size="sm"
                         onClick={(e) => {
                           e.stopPropagation();
                           setManagingProjectId(p.id);
                         }}
                       >
                         Edit Content
                       </Button>
                     </div>
                   </div>
                </div>
              ))}
              <div 
                onClick={() => { void createNewProjectBoard(); }}
                className="group flex min-h-[220px] cursor-pointer items-center justify-center rounded-2xl border border-dashed border-border bg-surface-elevated/25 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/45 hover:bg-primary/5"
              >
                <div className="flex flex-col items-center gap-3 text-muted-foreground transition-colors group-hover:text-primary">
                  <div className="flex size-11 items-center justify-center rounded-2xl border border-border bg-card shadow-sm transition-transform duration-200 group-hover:scale-105 group-hover:border-primary/30">
                    <Plus className="size-5" />
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-semibold tracking-tight text-foreground">New Board</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">Create a fresh visual workspace</div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            (() => {
              const p = projects.find(proj => proj.id === managingProjectId);
              if (!p) {
                setManagingProjectId(null);
                return null;
              }
              return (
                <div className="rf-card mx-auto flex w-full max-w-6xl flex-col space-y-7 p-6 pb-12">
                  <div className="flex items-center justify-between">
                     <div className="flex items-center space-x-4">
                       <ToolbarButton label="Back to all boards" tooltipSide="bottom" onClick={() => setManagingProjectId(null)}>
                          <ChevronLeft className="size-4"/>
                       </ToolbarButton>
                       <div>
                         <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">Board contents</h2>
                         <p className="mt-1 text-xs text-muted-foreground">Manage the references saved in {p.name}.</p>
                       </div>
                     </div>
                     <div className="flex space-x-3">
                       <label className="flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-primary/70 bg-primary px-3 text-xs font-medium text-white shadow-[0_8px_24px_rgba(94,107,255,0.2)] transition-all hover:-translate-y-px hover:bg-primary/90">
                          <Plus className="w-4 h-4"/><span className="text-sm font-medium pr-1">Add Media</span>
                         <input 
                            type="file" 
                            accept={SUPPORTED_MEDIA_ACCEPT}
                            multiple 
                            className="hidden" 
                            onChange={async (e) => {
                              if (e.target.files) {
                                const files = Array.from(e.target.files) as File[];
                                try {
                                  const projectWithDirectory = await ensureProjectLocalDirectory(p);
                                  const mediaFiles = files.filter(file => getImportedMediaType(file) !== null);
                                  const base64Images = await Promise.all(mediaFiles.map(fileToBase64));
                                  const newFloatingImages = createFloatingMediaItems(mediaFiles, base64Images, { x: 100 + Math.random() * 50, y: 100 + Math.random() * 50 });
                                  const updatedFloatingImages = [...(projectWithDirectory.floatingImages || []), ...newFloatingImages];
                                  await updateProject(p.id, { floatingImages: updatedFloatingImages });
                                  if (projectWithDirectory.directoryPath) {
                                    await syncBoardToPath({ ...projectWithDirectory, floatingImages: updatedFloatingImages }, projectWithDirectory.directoryPath);
                                  }
                                  setProjects(await getProjects());
                                  if (p.id === activeProjectId) setFloatingImages(updatedFloatingImages);
                                } catch (error) {
                                  console.error("Failed to add image", error);
                                }
                              }
                            }} 
                         />
                       </label>
                       <Button
                         type="button"
                         variant="secondary"
                         size="sm"
                         onClick={async () => {
                            const newNote: FloatingNote = {
                              id: Math.random().toString(36).substr(2, 9),
                              name: `Note ${(p.floatingNotes?.length || 0) + 1}`,
                              text: 'New Note',
                              x: 100 + Math.random() * 50, 
                              y: 100 + Math.random() * 50, 
                              width: 320, 
                              height: 200, 
                              color: '#fef08a', 
                              isLocked: false,
                              isCollapsed: true
                            };
                            const updatedNotes = [...(p.floatingNotes||[]), newNote];
                            await updateProject(p.id, { floatingNotes: updatedNotes });
                            setProjects(await getProjects());
                            if (p.id === activeProjectId) setFloatingNotes(updatedNotes);
                         }}
                       >
                         <Plus className="w-4 h-4"/><span className="text-sm">Add Note</span>
                       </Button>
                     </div>
                  </div>
                  
                  <div>
                    <h3 className="rf-kicker mb-4 border-b border-border pb-3">Media ({p.floatingImages?.length || 0})</h3>
                    {p.floatingImages?.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-border bg-surface-elevated/30 p-6 text-center text-sm text-muted-foreground">No media in this board yet.</p>
                    ) : (
                      <div className="grid grid-cols-2 flex-wrap gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                         {p.floatingImages?.map((img, mediaIndex) => {
                           const mediaLabel = getMediaDisplayName(img, mediaIndex);
                           return (
                             <div key={img.id} className="rf-card rf-preview-card relative group aspect-square overflow-hidden" data-board-media-preview={img.id}>
                                {img.type === 'pdf' ? (
                                  <PillPdfPreview media={img} />
                                ) : isOfficeDocument(img.type) ? (
                                  <PillOfficePreview media={img} />
                                ) : (
                                  <img src={img.url} className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" alt={`${mediaLabel} preview`} />
                                )}
                                <div className="pill-preview-caption" onMouseDown={(event) => event.stopPropagation()}>
                                  {editingMediaId === img.id && editingMediaProjectId === p.id ? (
                                    <input
                                      autoFocus
                                      value={editingMediaName}
                                      onChange={(event) => setEditingMediaName(event.target.value)}
                                      onBlur={() => { void commitMediaRename(img, p); }}
                                      onKeyDown={(event) => {
                                        event.stopPropagation();
                                        if (event.key === 'Enter') event.currentTarget.blur();
                                        if (event.key === 'Escape') cancelMediaRename();
                                      }}
                                      className="h-6 w-full rounded-md border border-white/20 bg-black/25 px-2 text-center text-[9px] font-medium text-white outline-none focus:border-primary"
                                      aria-label={`Rename ${mediaLabel}`}
                                      data-board-media-name-input
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      className="block w-full truncate rounded text-[9px] font-medium text-white/95 outline-none transition-colors hover:text-primary focus-visible:text-primary"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        beginMediaRename(img, p.id);
                                      }}
                                      title="Click to rename reference"
                                      data-board-media-name
                                    >
                                      {mediaLabel}
                                    </button>
                                  )}
                                </div>
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const newImages = p.floatingImages.filter(f => f.id !== img.id);
                                    await updateProject(p.id, { floatingImages: newImages });
                                    setProjects(await getProjects());
                                    if(p.id === activeProjectId) setFloatingImages(newImages);
                                  }}
                                  className="absolute right-2 top-2 z-30 rounded-lg border border-white/10 bg-black/45 p-1.5 text-white opacity-0 backdrop-blur-md transition-all hover:bg-danger group-hover:opacity-100"
                                  title="Remove reference"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                             </div>
                           );
                         })}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="rf-kicker mb-4 mt-6 border-b border-border pb-3">Notes ({p.floatingNotes?.length || 0})</h3>
                    {p.floatingNotes?.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-border bg-surface-elevated/30 p-6 text-center text-sm text-muted-foreground">No notes in this board yet.</p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                        {p.floatingNotes?.map((note, noteIndex) => {
                          const noteLabel = getNoteDisplayName(note, noteIndex);
                          return (
                            <div
                              key={note.id}
                              className="rf-card rf-preview-card relative group h-32 overflow-hidden p-4 pb-10 text-sm text-slate-800"
                              style={{ backgroundColor: note.color }}
                              data-board-note-preview={note.id}
                            >
                               <p className="line-clamp-3 h-full w-full pr-6 whitespace-pre-wrap">{note.text || 'Empty note...'}</p>
                               <div className="pill-preview-caption" onMouseDown={(event) => event.stopPropagation()}>
                                 {editingCanvasItem?.kind === 'note' && editingCanvasItem.id === note.id && editingCanvasItem.projectId === p.id ? (
                                   <input
                                     autoFocus
                                     value={editingCanvasItem.name}
                                     onChange={(event) => setEditingCanvasItem(current => current ? { ...current, name: event.target.value } : current)}
                                     onBlur={() => { void commitCanvasItemRename('note', note, p); }}
                                     onKeyDown={(event) => {
                                       event.stopPropagation();
                                       if (event.key === 'Enter') event.currentTarget.blur();
                                       if (event.key === 'Escape') cancelCanvasItemRename();
                                     }}
                                     className="h-6 w-full rounded-md border border-white/20 bg-black/25 px-2 text-center text-[9px] font-medium text-white outline-none focus:border-primary"
                                     aria-label={`Rename ${noteLabel}`}
                                     data-board-note-name-input
                                   />
                                 ) : (
                                   <button
                                     type="button"
                                     className="block w-full truncate rounded text-[9px] font-medium text-white/95 outline-none transition-colors hover:text-primary focus-visible:text-primary"
                                     onClick={(event) => {
                                       event.stopPropagation();
                                       beginCanvasItemRename('note', note.id, noteLabel, p.id);
                                     }}
                                     title="Click to rename note"
                                     data-board-note-name
                                   >
                                     {noteLabel}
                                   </button>
                                 )}
                               </div>
                               <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const newNotes = p.floatingNotes.filter(f => f.id !== note.id);
                                    await updateProject(p.id, { floatingNotes: newNotes });
                                    setProjects(await getProjects());
                                    if(p.id === activeProjectId) setFloatingNotes(newNotes);
                                  }}
                                  className="absolute right-2 top-2 z-30 rounded-lg border border-white/10 bg-black/60 p-1.5 text-white opacity-0 backdrop-blur transition-all hover:bg-danger group-hover:opacity-100"
                                  title="Remove Note"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="rf-kicker mb-4 mt-6 border-b border-border pb-3">Sketches ({p.floatingSketches?.length || 0})</h3>
                    {!p.floatingSketches || p.floatingSketches.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-border bg-surface-elevated/30 p-6 text-center text-sm text-muted-foreground">No sketches in this board yet.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                        {p.floatingSketches.map((sketch, sketchIndex) => {
                          const sketchLabel = getSketchDisplayName(sketch, sketchIndex);
                          return (
                            <div
                              key={sketch.id}
                              className="rf-card rf-preview-card group relative aspect-square overflow-hidden"
                              style={{ backgroundColor: sketch.backgroundColor }}
                              data-board-sketch-preview={sketch.id}
                            >
                              <svg
                                viewBox={`0 0 ${Math.max(1, sketch.width)} ${Math.max(1, sketch.height)}`}
                                preserveAspectRatio="xMidYMid meet"
                                className="h-full w-full pb-7"
                                aria-label={`${sketchLabel} preview`}
                              >
                                {sketch.lines.map((line, lineIndex) => line.points.length === 1 ? (
                                  <circle
                                    key={lineIndex}
                                    cx={line.points[0].x}
                                    cy={line.points[0].y}
                                    r={line.width / 2}
                                    fill={line.isEraser ? sketch.backgroundColor : line.color}
                                  />
                                ) : (
                                  <path
                                    key={lineIndex}
                                    d={getSmoothStrokePath(line.points)}
                                    fill="none"
                                    stroke={line.isEraser ? sketch.backgroundColor : line.color}
                                    strokeWidth={line.width}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                ))}
                              </svg>
                              {sketch.lines.length === 0 && <PenTool className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 text-primary" />}
                              <div className="pill-preview-caption" onMouseDown={(event) => event.stopPropagation()}>
                                {editingCanvasItem?.kind === 'sketch' && editingCanvasItem.id === sketch.id && editingCanvasItem.projectId === p.id ? (
                                  <input
                                    autoFocus
                                    value={editingCanvasItem.name}
                                    onChange={(event) => setEditingCanvasItem(current => current ? { ...current, name: event.target.value } : current)}
                                    onBlur={() => { void commitCanvasItemRename('sketch', sketch, p); }}
                                    onKeyDown={(event) => {
                                      event.stopPropagation();
                                      if (event.key === 'Enter') event.currentTarget.blur();
                                      if (event.key === 'Escape') cancelCanvasItemRename();
                                    }}
                                    className="h-6 w-full rounded-md border border-white/20 bg-black/25 px-2 text-center text-[9px] font-medium text-white outline-none focus:border-primary"
                                    aria-label={`Rename ${sketchLabel}`}
                                    data-board-sketch-name-input
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className="block w-full truncate rounded text-[9px] font-medium text-white/95 outline-none transition-colors hover:text-primary focus-visible:text-primary"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      beginCanvasItemRename('sketch', sketch.id, sketchLabel, p.id);
                                    }}
                                    title="Click to rename sketch"
                                    data-board-sketch-name
                                  >
                                    {sketchLabel}
                                  </button>
                                )}
                              </div>
                              <button
                                onClick={async (event) => {
                                  event.stopPropagation();
                                  const updatedSketches = (p.floatingSketches || []).filter(item => item.id !== sketch.id);
                                  await updateProject(p.id, { floatingSketches: updatedSketches });
                                  setProjects(await getProjects());
                                  if (p.id === activeProjectId) setFloatingSketches(updatedSketches);
                                }}
                                className="absolute right-2 top-2 z-30 rounded-lg border border-white/10 bg-black/55 p-1.5 text-white opacity-0 backdrop-blur transition-all hover:bg-danger group-hover:opacity-100"
                                title="Remove Sketch"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()
          )}
          </div>
          </main>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
    </TooltipProvider>
  );
}

