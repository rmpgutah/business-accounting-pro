// src/main/ipc/compliance.ts
//
// Compliance-document IPC handlers (W-4 / W-9 / I-9), extracted from the
// ipc/index.ts monolith. Registered from registerIpcHandlers() via
// registerComplianceIpc(ipcMain). Delegates to services/compliance-documents
// and renders blank PDFs via services/print-preview.

import { IpcMain } from 'electron';
import * as db from '../database';
import { saveHTMLAsPDF } from '../services/print-preview';

export function registerComplianceIpc(ipcMain: IpcMain): void {
  // ─── Wave 4: Compliance documents (W-4 / W-9 / I-9) ─────────
  ipcMain.handle('compliance:list', (_event, filters?: any) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return [];
      const { listForCompany } = require('../services/compliance-documents');
      return listForCompany(cid, filters);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('compliance:list-for-person', (_event, { person_type, person_id }: any) => {
    try {
      const { listForPerson } = require('../services/compliance-documents');
      return listForPerson(person_type, person_id);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('compliance:upsert', (_event, record: any) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { upsertDocument } = require('../services/compliance-documents');
      return upsertDocument({ ...record, company_id: cid });
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('compliance:delete', (_event, { id }: { id: string }) => {
    try {
      const { deleteDocument } = require('../services/compliance-documents');
      return { ok: deleteDocument(id) };
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('compliance:get-missing', () => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return [];
      const { getMissing } = require('../services/compliance-documents');
      return getMissing(cid);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('compliance:get-expiring', (_event, { days_ahead }: { days_ahead?: number } = {}) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return [];
      const { getExpiring } = require('../services/compliance-documents');
      return getExpiring(cid, days_ahead || 60);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('compliance:auto-expire', () => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return 0;
      const { autoExpire } = require('../services/compliance-documents');
      return autoExpire(cid);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('compliance:generate-blank-pdf', async (_event, { form_type, person_type, person_id }: { form_type: 'W-4' | 'W-9' | 'I-9'; person_type?: string; person_id?: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const company = db.getById('companies', cid) as any || {};
      const { blankW4HTML, blankW9HTML, blankI9HTML } = require('../services/tax-forms/blank-templates');

      const employerAddress = [company.address_line1, company.address_line2, company.city, company.state, company.zip].filter(Boolean).join(', ');
      const employerName = company.legal_name || company.name || '';
      const employerEin = company.ein || company.tax_id || '';

      // Optionally pre-fill the recipient's name if they exist
      let recipientName = '';
      let recipientBusinessName = '';
      if (person_type && person_id) {
        const table = person_type === 'employee' ? 'employees' : person_type === 'vendor' ? 'vendors' : 'clients';
        try {
          const row = db.getById(table, person_id) as any || {};
          recipientName = row.name || '';
          recipientBusinessName = row.business_name || row.dba || '';
        } catch { /* not found */ }
      }

      let html = '';
      let filename = '';
      if (form_type === 'W-4') {
        html = blankW4HTML({
          employer_name: employerName,
          employer_ein: employerEin,
          employer_address: employerAddress,
          employee_name: recipientName,
          year: new Date().getFullYear(),
        });
        filename = 'W-4-blank-' + (recipientName || 'new-hire').replace(/\s+/g, '_') + '.pdf';
      } else if (form_type === 'W-9') {
        html = blankW9HTML({
          requester_name: employerName,
          requester_address: employerAddress,
          vendor_name: recipientName,
          vendor_business_name: recipientBusinessName,
        });
        filename = 'W-9-blank-' + (recipientName || 'new-vendor').replace(/\s+/g, '_') + '.pdf';
      } else if (form_type === 'I-9') {
        html = blankI9HTML({
          employer_name: employerName,
          employer_address: employerAddress,
          employer_ein: employerEin,
          employee_name: recipientName,
        });
        filename = 'I-9-blank-' + (recipientName || 'new-hire').replace(/\s+/g, '_') + '.pdf';
      } else {
        return { error: 'Unknown form_type: ' + form_type };
      }

      return await saveHTMLAsPDF(html, form_type, { defaultFilename: filename });
    } catch (err: any) {
      return { error: err?.message || 'PDF generation failed' };
    }
  });
}
