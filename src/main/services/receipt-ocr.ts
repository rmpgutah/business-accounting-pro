// src/main/services/receipt-ocr.ts
//
// B5 — PDF/image receipt OCR + parsing.
//
// Pipeline:
//   1. Run tesseract.js on the supplied image/PDF (offline, no
//      external API call — receipt data is sensitive).
//   2. Apply regex parsers to the raw text to extract:
//        • vendor name      (typically largest text in top region)
//        • date             (prefer near "DATE" tokens, fallback to any)
//        • total            (largest $ amount near "TOTAL"/"AMOUNT DUE")
//        • subtotal + tax   (when distinguishable)
//        • line items       (best-effort line-level extraction)
//   3. Return a structured ParsedReceipt that the renderer can
//      preview + adjust before saving as an expense.
//
// Accuracy expectation: ~70% of typical receipts come back with
// correct total + date + vendor. Line items are noisier (~50%).
// The user reviews + fixes — much faster than typing everything.

import { promises as fsp } from 'fs';
import * as path from 'path';

export interface ParsedReceipt {
  raw_text: string;
  vendor_name: string | null;
  vendor_address: string | null;
  receipt_date: string | null;     // YYYY-MM-DD
  receipt_number: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  currency: string;                // best-guess; defaults USD
  line_items: Array<{ description: string; amount: number }>;
  confidence: number;              // 0-100, average tesseract confidence
  warnings: string[];
}

let _worker: any = null;

async function getWorker(): Promise<any> {
  if (_worker) return _worker;
  // Lazy-load tesseract.js to keep app startup fast — receipt OCR
  // is invoked by user action, not at boot.
  const Tesseract = await import('tesseract.js');
  _worker = await Tesseract.createWorker('eng', 1, {
    // Quiet logger — uncomment for debugging.
    // logger: (m) => console.log('[ocr]', m),
  });
  return _worker;
}

// Common money pattern: "$1,234.56", "1234.56", "$ 1234.56"
const MONEY_REGEX = /\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/g;

// Date patterns we try in order of specificity:
const DATE_PATTERNS: Array<RegExp> = [
  /(\d{4})-(\d{1,2})-(\d{1,2})/,                 // 2026-05-15 or 2026-5-15
  /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/,             // 5/15/26 or 5/15/2026
  /(\d{1,2})-(\d{1,2})-(\d{2,4})/,               // 5-15-26
  /(\b\w+\b)\s+(\d{1,2}),?\s+(\d{2,4})/,         // May 15, 2026
];

const TOTAL_KEYWORDS = ['total', 'grand total', 'amount due', 'balance due', 'amount to pay', 'pay', 'sum'];
const SUBTOTAL_KEYWORDS = ['subtotal', 'sub total', 'sub-total'];
const TAX_KEYWORDS = ['tax', 'sales tax', 'gst', 'vat', 'hst'];

function parseMoneyToken(s: string): number | null {
  const cleaned = s.replace(/[\$,\s]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(parts: string[]): string | null {
  // Accepts year/month/day, month/day/year, "May 15 2026" — returns YYYY-MM-DD.
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  let y = 0, m = 0, d = 0;
  if (parts.length === 3) {
    const a = parts[0].toLowerCase();
    if (MONTHS[a]) { m = MONTHS[a]; d = parseInt(parts[1]); y = parseInt(parts[2]); }
    else if (parts[0].length === 4) { y = parseInt(parts[0]); m = parseInt(parts[1]); d = parseInt(parts[2]); }
    else { m = parseInt(parts[0]); d = parseInt(parts[1]); y = parseInt(parts[2]); }
    if (y < 100) y += 2000; // 26 → 2026
    if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const pad = (n: number) => n < 10 ? '0' + n : String(n);
    return y + '-' + pad(m) + '-' + pad(d);
  }
  return null;
}

function parseReceiptText(text: string, confidence: number): ParsedReceipt {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const lowercaseLines = lines.map((l) => l.toLowerCase());
  const warnings: string[] = [];
  const result: ParsedReceipt = {
    raw_text: text,
    vendor_name: null,
    vendor_address: null,
    receipt_date: null,
    receipt_number: null,
    subtotal: null,
    tax: null,
    total: null,
    currency: 'USD',
    line_items: [],
    confidence,
    warnings,
  };

  // ── Vendor: typically first non-empty line(s). Heuristic: pick
  // the longest ALL-CAPS or Title-Case line in the top 5.
  const topLines = lines.slice(0, 5);
  let vendorCandidate = topLines.find((l) => l === l.toUpperCase() && l.length >= 4 && /[A-Z]/.test(l));
  if (!vendorCandidate) vendorCandidate = topLines.sort((a, b) => b.length - a.length)[0];
  if (vendorCandidate) result.vendor_name = vendorCandidate.replace(/[^a-zA-Z0-9 &'.,-]/g, '').trim() || null;

  // ── Date: scan each line for date patterns; prefer the FIRST match
  // that looks valid (top of receipt is usually the issue date).
  for (const line of lines) {
    for (const re of DATE_PATTERNS) {
      const m = line.match(re);
      if (m) {
        const parts = [m[1], m[2], m[3]].filter(Boolean);
        const iso = normalizeDate(parts);
        if (iso) {
          result.receipt_date = iso;
          break;
        }
      }
    }
    if (result.receipt_date) break;
  }
  if (!result.receipt_date) warnings.push('Date not detected');

  // ── Total / subtotal / tax: scan for keyword + nearest money token
  for (let i = 0; i < lines.length; i++) {
    const lc = lowercaseLines[i];
    const moneyMatches = [...lines[i].matchAll(MONEY_REGEX)];
    if (moneyMatches.length === 0) continue;
    const last = moneyMatches[moneyMatches.length - 1];
    const value = parseMoneyToken(last[1]);
    if (value === null) continue;

    const isTotal = TOTAL_KEYWORDS.some((k) => lc.includes(k));
    const isSubtotal = SUBTOTAL_KEYWORDS.some((k) => lc.includes(k));
    const isTax = TAX_KEYWORDS.some((k) => lc.includes(k));

    if (isSubtotal && result.subtotal === null) result.subtotal = value;
    else if (isTax && result.tax === null) result.tax = value;
    else if (isTotal && result.total === null) result.total = value;
  }

  // Fallback for total: largest money value anywhere.
  if (result.total === null) {
    let max = 0;
    for (const line of lines) {
      for (const m of line.matchAll(MONEY_REGEX)) {
        const v = parseMoneyToken(m[1]);
        if (v !== null && v > max) max = v;
      }
    }
    if (max > 0) {
      result.total = max;
      warnings.push('Total inferred from largest money value');
    } else {
      warnings.push('Total not detected');
    }
  }

  // ── Currency hint: look for €, £, ¥ symbols
  if (text.includes('€')) result.currency = 'EUR';
  else if (text.includes('£')) result.currency = 'GBP';
  else if (text.includes('¥')) result.currency = 'JPY';

  // ── Line items: any line containing a money token + non-trivial
  // description, EXCLUDING lines we've already attributed to total/subtotal/tax.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lc = lowercaseLines[i];
    if (TOTAL_KEYWORDS.concat(SUBTOTAL_KEYWORDS, TAX_KEYWORDS).some((k) => lc.includes(k))) continue;

    const moneyMatches = [...line.matchAll(MONEY_REGEX)];
    if (moneyMatches.length === 0) continue;
    const last = moneyMatches[moneyMatches.length - 1];
    const amount = parseMoneyToken(last[1]);
    if (amount === null || amount <= 0) continue;
    // Strip the money token from the description.
    const desc = line.replace(last[0], '').replace(/[\s$]+$/, '').trim();
    if (desc.length < 2) continue;
    result.line_items.push({ description: desc, amount });
  }
  if (result.line_items.length > 20) {
    // Cap to avoid noise from heavily-OCR'd receipts.
    result.line_items = result.line_items.slice(0, 20);
    warnings.push('Line items truncated to 20');
  }

  return result;
}

/**
 * Main entry point — runs OCR on a file path and returns the parsed receipt.
 * Supported: PNG, JPG, JPEG, BMP, PBM, WEBP, GIF, TIFF (per tesseract).
 * For PDFs, the renderer should rasterize to PNG first (Electron's
 * webContents.printToPDF can do the inverse but rasterization needs
 * a PDF-renderer; deferred for a follow-up).
 */
export async function scanReceipt(filePath: string): Promise<ParsedReceipt> {
  // Read the file into memory; tesseract.js accepts a Buffer.
  const buf = await fsp.readFile(filePath);
  const worker = await getWorker();
  const result = await worker.recognize(buf);
  const text = result.data.text || '';
  const confidence = Math.round(result.data.confidence || 0);
  return parseReceiptText(text, confidence);
}

/**
 * Cleanup — call on app shutdown to release the tesseract worker.
 */
export async function shutdownOCR(): Promise<void> {
  if (_worker) {
    try { await _worker.terminate(); } catch { /* ignore */ }
    _worker = null;
  }
}
