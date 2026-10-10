import { dialog, shell } from 'electron';
import type { IpcMain } from 'electron';
import os from 'os';
import path from 'path';
import { promises as fsp } from 'fs';
import * as db from '../../database';
import { generateInvoicePDF, buildInvoiceHTML } from '../../services/pdf-generator';
import { sendInvoiceEmail } from '../../services/email-sender';
import {
  openPrintPreview,
  saveHTMLAsPDF,
  printHTML,
  htmlToPDFBuffer,
  buildPdfFilename,
  openPathInOS,
  revealInFolder,
  type PDFOptions,
} from '../../services/print-preview';
import type { IpcDeps } from '../core/types';

export function registerPrintPdfIpc(ipcMain: IpcMain, deps: IpcDeps): void {
  const {
    scheduleAutoBackup,
    buildInvoiceMetadata,
    ensureDefaultEmailTemplates,
    resolveTemplateTokens,
    buildTemplateContext,
  } = deps;

  ipcMain.handle(
    'tax:export-form-pdf',
    async (
      _event,
      payload: {
        form:
          | '941'
          | 'schedule-c'
          | '1099-nec'
          | 'w2'
          | 'schedule-se'
          | 'sales-tax'
          | 'w3'
          | '940'
          | '1099-misc'
          | '944'
          | '945'
          | 'schedule-941b'
          | '945-a'
          | '1099-int'
          | '1099-div'
          | '1099-r'
          | '1099-k'
          | '1099-b'
          | '1099-g'
          | '1099-c'
          | '1099-sa'
          | 'w2c'
          | '1096'
          | 'schedule-1'
          | 'schedule-2'
          | 'schedule-3'
          | 'schedule-a'
          | 'schedule-b'
          | 'schedule-d'
          | '1040-es'
          | '8995'
          | '4562'
          | '8829'
          | '4797'
          | '7004'
          | '4868'
          | '1065'
          | '1120'
          | '1120-s'
          | 'k-1'
          | '1041'
          | '1094-c'
          | '1095-c'
          | 'ss-4'
          | '2553'
          | '8832'
          | '8822-b'
          | 'tc-40'
          | 'tc-20'
          | 'tc-20s'
          | 'tc-65'
          | 'tc-62m'
          | 'tc-941';
        year: number;
        quarter?: 1 | 2 | 3 | 4;
        period_start?: string;
        period_end?: string;
        w2_ss_wages?: number;
        multi_state?: boolean;
        credit_reduction_state?: boolean;
        total_deposits?: number;
        form_945_opts?: any;
        parent_form?: 'form-944' | 'form-945' | 'form-941';
        w2c_corrections?: any[];
        w2c_form_index?: number;
        schedule_opts?: any;
        es_opts?: any;
        form_8995_opts?: any;
        form_4562_opts?: any;
        form_8829_opts?: any;
        form_4797_opts?: any;
        form_7004_opts?: any;
        form_4868_opts?: any;
        form_1065_opts?: any;
        form_1120_opts?: any;
        form_1120s_opts?: any;
        form_1041_opts?: any;
        k1_opts?: any;
      },
    ) => {
      try {
        const cid = db.getCurrentCompanyId();
        if (!cid) return { error: 'No active company' };
        const company = db.getById('companies', cid) || {};
        const {
          form941HTML,
          scheduleCHTML,
          nec1099HTML,
          w2HTML,
          scheduleSEHTML,
          salesTaxHTML,
          w3HTML,
          form940HTML,
          misc1099HTML,
          form944HTML,
          form945HTML,
          schedule941BHTML,
          form945AHTML,
          int1099HTML,
          div1099HTML,
          r1099HTML,
          k1099HTML,
          b1099HTML,
          g1099HTML,
          c1099HTML,
          sa1099HTML,
          w2cHTML,
          form1096HTML,
          schedule1HTML,
          schedule2HTML,
          schedule3HTML,
          scheduleAHTML,
          scheduleBHTML,
          scheduleDHTML,
          form1040ESHTML,
          form8995HTML,
          form4562HTML,
          form8829HTML,
          form4797HTML,
          form7004HTML,
          form4868HTML,
          form1065HTML,
          form1120HTML,
          form1120SHTML,
          scheduleK1HTML,
          form1041HTML,
          form1094CHTML,
          form1095CHTML,
          formSS4HTML,
          form2553HTML,
          form8832HTML,
          form8822BHTML,
          tc40HTML,
          tc20HTML,
          tc20SHTML,
          tc65HTML,
          tc62MHTML,
          tc941HTML,
        } = require('../../services/tax-forms/pdf-templates');
        let html = '';
        let filename = 'tax-form.pdf';

        if (payload.form === '941') {
          const { computeForm941 } = require('../../services/tax-forms/form-941');
          const data = computeForm941(cid, payload.year, payload.quarter || 1);
          html = form941HTML(data);
          filename = 'form-941-Q' + (payload.quarter || 1) + '-' + payload.year + '.pdf';
        } else if (payload.form === 'schedule-c') {
          const { computeScheduleC } = require('../../services/tax-forms/schedule-c');
          const data = computeScheduleC(cid, payload.year);
          html = scheduleCHTML(data);
          filename = 'schedule-c-' + payload.year + '.pdf';
        } else if (payload.form === '1099-nec') {
          const { compute1099NECs } = require('../../services/tax-forms/form-1099-nec');
          const data = compute1099NECs(cid, payload.year);
          html = nec1099HTML(data, payload.year, {
            name: company.name || '',
            ein: company.ein || '',
          });
          filename = '1099-NEC-' + payload.year + '.pdf';
        } else if (payload.form === 'w2') {
          const { computeW2sForYear } = require('../../services/tax-forms/form-w2');
          const data = computeW2sForYear(cid, payload.year);
          html = w2HTML(data, payload.year, { name: company.name || '', ein: company.ein || '' });
          filename = 'W-2-' + payload.year + '.pdf';
        } else if (payload.form === 'schedule-se') {
          const { computeScheduleSE } = require('../../services/tax-forms/schedule-se');
          const data = computeScheduleSE(cid, payload.year, { w2_ss_wages: payload.w2_ss_wages });
          html = scheduleSEHTML(data);
          filename = 'schedule-se-' + payload.year + '.pdf';
        } else if (payload.form === 'sales-tax') {
          const { computeSalesTax } = require('../../services/tax-forms/sales-tax');
          const data = computeSalesTax(cid, payload.period_start || '', payload.period_end || '');
          html = salesTaxHTML(data);
          filename =
            'sales-tax-' + (payload.period_start || '') + '-' + (payload.period_end || '') + '.pdf';
        } else if (payload.form === 'w3') {
          const { computeW3 } = require('../../services/tax-forms/form-w3');
          const data = computeW3(cid, payload.year);
          html = w3HTML(data);
          filename = 'W-3-' + payload.year + '.pdf';
        } else if (payload.form === '940') {
          const { computeForm940 } = require('../../services/tax-forms/form-940');
          const data = computeForm940(cid, payload.year, {
            multi_state: payload.multi_state,
            credit_reduction_state: payload.credit_reduction_state,
            total_deposits: payload.total_deposits,
          });
          html = form940HTML(data);
          filename = 'form-940-' + payload.year + '.pdf';
        } else if (payload.form === '1099-misc') {
          const { compute1099MISCs } = require('../../services/tax-forms/form-1099-misc');
          const data = compute1099MISCs(cid, payload.year);
          html = misc1099HTML(data, payload.year, {
            name: company.name || '',
            ein: company.ein || '',
          });
          filename = '1099-MISC-' + payload.year + '.pdf';
        } else if (payload.form === '944') {
          const { computeForm944 } = require('../../services/tax-forms/form-944');
          const data = computeForm944(cid, payload.year);
          html = form944HTML(data);
          filename = 'form-944-' + payload.year + '.pdf';
        } else if (payload.form === '945') {
          const { computeForm945 } = require('../../services/tax-forms/form-945');
          const data = computeForm945(cid, payload.year, payload.form_945_opts || {});
          html = form945HTML(data);
          filename = 'form-945-' + payload.year + '.pdf';
        } else if (payload.form === 'schedule-941b') {
          const { computeSchedule941B } = require('../../services/tax-forms/form-941-schedule-b');
          const data = computeSchedule941B(cid, payload.year, payload.quarter || 1);
          html = schedule941BHTML(data);
          filename = 'form-941-schedule-b-Q' + (payload.quarter || 1) + '-' + payload.year + '.pdf';
        } else if (payload.form === '945-a') {
          const { computeForm945A } = require('../../services/tax-forms/form-945-a');
          const data = computeForm945A(cid, payload.year, payload.parent_form || 'form-945');
          html = form945AHTML(data);
          filename = 'form-945-a-' + payload.year + '.pdf';
        } else if (payload.form === '1099-int') {
          const { compute1099INTs } = require('../../services/tax-forms/form-1099-int');
          const data = compute1099INTs(cid, payload.year);
          html = int1099HTML(data, payload.year, {
            name: company.name || '',
            ein: company.ein || '',
          });
          filename = '1099-INT-' + payload.year + '.pdf';
        } else if (payload.form === '1099-div') {
          const { compute1099DIVs } = require('../../services/tax-forms/form-1099-div');
          const data = compute1099DIVs(cid, payload.year);
          html = div1099HTML(data, payload.year, {
            name: company.name || '',
            ein: company.ein || '',
          });
          filename = '1099-DIV-' + payload.year + '.pdf';
        } else if (payload.form === '1099-r') {
          const { compute1099Rs } = require('../../services/tax-forms/form-1099-r');
          const data = compute1099Rs(cid, payload.year);
          html = r1099HTML(data, payload.year, {
            name: company.name || '',
            ein: company.ein || '',
          });
          filename = '1099-R-' + payload.year + '.pdf';
        } else if (payload.form === '1099-k') {
          const { compute1099Ks } = require('../../services/tax-forms/form-1099-k');
          const data = compute1099Ks(cid, payload.year);
          html = k1099HTML(data, payload.year, {
            name: company.name || '',
            ein: company.ein || '',
          });
          filename = '1099-K-' + payload.year + '.pdf';
        } else if (payload.form === '1099-b') {
          const { compute1099Bs } = require('../../services/tax-forms/form-1099-other');
          const data = compute1099Bs(cid, payload.year);
          html = b1099HTML(data, payload.year, {
            name: company.name || '',
            ein: company.ein || '',
          });
          filename = '1099-B-' + payload.year + '.pdf';
        } else if (payload.form === '1099-g') {
          const { compute1099Gs } = require('../../services/tax-forms/form-1099-other');
          const data = compute1099Gs(cid, payload.year);
          html = g1099HTML(data, payload.year, {
            name: company.name || '',
            ein: company.ein || '',
          });
          filename = '1099-G-' + payload.year + '.pdf';
        } else if (payload.form === '1099-c') {
          const { compute1099Cs } = require('../../services/tax-forms/form-1099-other');
          const data = compute1099Cs(cid, payload.year);
          html = c1099HTML(data, payload.year, {
            name: company.name || '',
            ein: company.ein || '',
          });
          filename = '1099-C-' + payload.year + '.pdf';
        } else if (payload.form === '1099-sa') {
          const { compute1099SAs } = require('../../services/tax-forms/form-1099-other');
          const data = compute1099SAs(cid, payload.year);
          html = sa1099HTML(data, payload.year, {
            name: company.name || '',
            ein: company.ein || '',
          });
          filename = '1099-SA-' + payload.year + '.pdf';
        } else if (payload.form === 'w2c') {
          const { computeW2Cs } = require('../../services/tax-forms/form-w2c');
          const data = computeW2Cs(cid, payload.year, payload.w2c_corrections || []);
          if (data.length === 0) return { error: 'No W-2c corrections specified.' };
          const idx = Math.max(0, Math.min(data.length - 1, payload.w2c_form_index || 0));
          html = w2cHTML(data[idx]);
          filename =
            'W-2c-' +
            (data[idx].prev.employee_last_name || 'unknown') +
            '-' +
            payload.year +
            '.pdf';
        } else if (payload.form === '1096') {
          const { computeForm1096 } = require('../../services/tax-forms/form-1096');
          const data = computeForm1096(cid, payload.year);
          html = form1096HTML(data);
          filename = 'form-1096-' + payload.year + '.pdf';
        } else if (payload.form === 'schedule-1') {
          const { computeSchedule1 } = require('../../services/tax-forms/schedule-1');
          const data = computeSchedule1(cid, payload.year, payload.schedule_opts || {});
          html = schedule1HTML(data);
          filename = 'schedule-1-' + payload.year + '.pdf';
        } else if (payload.form === 'schedule-2') {
          const { computeSchedule2 } = require('../../services/tax-forms/schedule-2');
          const data = computeSchedule2(cid, payload.year, payload.schedule_opts || {});
          html = schedule2HTML(data);
          filename = 'schedule-2-' + payload.year + '.pdf';
        } else if (payload.form === 'schedule-3') {
          const { computeSchedule3 } = require('../../services/tax-forms/schedule-3');
          const data = computeSchedule3(cid, payload.year);
          html = schedule3HTML(data);
          filename = 'schedule-3-' + payload.year + '.pdf';
        } else if (payload.form === 'schedule-a') {
          const { computeScheduleA } = require('../../services/tax-forms/schedule-a');
          const data = computeScheduleA(cid, payload.year, payload.schedule_opts || {});
          html = scheduleAHTML(data);
          filename = 'schedule-a-' + payload.year + '.pdf';
        } else if (payload.form === 'schedule-b') {
          const { computeScheduleB } = require('../../services/tax-forms/schedule-b');
          const data = computeScheduleB(cid, payload.year, payload.schedule_opts || {});
          html = scheduleBHTML(data);
          filename = 'schedule-b-' + payload.year + '.pdf';
        } else if (payload.form === 'schedule-d') {
          const { computeScheduleD } = require('../../services/tax-forms/schedule-d');
          const data = computeScheduleD(cid, payload.year, payload.schedule_opts || {});
          html = scheduleDHTML(data);
          filename = 'schedule-d-' + payload.year + '.pdf';
        } else if (payload.form === '1040-es') {
          const { computeForm1040ES } = require('../../services/tax-forms/form-1040-es');
          const data = computeForm1040ES(cid, payload.year, payload.es_opts || {});
          html = form1040ESHTML(data);
          filename = 'form-1040-es-' + payload.year + '.pdf';
        } else if (payload.form === '8995') {
          const { computeForm8995 } = require('../../services/tax-forms/form-8995');
          const data = computeForm8995(cid, payload.year, payload.form_8995_opts || {});
          html = form8995HTML(data);
          filename = 'form-8995-' + payload.year + '.pdf';
        } else if (payload.form === '4562') {
          const { computeForm4562 } = require('../../services/tax-forms/form-4562');
          const data = computeForm4562(cid, payload.year, payload.form_4562_opts || {});
          html = form4562HTML(data);
          filename = 'form-4562-' + payload.year + '.pdf';
        } else if (payload.form === '8829') {
          const { computeForm8829 } = require('../../services/tax-forms/form-8829');
          const data = computeForm8829(cid, payload.year, payload.form_8829_opts || {});
          html = form8829HTML(data);
          filename = 'form-8829-' + payload.year + '.pdf';
        } else if (payload.form === '4797') {
          const { computeForm4797 } = require('../../services/tax-forms/form-4797');
          const data = computeForm4797(cid, payload.year, payload.form_4797_opts || {});
          html = form4797HTML(data);
          filename = 'form-4797-' + payload.year + '.pdf';
        } else if (payload.form === '7004') {
          const { computeForm7004 } = require('../../services/tax-forms/form-7004');
          const data = computeForm7004(cid, payload.form_7004_opts);
          html = form7004HTML(data);
          filename = 'form-7004-' + payload.year + '.pdf';
        } else if (payload.form === '4868') {
          const { computeForm4868 } = require('../../services/tax-forms/form-4868');
          const data = computeForm4868(cid, payload.year, payload.form_4868_opts || {});
          html = form4868HTML(data);
          filename = 'form-4868-' + payload.year + '.pdf';
        } else if (payload.form === '1065') {
          const { computeForm1065 } = require('../../services/tax-forms/form-1065');
          const data = computeForm1065(cid, payload.year, payload.form_1065_opts || {});
          html = form1065HTML(data);
          filename = 'form-1065-' + payload.year + '.pdf';
        } else if (payload.form === '1120') {
          const { computeForm1120 } = require('../../services/tax-forms/form-1120');
          const data = computeForm1120(cid, payload.year, payload.form_1120_opts || {});
          html = form1120HTML(data);
          filename = 'form-1120-' + payload.year + '.pdf';
        } else if (payload.form === '1120-s') {
          const { computeForm1120S } = require('../../services/tax-forms/form-1120s');
          const data = computeForm1120S(cid, payload.year, payload.form_1120s_opts || {});
          html = form1120SHTML(data);
          filename = 'form-1120s-' + payload.year + '.pdf';
        } else if (payload.form === 'k-1') {
          const { computeScheduleK1 } = require('../../services/tax-forms/schedule-k1');
          const data = computeScheduleK1(payload.k1_opts);
          html = scheduleK1HTML(data);
          filename =
            'k-1-' +
            (payload.k1_opts?.recipient?.name || 'recipient').replace(/\s+/g, '_') +
            '.pdf';
        } else if (payload.form === '1041') {
          const { computeForm1041 } = require('../../services/tax-forms/form-1041');
          const data = computeForm1041(cid, payload.year, payload.form_1041_opts || {});
          html = form1041HTML(data);
          filename = 'form-1041-' + payload.year + '.pdf';
        } else if (payload.form === '1094-c') {
          const { computeForm1094C } = require('../../services/tax-forms/form-1094c');
          const data = computeForm1094C(cid, payload.year, (payload as any).form_1094c_opts || {});
          html = form1094CHTML(data);
          filename = 'form-1094-c-' + payload.year + '.pdf';
        } else if (payload.form === '1095-c') {
          const { computeForm1095C } = require('../../services/tax-forms/form-1095c');
          const data = computeForm1095C(
            cid,
            (payload as any).form_1095c_opts || { employee_id: '' },
          );
          html = form1095CHTML(data);
          filename = '1095-C-' + payload.year + '.pdf';
        } else if (payload.form === 'ss-4') {
          const { computeFormSS4 } = require('../../services/tax-forms/entity-lifecycle');
          const data = computeFormSS4(cid, (payload as any).form_ss4_opts || {});
          html = formSS4HTML(data);
          filename = 'form-ss-4.pdf';
        } else if (payload.form === '2553') {
          const { computeForm2553 } = require('../../services/tax-forms/entity-lifecycle');
          const data = computeForm2553(cid, (payload as any).form_2553_opts || {});
          html = form2553HTML(data);
          filename = 'form-2553.pdf';
        } else if (payload.form === '8832') {
          const { computeForm8832 } = require('../../services/tax-forms/entity-lifecycle');
          const data = computeForm8832(cid, (payload as any).form_8832_opts || {});
          html = form8832HTML(data);
          filename = 'form-8832.pdf';
        } else if (payload.form === '8822-b') {
          const { computeForm8822B } = require('../../services/tax-forms/entity-lifecycle');
          const data = computeForm8822B(cid, (payload as any).form_8822b_opts || {});
          html = form8822BHTML(data);
          filename = 'form-8822-b.pdf';
        } else if (payload.form === 'tc-40') {
          const { computeTC40 } = require('../../services/tax-forms/utah-forms');
          const data = computeTC40(cid, payload.year, (payload as any).tc40_opts || {});
          html = tc40HTML(data);
          filename = 'utah-tc-40-' + payload.year + '.pdf';
        } else if (payload.form === 'tc-20') {
          const { computeTC20 } = require('../../services/tax-forms/utah-forms');
          const data = computeTC20(cid, payload.year, (payload as any).tc20_opts || {});
          html = tc20HTML(data);
          filename = 'utah-tc-20-' + payload.year + '.pdf';
        } else if (payload.form === 'tc-20s') {
          const { computeTC20S } = require('../../services/tax-forms/utah-forms');
          const data = computeTC20S(cid, payload.year, (payload as any).tc20s_opts || {});
          html = tc20SHTML(data);
          filename = 'utah-tc-20s-' + payload.year + '.pdf';
        } else if (payload.form === 'tc-65') {
          const { computeTC65 } = require('../../services/tax-forms/utah-forms');
          const data = computeTC65(cid, payload.year, (payload as any).tc65_opts || {});
          html = tc65HTML(data);
          filename = 'utah-tc-65-' + payload.year + '.pdf';
        } else if (payload.form === 'tc-62m') {
          const { computeTC62M } = require('../../services/tax-forms/utah-forms');
          const data = computeTC62M(
            cid,
            payload.year,
            (payload as any).tc62m_period_start || payload.year + '-01-01',
            (payload as any).tc62m_period_end || payload.year + '-12-31',
            (payload as any).tc62m_opts || {},
          );
          html = tc62MHTML(data);
          filename = 'utah-tc-62m-' + payload.year + '.pdf';
        } else if (payload.form === 'tc-941') {
          const { computeTC941 } = require('../../services/tax-forms/utah-forms');
          const data = computeTC941(cid, payload.year, (payload as any).tc941_opts || {});
          html = tc941HTML(data);
          filename = 'utah-tc-941-' + payload.year + '.pdf';
        } else {
          return { error: 'Unknown form: ' + payload.form };
        }
        return await saveHTMLAsPDF(html, payload.form.toUpperCase(), { defaultFilename: filename });
      } catch (err: any) {
        return { error: err?.message || 'PDF export failed' };
      }
    },
  );

  // ─── PDF Generate (Invoice) — Download via Save Dialog ──
  // Accepts optional pre-built HTML from the renderer so the saved PDF
  // matches the preview exactly (including settings, payment schedule, etc.)
  ipcMain.handle(
    'invoice:generate-pdf',
    async (
      _event,
      payload:
        | string
        | {
            invoiceId: string;
            html?: string;
            pdfOptions?: PDFOptions;
            openAfterSave?: boolean;
            revealAfterSave?: boolean;
          },
    ) => {
      const invoiceId = typeof payload === 'string' ? payload : payload.invoiceId;
      const providedHTML = typeof payload === 'string' ? undefined : payload.html;
      const pdfOptions = typeof payload === 'string' ? undefined : payload.pdfOptions;
      const openAfterSave = typeof payload === 'string' ? false : !!payload.openAfterSave;
      const revealAfterSave = typeof payload === 'string' ? false : !!payload.revealAfterSave;

      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { error: 'No company selected' };

      const invoice = db.getById('invoices', invoiceId);
      if (!invoice) return { error: 'Invoice not found' };

      // Default filename: invoice-{number}-{yyyy-MM-dd}.pdf
      const defaultName = buildPdfFilename('invoice', String(invoice.invoice_number || invoiceId));
      const { filePath, canceled } = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        // showOverwriteConfirmation defaults to true, but be explicit for clarity.
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      });

      if (canceled || !filePath) return { cancelled: true };

      try {
        // Build PDF metadata once — reused whether HTML is renderer-provided
        // or generated server-side. Sets Title/Author/Subject/Keywords on
        // the saved PDF for Spotlight + Adobe File → Properties visibility.
        const _client = db.getById('clients', invoice.client_id);
        const _company = db.getById('companies', companyId);
        const meta = buildInvoiceMetadata(invoice, _company, _client);
        const optsWithMeta = { ...(pdfOptions || {}), metadata: meta };

        let pdfBuffer: Buffer;
        if (providedHTML) {
          pdfBuffer = await htmlToPDFBuffer(providedHTML, optsWithMeta);
        } else {
          const dbInstance = db.getDb();
          const lineItems = dbInstance
            .prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order')
            .all(invoiceId) as any[];
          pdfBuffer = await generateInvoicePDF(invoice, _company, _client, lineItems, optsWithMeta);
        }
        // Async write — caller must not see "saved" before bytes are on disk.
        await fsp.writeFile(filePath, pdfBuffer);

        // Compliance: log PDF export of a financial document.
        try {
          db.logAudit(companyId, 'invoices', invoiceId, 'export_pdf', { path: filePath });
        } catch {
          /* audit is best-effort */
        }

        if (openAfterSave) {
          const openErr = await openPathInOS(filePath);
          if (openErr) console.warn('openPath failed:', openErr);
        } else if (revealAfterSave) {
          revealInFolder(filePath);
        }

        return { path: filePath };
      } catch (err: any) {
        // Surface disk-full / permission-denied / EACCES to the renderer.
        return { error: err?.message || 'PDF generation failed' };
      }
    },
  );

  // ─── Batch PDF Export ──────────────────────────────────
  ipcMain.handle(
    'invoice:batch-pdf',
    async (
      event,
      {
        invoiceIds,
        pdfOptions,
        mode,
      }: {
        invoiceIds: string[];
        pdfOptions?: PDFOptions;
        // 'combined' = single PDF with page breaks
        // 'separate' = one PDF per invoice into a folder
        // 'zip'      = one PDF per invoice, packaged into a single ZIP archive
        mode?: 'combined' | 'separate' | 'zip';
      },
    ) => {
      try {
        const companyId = db.getCurrentCompanyId();
        if (!companyId) return { error: 'No company selected' };
        if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
          return { error: 'No invoices selected' };
        }

        const dbInstance = db.getDb();
        const company = db.getById('companies', companyId);

        // Progress helper — stream to the caller so a long batch shows a bar.
        const sendProgress = (current: number, total: number, label: string) => {
          try {
            event.sender.send('invoice:batch-pdf:progress', { current, total, label });
          } catch {
            /* receiver may be gone */
          }
        };

        if (mode === 'separate') {
          // Ask for a directory; write one PDF per invoice, serially.
          const { filePaths, canceled } = await dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
          });
          if (canceled || !filePaths?.[0]) return { cancelled: true };
          const outDir = filePaths[0];
          const written: string[] = [];
          for (let i = 0; i < invoiceIds.length; i++) {
            const invId = invoiceIds[i];
            const invoice = db.getById('invoices', invId);
            if (!invoice) continue;
            const client = db.getById('clients', invoice.client_id);
            const lineItems = dbInstance
              .prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order')
              .all(invId) as any[];
            const html = buildInvoiceHTML(company, client, invoice, lineItems);
            sendProgress(i + 1, invoiceIds.length, `Invoice ${invoice.invoice_number}`);
            // Serialize — printToPDF is heavy, racing many in parallel OOMs Electron.
            const buf = await htmlToPDFBuffer(html, pdfOptions);
            const name = buildPdfFilename('invoice', String(invoice.invoice_number || invId));
            const full = path.join(outDir, name);
            await fsp.writeFile(full, buf);
            written.push(full);
            try {
              db.logAudit(companyId, 'invoices', invId, 'export_pdf', { path: full, batch: true });
            } catch {
              /* audit best-effort */
            }
          }
          return { dir: outDir, files: written, count: written.length };
        }

        // ── ZIP mode (P1.8) ──────────────────────────────────
        // One PDF per invoice, streamed into a single .zip archive
        // via the `archiver` library. Streaming avoids holding all PDF
        // buffers in memory at once — critical for batches of 100+
        // invoices where each PDF could be 100-300KB.
        if (mode === 'zip') {
          const archiver = (await import('archiver')).default;
          const fs = require('fs');
          const defaultZipName = buildPdfFilename('invoices', String(invoiceIds.length)).replace(
            /\.pdf$/,
            '.zip',
          );
          const { filePath: zipPath, canceled } = await dialog.showSaveDialog({
            defaultPath: defaultZipName,
            filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
            properties: ['showOverwriteConfirmation', 'createDirectory'],
          });
          if (canceled || !zipPath) return { cancelled: true };

          const output = fs.createWriteStream(zipPath);
          const archive = archiver('zip', { zlib: { level: 6 } }); // PDFs compress poorly; level 6 is the speed/ratio sweet spot
          archive.pipe(output);

          // We need to await the stream finish AFTER all entries are appended.
          // Track this so the IPC handler resolves only when the file is closed.
          const closePromise = new Promise<void>((resolve, reject) => {
            output.on('close', () => resolve());
            output.on('error', reject);
            archive.on('error', reject);
          });

          const written: string[] = [];
          const skipped: string[] = [];

          for (let i = 0; i < invoiceIds.length; i++) {
            const invId = invoiceIds[i];
            const invoice = db.getById('invoices', invId);
            if (!invoice) {
              skipped.push(invId);
              continue;
            }
            const client = db.getById('clients', invoice.client_id);
            const lineItems = dbInstance
              .prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order')
              .all(invId) as any[];
            sendProgress(i + 1, invoiceIds.length, `Invoice ${invoice.invoice_number}`);
            try {
              const html = buildInvoiceHTML(company, client, invoice, lineItems);
              const meta = buildInvoiceMetadata(invoice, company, client);
              const buf = await htmlToPDFBuffer(html, { ...(pdfOptions || {}), metadata: meta });
              const entryName = buildPdfFilename(
                'invoice',
                String(invoice.invoice_number || invId),
              );
              archive.append(buf, { name: entryName });
              written.push(entryName);
              try {
                db.logAudit(companyId, 'invoices', invId, 'export_pdf', {
                  archive: zipPath,
                  entry: entryName,
                  batch: true,
                });
              } catch {
                /* audit best-effort */
              }
            } catch (renderErr: any) {
              // Don't abort the whole archive on a single render failure —
              // log the skip and continue. Caller sees `skipped[]` count.
              console.warn(`[batch-pdf:zip] render failed for ${invId}:`, renderErr?.message);
              skipped.push(invId);
            }
          }

          await archive.finalize();
          await closePromise;
          return { path: zipPath, count: written.length, skipped: skipped.length };
        }

        // Combined mode
        const defaultName = buildPdfFilename('invoices-batch', String(invoiceIds.length));
        const { filePath, canceled } = await dialog.showSaveDialog({
          defaultPath: defaultName,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
          properties: ['showOverwriteConfirmation', 'createDirectory'],
        });
        if (canceled || !filePath) return { cancelled: true };

        const allHtml: string[] = [];
        const processedIds: string[] = [];
        for (let i = 0; i < invoiceIds.length; i++) {
          const invId = invoiceIds[i];
          const invoice = db.getById('invoices', invId);
          if (!invoice) continue;
          const client = db.getById('clients', invoice.client_id);
          const lineItems = dbInstance
            .prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order')
            .all(invId) as any[];
          sendProgress(i + 1, invoiceIds.length, `Invoice ${invoice.invoice_number}`);
          allHtml.push(buildInvoiceHTML(company, client, invoice, lineItems));
          processedIds.push(invId);
        }

        const combinedHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        @media print { .page-break { page-break-before: always; } }
        .page-break { page-break-before: always; }
      </style></head><body>
        ${allHtml
          .map((h, i) => {
            const body = h.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || h;
            return i === 0 ? body : `<div class="page-break"></div>${body}`;
          })
          .join('')}
      </body></html>`;

        const pdfBuffer = await htmlToPDFBuffer(combinedHTML, pdfOptions);
        await fsp.writeFile(filePath, pdfBuffer);
        for (const id of processedIds) {
          try {
            db.logAudit(companyId, 'invoices', id, 'export_pdf', { path: filePath, batch: true });
          } catch {
            /* audit best-effort */
          }
        }
        return { path: filePath, count: allHtml.length };
      } catch (err: any) {
        return { error: err?.message || 'Batch PDF failed' };
      }
    },
  );

  // ─── Email Invoice ─────────────────────────────────────
  // Accepts optional pre-built HTML from the renderer so the PDF attachment
  // matches what the user sees in the preview (including logo, accent color,
  // template style, column config, payment schedule, watermark, footer).
  // Falls back to the server-side template only if no HTML is provided.
  ipcMain.handle(
    'invoice:send-email',
    async (
      _event,
      payload: string | { invoiceId: string; html?: string; templateKey?: string },
    ) => {
      // Back-compat: old callers passed the invoiceId as a bare string.
      const invoiceId = typeof payload === 'string' ? payload : payload.invoiceId;
      const providedHTML = typeof payload === 'string' ? undefined : payload.html;
      // Template selection: caller can pick invoice_send / payment_reminder_1 /
      // payment_reminder_2 / overdue_notice. Defaults to invoice_send for the
      // common "Send invoice" button. Falls back to hardcoded copy if the
      // template lookup fails (e.g. brand-new company before seeding).
      const templateKey =
        (typeof payload === 'string' ? undefined : payload.templateKey) || 'invoice_send';

      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { error: 'No company selected' };

      const dbInstance = db.getDb();
      const invoice = db.getById('invoices', invoiceId);
      if (!invoice) return { error: 'Invoice not found' };

      const client = db.getById('clients', invoice.client_id);
      const company = db.getById('companies', companyId);

      try {
        // Generate PDF to temp location — prefer renderer-built HTML (uses settings),
        // fall back to the basic server template if none was supplied.
        // Always populate PDF metadata so the recipient's PDF reader and
        // their OS Spotlight see meaningful Title/Author/Subject/Keywords.
        const meta = buildInvoiceMetadata(invoice, company, client);
        const optsWithMeta = { metadata: meta };
        let pdfBuffer: Buffer;
        if (providedHTML) {
          pdfBuffer = await htmlToPDFBuffer(providedHTML, optsWithMeta);
        } else {
          const lineItems = dbInstance
            .prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order')
            .all(invoiceId) as any[];
          pdfBuffer = await generateInvoicePDF(invoice, company, client, lineItems, optsWithMeta);
        }

        // Write temp PDF into an isolated subdir so we can clean it up later
        // without racing against other exports. Filename matches the new
        // {doctype}-{id}-{date}.pdf convention.
        const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bap-invoice-'));
        const pdfPath = path.join(
          tmpDir,
          buildPdfFilename('invoice', String(invoice.invoice_number || invoiceId)),
        );
        await fsp.writeFile(pdfPath, pdfBuffer);

        // Schedule cleanup — mail client has the handle open by now; give it
        // 10 minutes and then reap. Best-effort, silent on failure.
        setTimeout(
          () => {
            fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
          },
          10 * 60 * 1000,
        );

        // Open email client with pre-filled content. Prefer the customized
        // email template (Settings → Email Templates) so the user's brand
        // voice and layout are preserved. If the template lookup fails for
        // any reason, fall back to the hardcoded copy in email-sender.ts.
        let emailResult: { success: boolean; error?: string };
        try {
          ensureDefaultEmailTemplates(companyId);
          const tmpl = dbInstance
            .prepare(`SELECT * FROM email_templates WHERE company_id = ? AND key = ?`)
            .get(companyId, templateKey) as any;
          if (tmpl) {
            const ctx = buildTemplateContext(companyId, 'invoice', invoiceId);
            const subject = resolveTemplateTokens(tmpl.subject || '', ctx);
            const body = resolveTemplateTokens(tmpl.body || '', ctx);
            const to = (tmpl.default_to || '').includes('client.email')
              ? client?.email || ''
              : tmpl.default_to || client?.email || '';
            const params = new URLSearchParams();
            params.set('subject', subject);
            params.set('body', body);
            if (tmpl.default_cc) params.set('cc', tmpl.default_cc);
            if (tmpl.default_bcc) params.set('bcc', tmpl.default_bcc);
            const mailto = `mailto:${encodeURIComponent(to)}?${params.toString()}`;
            await shell.openExternal(mailto);
            emailResult = { success: true };
          } else {
            emailResult = await sendInvoiceEmail(invoice, company, client);
          }
        } catch (templateErr) {
          // Template path failed — surface to console but still attempt
          // hardcoded fallback so the user can send the invoice.
          console.warn('[email] template path failed, using fallback:', templateErr);
          emailResult = await sendInvoiceEmail(invoice, company, client);
        }

        if (emailResult.success) {
          const previousStatus = invoice.status;
          // Update invoice status to sent if still draft
          if (previousStatus === 'draft') {
            db.update('invoices', invoiceId, { status: 'sent' });
          }

          // Log the email
          const emailId = crypto.randomUUID();
          const now = new Date().toISOString();
          dbInstance
            .prepare(
              'INSERT INTO email_log (id, company_id, recipient, subject, body_preview, entity_type, entity_id, status, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              emailId,
              companyId,
              client?.email || '',
              `Invoice ${invoice.invoice_number} from ${company?.name || ''}`,
              'Mail client opened with PDF attached from temp folder',
              'invoice',
              invoiceId,
              'sent',
              now,
            );

          // Reveal the PDF in filesystem so user can attach it
          revealInFolder(pdfPath);
          try {
            db.logAudit(companyId, 'invoices', invoiceId, 'email_pdf', { pdfPath });
          } catch {
            /* audit best-effort */
          }
          scheduleAutoBackup();

          return {
            success: true,
            pdfPath,
            newStatus: previousStatus === 'draft' ? 'sent' : previousStatus,
          };
        }

        return { ...emailResult, pdfPath };
      } catch (err: any) {
        return { error: err?.message || 'Failed to send email' };
      }
    },
  );

  // ─── Print / Preview System ─────────────────────────────
  ipcMain.handle(
    'print:preview',
    (
      _event,
      {
        html,
        title,
        pdfOptions,
      }: { html: string; title: string; pdfOptions?: PDFOptions & { defaultFilename?: string } },
    ) => {
      openPrintPreview(html, title, pdfOptions);
      return { success: true };
    },
  );

  ipcMain.handle(
    'print:save-pdf',
    async (
      _event,
      {
        html,
        title,
        doctype,
        identifier,
        pdfOptions,
        openAfterSave,
        revealAfterSave,
      }: {
        html: string;
        title: string;
        doctype?: string;
        identifier?: string;
        pdfOptions?: PDFOptions;
        openAfterSave?: boolean;
        revealAfterSave?: boolean;
      },
    ) => {
      const defaultFilename = buildPdfFilename(doctype || 'document', identifier || title);
      const result = await saveHTMLAsPDF(html, title, { ...pdfOptions, defaultFilename });
      if (result.path) {
        if (openAfterSave) {
          const err = await openPathInOS(result.path);
          if (err) console.warn('openPath failed:', err);
        } else if (revealAfterSave) {
          revealInFolder(result.path);
        }
      }
      return result;
    },
  );

  ipcMain.handle('print:print', async (_event, { html }: { html: string }) => {
    try {
      await printHTML(html);
      return { success: true };
    } catch (err: any) {
      return { error: err?.message || 'Print failed' };
    }
  });

  ipcMain.handle(
    'print:render',
    async (
      _event,
      {
        html,
        pdfOptions,
      }: { html: string; pdfOptions?: import('../../services/print-preview').PDFOptions },
    ): Promise<{ base64?: string; error?: string }> => {
      try {
        const buf = await htmlToPDFBuffer(html, pdfOptions);
        return { base64: buf.toString('base64') };
      } catch (err: any) {
        return { error: err?.message || 'PDF render failed' };
      }
    },
  );

  ipcMain.handle('debt:export-bundle', async (_event, { debtId }: { debtId: string }) => {
    const debt = db.getDb().prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
    if (!debt) return { error: 'Debt not found' };
    const company = db
      .getDb()
      .prepare('SELECT * FROM companies WHERE id = ?')
      .get(debt.company_id) as any;
    const payments = db
      .getDb()
      .prepare('SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY received_date')
      .all(debtId) as any[];
    const comms = db
      .getDb()
      .prepare('SELECT * FROM debt_communications WHERE debt_id = ? ORDER BY logged_at')
      .all(debtId) as any[];
    const evidence = db
      .getDb()
      .prepare('SELECT * FROM debt_evidence WHERE debt_id = ? ORDER BY date_of_evidence')
      .all(debtId) as any[];
    const legalActions = db
      .getDb()
      .prepare('SELECT * FROM debt_legal_actions WHERE debt_id = ? ORDER BY created_at')
      .all(debtId) as any[];
    const stages = db
      .getDb()
      .prepare('SELECT * FROM debt_pipeline_stages WHERE debt_id = ? ORDER BY entered_at')
      .all(debtId) as any[];

    // ── Formatting helpers ────────────────────────────────
    const esc = (s: unknown): string => {
      if (s === null || s === undefined || s === '') return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };
    const fmtMoney = (n: unknown): string =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
    const fmtDate = (d: unknown): string => {
      if (!d) return '\u2014';
      try {
        const s = String(d);
        // Date-only (YYYY-MM-DD) → parse as local noon to avoid TZ shifting the day
        const dt = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
        if (isNaN(dt.getTime())) return esc(s);
        return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      } catch {
        return esc(d);
      }
    };
    const fmtDateTime = (d: unknown): string => {
      if (!d) return '\u2014';
      try {
        const dt = new Date(String(d));
        if (isNaN(dt.getTime())) return esc(d);
        return dt.toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
      } catch {
        return esc(d);
      }
    };
    // "collections_agency" → "Collections Agency"
    const titleCase = (s: unknown): string => {
      if (!s) return '\u2014';
      return String(s)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
    };
    const sanitizeFilename = (s: string): string =>
      s
        .replace(/[\/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'Case File';

    const total =
      (debt.original_amount || 0) +
      (debt.interest_accrued || 0) +
      (debt.fees_accrued || 0) -
      (debt.payments_made || 0);

    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Debt Case File</title><style>
      * { box-sizing: border-box; }
      body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; color: #0f172a; padding: 40px; font-size: 13px; line-height: 1.5; }
      h1 { font-size: 22px; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin: 0 0 16px; }
      h2 { font-size: 15px; margin: 28px 0 10px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; color: #0f172a; }
      p { margin: 4px 0; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
      th, td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: left; vertical-align: top; }
      th { background: #f1f5f9; font-weight: 700; color: #475569; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
      .label { font-weight: 600; width: 180px; color: #475569; }
      .meta { color: #64748b; font-size: 11px; margin-bottom: 4px; }
      .empty { color: #64748b; font-style: italic; padding: 8px 0; }
      .cover-line { padding: 3px 0; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      .comm-card { margin-bottom: 14px; border: 1px solid #e2e8f0; border-radius: 3px; padding: 10px 12px; }
      .comm-subject { font-weight: 700; color: #0f172a; }
      .comm-body { white-space: pre-wrap; color: #334155; margin-top: 4px; }
    </style></head><body>`;

    // Cover
    html += `<h1>Debt Collection Case File</h1>`;
    html += `<p class="cover-line"><strong>Debtor:</strong> ${esc(debt.debtor_name)}</p>`;
    html += `<p class="cover-line"><strong>Company:</strong> ${esc(company?.name || '')}</p>`;
    html += `<p class="cover-line"><strong>Generated:</strong> ${fmtDateTime(new Date())}</p>`;
    html += `<p class="cover-line"><strong>Total Due:</strong> ${fmtMoney(total)}</p>`;

    // Debt Summary
    html += `<h2>1. Debt Summary</h2><table>`;
    const summaryRows: [string, string][] = [
      ['Type', titleCase(debt.type)],
      ['Status', titleCase(debt.status)],
      ['Original Amount', fmtMoney(debt.original_amount)],
      ['Interest Accrued', fmtMoney(debt.interest_accrued)],
      ['Fees', fmtMoney(debt.fees_accrued)],
      ['Payments Made', fmtMoney(debt.payments_made)],
      ['Balance Due', fmtMoney(total)],
      ['Due Date', fmtDate(debt.due_date)],
      ['Delinquent Date', fmtDate(debt.delinquent_date)],
      [
        'Interest Rate',
        `${((debt.interest_rate || 0) * 100).toFixed(2)}% (${esc(debt.interest_type || 'simple')})`,
      ],
      ['Jurisdiction', esc(debt.jurisdiction) || '\u2014'],
      ['Current Stage', titleCase(debt.current_stage)],
    ];
    for (const [label, value] of summaryRows) {
      html += `<tr><td class="label">${esc(label)}</td><td>${value}</td></tr>`;
    }
    html += `</table>`;

    // Payment History
    html += `<h2>2. Payment History</h2>`;
    if (payments.length === 0) {
      html += `<div class="empty">No payments recorded.</div>`;
    } else {
      html += `<table><thead><tr><th>Date</th><th class="num">Amount</th><th>Method</th><th>Reference</th><th>Notes</th></tr></thead><tbody>`;
      for (const p of payments) {
        html += `<tr>
          <td>${fmtDate(p.received_date)}</td>
          <td class="num">${fmtMoney(p.amount)}</td>
          <td>${titleCase(p.method)}</td>
          <td>${esc(p.reference_number) || '\u2014'}</td>
          <td>${esc(p.notes)}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }

    // Communication Log
    html += `<h2>3. Communication Log</h2>`;
    if (comms.length === 0) {
      html += `<div class="empty">No communications recorded.</div>`;
    } else {
      for (const c of comms) {
        html += `<div class="comm-card">
          <div class="meta">${fmtDateTime(c.logged_at)} \u2022 ${titleCase(c.type)} \u2022 ${titleCase(c.direction)}</div>
          <div class="comm-subject">${esc(c.subject) || '(No subject)'}</div>
          <div class="comm-body">${esc(c.body)}</div>
          ${c.outcome ? `<div style="margin-top:6px;color:#64748b;"><em>Outcome:</em> ${esc(c.outcome)}</div>` : ''}
        </div>`;
      }
    }

    // Evidence Timeline
    html += `<h2>4. Evidence Timeline</h2>`;
    if (evidence.length === 0) {
      html += `<div class="empty">No evidence items.</div>`;
    } else {
      html += `<table><thead><tr><th>Date</th><th>Type</th><th>Title</th><th>Description</th><th>Relevance</th></tr></thead><tbody>`;
      for (const e of evidence) {
        html += `<tr>
          <td>${fmtDate(e.date_of_evidence)}</td>
          <td>${titleCase(e.type)}</td>
          <td>${esc(e.title)}</td>
          <td>${esc(e.description)}</td>
          <td>${titleCase(e.court_relevance)}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }

    // Interest Breakdown
    html += `<h2>5. Interest Calculation</h2>`;
    html += `<p><strong>Type:</strong> ${titleCase(debt.interest_type || 'simple')} &nbsp;|&nbsp; <strong>Rate:</strong> ${((debt.interest_rate || 0) * 100).toFixed(2)}% &nbsp;|&nbsp; <strong>Start:</strong> ${fmtDate(debt.interest_start_date)}</p>`;
    html += `<p><strong>Accrued:</strong> ${fmtMoney(debt.interest_accrued)}</p>`;

    // Legal Actions
    html += `<h2>6. Legal Actions</h2>`;
    if (legalActions.length === 0) {
      html += `<div class="empty">No legal actions.</div>`;
    } else {
      for (const la of legalActions) {
        html += `<div style="margin-bottom:12px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:3px;">`;
        html += `<p><strong>${titleCase(la.action_type)}</strong> \u2014 Status: ${titleCase(la.status)} | Case: ${esc(la.case_number) || '\u2014'}</p>`;
        if (la.hearing_date)
          html += `<p class="meta">Hearing: ${fmtDate(la.hearing_date)} ${esc(la.hearing_time) || ''}</p>`;
        if (la.judgment_amount)
          html += `<p class="meta">Judgment: ${fmtMoney(la.judgment_amount)}</p>`;
        html += `</div>`;
      }
    }

    // Pipeline History
    html += `<h2>7. Pipeline History</h2>`;
    html += `<table><thead><tr><th>Stage</th><th>Entered</th><th>Exited</th><th>Auto</th><th>Notes</th></tr></thead><tbody>`;
    for (const s of stages) {
      html += `<tr>
        <td>${titleCase(s.stage)}</td>
        <td>${fmtDateTime(s.entered_at)}</td>
        <td>${s.exited_at ? fmtDateTime(s.exited_at) : '\u2014'}</td>
        <td>${s.auto_advanced ? 'Yes' : 'No'}</td>
        <td>${esc(s.notes)}</td>
      </tr>`;
    }
    html += `</tbody></table>`;

    html += `</body></html>`;

    const safeName = sanitizeFilename(debt.debtor_name || 'Unknown');
    const result = await saveHTMLAsPDF(html, `Debt Case File \u2014 ${safeName}`, {
      defaultFilename: buildPdfFilename('debt-case', safeName),
    });
    if (result.path) {
      const companyId = db.getCurrentCompanyId();
      if (companyId) {
        try {
          db.logAudit(companyId, 'debts', debt.id, 'export_pdf', { path: result.path });
        } catch {
          /* audit best-effort */
        }
      }
    }
    // Preserve old contract: return the path string (empty if cancelled).
    return result.path || '';
  });
}
