/**
 * Print Preview Window Service
 * Opens HTML content in a dedicated preview window with Print / Save PDF / Close toolbar.
 */
import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';

// ─── Wrap HTML content with a sticky toolbar ────────────────
function wrapWithToolbar(html: string, title: string): string {
  // Strip existing <html>/<head>/<body> wrappers so we can inject our own
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const headMatch = html.match(/<head[^>]*>([\s\S]*)<\/head>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;
  const headContent = headMatch ? headMatch[1] : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  ${headContent}
  <style>
    /* ── Toolbar ──────────────────────────────── */
    .pp-toolbar {
      position: sticky;
      top: 0;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 20px;
      background: #1a1a1a;
      border-bottom: 1px solid #333;
      font-family: -apple-system, system-ui, sans-serif;
      -webkit-app-region: drag;
    }
    .pp-toolbar-title {
      font-size: 13px;
      font-weight: 600;
      color: #e0e0e0;
      letter-spacing: -0.2px;
    }
    .pp-toolbar-actions {
      display: flex;
      gap: 8px;
      -webkit-app-region: no-drag;
    }
    .pp-toolbar-btn {
      padding: 6px 16px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid #444;
      background: #2a2a2a;
      color: #e0e0e0;
      cursor: pointer;
      border-radius: 2px;
      transition: background 0.15s;
    }
    .pp-toolbar-btn:hover { background: #3a3a3a; }
    .pp-toolbar-btn-primary {
      background: #3b82f6;
      border-color: #3b82f6;
      color: #fff;
    }
    .pp-toolbar-btn-primary:hover { background: #2563eb; }

    /* ── Hide toolbar when printing ──────────── */
    @media print {
      .pp-toolbar { display: none !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#fff;">
  <div class="pp-toolbar">
    <span class="pp-toolbar-title">${title}</span>
    <div class="pp-toolbar-actions">
      <button class="pp-toolbar-btn" onclick="window.close()">Close</button>
      <button class="pp-toolbar-btn" id="pp-save-pdf">Save as PDF</button>
      <button class="pp-toolbar-btn pp-toolbar-btn-primary" id="pp-print">Print</button>
    </div>
  </div>
  ${bodyContent}
  <script>
    document.getElementById('pp-print').addEventListener('click', () => {
      window.print();
    });
    document.getElementById('pp-save-pdf').addEventListener('click', () => {
      // Signal main process via IPC (we use postMessage trick with a custom protocol)
      if (window.__ppSavePDF) window.__ppSavePDF();
    });
  </script>
</body>
</html>`;
}

// ─── Open a print-preview window ────────────────────────────
export function openPrintPreview(htmlContent: string, title: string): void {
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
      preload: undefined,
    },
  });

  const wrappedHTML = wrapWithToolbar(htmlContent, title);

  previewWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(wrappedHTML)}`);

  // Inject the save-PDF callback after the page loads
  previewWin.webContents.on('did-finish-load', () => {
    previewWin.webContents.executeJavaScript(`
      window.__ppSavePDF = () => {
        document.title = '__PP_SAVE_PDF__';
      };
    `);
  });

  // Listen for title change as a signal to save PDF
  previewWin.on('page-title-updated', async (event, newTitle) => {
    if (newTitle === '__PP_SAVE_PDF__') {
      event.preventDefault();
      try {
        const { filePath } = await dialog.showSaveDialog(previewWin, {
          defaultPath: `${title.replace(/[^a-zA-Z0-9-_ ]/g, '')}.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (!filePath) return;
        const pdfData = await previewWin.webContents.printToPDF({
          pageSize: 'Letter',
          margins: { top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 },
          printBackground: true,
        });
        fs.writeFileSync(filePath, Buffer.from(pdfData));
      } catch (err) {
        console.error('Print preview save-pdf error:', err);
      }
      // Restore original title
      previewWin.webContents.executeJavaScript(`document.title = ${JSON.stringify(title)};`);
    }
  });
}

// ─── Save HTML as PDF (headless — no preview window) ────────
export async function saveHTMLAsPDF(htmlContent: string, title: string): Promise<string> {
  const { filePath } = await dialog.showSaveDialog({
    defaultPath: `${title.replace(/[^a-zA-Z0-9-_ ]/g, '')}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });

  if (!filePath) return '';

  const win = new BrowserWindow({ show: false, width: 800, height: 1100 });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
    const pdfData = await win.webContents.printToPDF({
      pageSize: 'Letter',
      margins: { top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 },
      printBackground: true,
    });
    fs.writeFileSync(filePath, Buffer.from(pdfData));
    return filePath;
  } finally {
    win.close();
  }
}

// ─── Print HTML (opens system print dialog) ─────────────────
export async function printHTML(htmlContent: string): Promise<void> {
  const win = new BrowserWindow({ show: false, width: 800, height: 1100 });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
    win.webContents.print({ silent: false, printBackground: true });
  } catch (err) {
    win.close();
    throw err;
  }
  // The window will stay open while the print dialog is active; close on did-finish-load or after print
  win.webContents.on('did-finish-load', () => {
    // already loaded
  });
  // Close after a reasonable delay to let the print dialog open
  setTimeout(() => {
    if (!win.isDestroyed()) win.close();
  }, 60000);
}
