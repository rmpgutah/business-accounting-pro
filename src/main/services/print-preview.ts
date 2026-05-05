/**
 * Print Preview Window Service
 * Opens HTML content in a dedicated preview window with Print / Save PDF / Close toolbar.
 *
 * Also exports headless helpers (htmlToPDFBuffer, saveHTMLAsPDF, printHTML)
 * used by IPC handlers that need a PDF without showing the preview window.
 */
import { BrowserWindow, dialog, shell } from 'electron';
import { promises as fsp } from 'fs';

// ─── PDF page/margin options ────────────────────────────────
// Centralised so all call sites emit PDFs with the same defaults.
// Callers can override per-invocation (e.g. landscape for wide tables).
//
// `metadata` (P1.6): post-processed via pdf-lib after Chromium renders
// the PDF. Sets the Title/Author/Subject/Keywords visible in Finder
// "Get Info", Adobe File → Properties, and OS Spotlight search.
// Without this, Chromium's default metadata is the page <title> only;
// Author defaults to "anonymous" and Subject is empty.
export type PDFMetadata = {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
};
export type PDFOptions = {
  pageSize?: 'A4' | 'Letter' | 'Legal' | 'Tabloid';
  landscape?: boolean;
  margins?: { top: number; bottom: number; left: number; right: number };
  printBackground?: boolean;
  metadata?: PDFMetadata;
};

// Page-layout defaults — metadata is intentionally NOT here (it's
// document-specific and gets stripped before being passed to printToPDF
// which would reject the unknown property).
type PageLayoutOptions = Required<Omit<PDFOptions, 'metadata'>>;

const DEFAULT_PDF_OPTIONS: PageLayoutOptions = {
  pageSize: 'A4',
  landscape: false,
  margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
  printBackground: true,
};

function resolvePDFOptions(opts?: PDFOptions): PageLayoutOptions {
  return {
    pageSize: opts?.pageSize ?? DEFAULT_PDF_OPTIONS.pageSize,
    landscape: opts?.landscape ?? DEFAULT_PDF_OPTIONS.landscape,
    margins: opts?.margins ?? DEFAULT_PDF_OPTIONS.margins,
    printBackground: opts?.printBackground ?? DEFAULT_PDF_OPTIONS.printBackground,
  };
}

// ─── Safe filename builder ──────────────────────────────────
// {doctype}-{identifier}-{yyyy-MM-dd}.pdf
export function buildPdfFilename(doctype: string, identifier: string, date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const safe = (s: string) => String(s || '').replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const doc = safe(doctype) || 'document';
  const id = safe(identifier) || 'untitled';
  return `${doc}-${id}-${yyyy}-${mm}-${dd}.pdf`;
}

// ─── Locked-down headless BrowserWindow factory ─────────────
// nodeIntegration off, contextIsolation on, sandbox on, no preload.
// Blocks navigation so an injected <meta http-equiv="refresh"> or
// JS redirect in user-supplied HTML cannot read local files via file://.
function createHeadlessWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 1100,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      javascript: true,
    },
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('data:')) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return win;
}

// ─── PDF Metadata Post-Processor ────────────────────────────
// Electron's webContents.printToPDF() does not expose author/subject/
// keywords — Chromium only sets the document <title> as the PDF Title.
// We use pdf-lib to load the rendered PDF and rewrite the Info
// dictionary. Lazy-import keeps app startup fast (pdf-lib is ~700KB).
async function applyPDFMetadata(buf: Buffer, meta: PDFMetadata | undefined): Promise<Buffer> {
  if (!meta || (!meta.title && !meta.author && !meta.subject && !meta.keywords?.length && !meta.creator && !meta.producer)) {
    return buf;
  }
  try {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.load(buf, { updateMetadata: true });
    if (meta.title)    pdf.setTitle(meta.title);
    if (meta.author)   pdf.setAuthor(meta.author);
    if (meta.subject)  pdf.setSubject(meta.subject);
    if (meta.keywords?.length) pdf.setKeywords(meta.keywords);
    if (meta.creator)  pdf.setCreator(meta.creator);
    pdf.setProducer(meta.producer || 'Business Accounting Pro');
    pdf.setCreationDate(new Date());
    pdf.setModificationDate(new Date());
    const out = await pdf.save({ useObjectStreams: false });
    return Buffer.from(out);
  } catch (err) {
    // Best-effort: if metadata write fails, return the original PDF
    // rather than failing the entire render. Print operations should
    // succeed even when metadata enrichment fails.
    console.warn('[pdf] metadata post-process failed, returning bare PDF:', err);
    return buf;
  }
}

async function renderHTMLToPDF(
  htmlContent: string,
  options?: PDFOptions
): Promise<Buffer> {
  const win = createHeadlessWindow();
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
    const resolved = resolvePDFOptions(options);
    const pdfData = await win.webContents.printToPDF(resolved);
    const buf = Buffer.from(pdfData);
    // Apply metadata if provided. The destructured `metadata` field is
    // dropped from `resolved` since printToPDF rejects unknown options.
    return applyPDFMetadata(buf, options?.metadata);
  } finally {
    // Guarantee cleanup to prevent renderer-process leak.
    if (!win.isDestroyed()) win.destroy();
  }
}

// ─── Wrap HTML content with a sticky toolbar ────────────────
function wrapWithToolbar(html: string, title: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const headMatch = html.match(/<head[^>]*>([\s\S]*)<\/head>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;
  const headContent = headMatch ? headMatch[1] : '';
  const safeTitle = title.replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || c)
  );

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: 'unsafe-inline'; img-src data: https:; script-src 'unsafe-inline';">
  <title>${safeTitle}</title>
  ${headContent}
  <style>
    .pp-toolbar {
      position: sticky; top: 0; z-index: 9999;
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 20px; background: #1a1a1a; border-bottom: 1px solid #333;
      font-family: -apple-system, system-ui, sans-serif;
    }
    .pp-toolbar-title { font-size: 13px; font-weight: 600; color: #e0e0e0; }
    .pp-toolbar-actions { display: flex; gap: 8px; }
    .pp-toolbar-btn {
      padding: 6px 16px; font-size: 12px; font-weight: 600;
      border: 1px solid #444; background: #2a2a2a; color: #e0e0e0;
      cursor: pointer; border-radius: 0;
    }
    .pp-toolbar-btn:hover { background: #3a3a3a; }
    .pp-toolbar-btn-primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
    @media print { .pp-toolbar { display: none !important; } }
  </style>
</head>
<body style="margin:0;padding:0;background:#fff;">
  <div class="pp-toolbar">
    <span class="pp-toolbar-title">${safeTitle}</span>
    <div class="pp-toolbar-actions">
      <button class="pp-toolbar-btn" id="pp-close">Close</button>
      <button class="pp-toolbar-btn" id="pp-save-pdf">Save as PDF</button>
      <button class="pp-toolbar-btn pp-toolbar-btn-primary" id="pp-print">Print</button>
    </div>
  </div>
  ${bodyContent}
  <script>
    document.getElementById('pp-close').addEventListener('click', () => window.close());
    document.getElementById('pp-print').addEventListener('click', () => window.print());
    document.getElementById('pp-save-pdf').addEventListener('click', () => {
      // Signal to main process via title-change sentinel.
      document.title = '__PP_SAVE_PDF__';
    });
  </script>
</body>
</html>`;
}

// ─── Open a print-preview window ────────────────────────────
export function openPrintPreview(
  htmlContent: string,
  title: string,
  pdfOptions?: PDFOptions & { defaultFilename?: string }
): void {
  const previewWin = new BrowserWindow({
    width: 800,
    height: 1100,
    title,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Block navigation away from the data: URL — keeps arbitrary HTML from
  // reading local files via file:// or exfiltrating over http.
  previewWin.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('data:')) event.preventDefault();
  });
  previewWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const wrappedHTML = wrapWithToolbar(htmlContent, title);
  previewWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(wrappedHTML)}`);

  previewWin.on('page-title-updated', async (event, newTitle) => {
    if (newTitle !== '__PP_SAVE_PDF__') return;
    event.preventDefault();
    try {
      const defaultName = pdfOptions?.defaultFilename
        || buildPdfFilename('document', title, new Date());
      const { filePath, canceled } = await dialog.showSaveDialog(previewWin, {
        defaultPath: defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (canceled || !filePath) return;
      const pdfData = await previewWin.webContents.printToPDF(resolvePDFOptions(pdfOptions));
      await fsp.writeFile(filePath, Buffer.from(pdfData));
    } catch (err) {
      console.error('Print preview save-pdf error:', err);
      dialog.showErrorBox('Save PDF failed', (err as Error)?.message || String(err));
    } finally {
      if (!previewWin.isDestroyed()) {
        previewWin.webContents.executeJavaScript(
          `document.title = ${JSON.stringify(title)};`
        ).catch(() => {});
      }
    }
  });
}

// ─── Render HTML to PDF Buffer (headless) ───────────────────
export async function htmlToPDFBuffer(
  htmlContent: string,
  options?: PDFOptions
): Promise<Buffer> {
  return renderHTMLToPDF(htmlContent, options);
}

// ─── Save HTML as PDF (headless — no preview window) ────────
// Returns { path, cancelled?, error? } — callers should surface errors
// instead of silently swallowing disk-full / permission-denied.
export async function saveHTMLAsPDF(
  htmlContent: string,
  title: string,
  opts?: PDFOptions & { defaultFilename?: string; parentWindow?: BrowserWindow }
): Promise<{ path?: string; cancelled?: boolean; error?: string }> {
  try {
    const defaultName = opts?.defaultFilename
      || buildPdfFilename('document', title, new Date());
    const saveOpts = {
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    };
    const { filePath, canceled } = opts?.parentWindow
      ? await dialog.showSaveDialog(opts.parentWindow, saveOpts)
      : await dialog.showSaveDialog(saveOpts);
    if (canceled || !filePath) return { cancelled: true };

    const pdfBuffer = await renderHTMLToPDF(htmlContent, opts);
    await fsp.writeFile(filePath, pdfBuffer);
    return { path: filePath };
  } catch (err: any) {
    return { error: err?.message || 'PDF save failed' };
  }
}

// ─── Print HTML via system print dialog ─────────────────────
export async function printHTML(htmlContent: string): Promise<void> {
  const win = createHeadlessWindow();
  let finished = false;
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
    await new Promise<void>((resolve, reject) => {
      win.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
        finished = true;
        if (!success && failureReason && failureReason !== 'cancelled') {
          reject(new Error(failureReason));
        } else {
          resolve();
        }
      });
    });
  } finally {
    if (!win.isDestroyed()) win.destroy();
    // Safety net — if print callback never fires (rare on some platforms),
    // still tear the window down.
    if (!finished) {
      setTimeout(() => { if (!win.isDestroyed()) win.destroy(); }, 60_000);
    }
  }
}

// ─── OS integration helpers ─────────────────────────────────
export async function openPathInOS(p: string): Promise<string> {
  return shell.openPath(p);
}

export function revealInFolder(p: string): void {
  shell.showItemInFolder(p);
}
