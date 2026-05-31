// src/main/ipc/tax.ts
//
// Tax-form IPC handlers, extracted from the ipc/index.ts monolith.
// Each handler resolves the active company and delegates to a compute
// function in services/tax-forms/*. Registered from registerIpcHandlers()
// via registerTaxIpc(ipcMain). The only shared dependency is the database.

import { IpcMain } from 'electron';
import * as db from '../database';

export function registerTaxIpc(ipcMain: IpcMain): void {
  // ─── Tax Forms (P4.46/47/50) ─────────────────────────
  ipcMain.handle('tax:form-941', (_event, { year, quarter }: { year: number; quarter: 1 | 2 | 3 | 4 }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { computeForm941 } = require('../services/tax-forms/form-941');
      return computeForm941(cid, year, quarter);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:schedule-c', (_event, { year }: { year: number }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { computeScheduleC } = require('../services/tax-forms/schedule-c');
      return computeScheduleC(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:1099-nec', (_event, { year }: { year: number }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const { compute1099NECs } = require('../services/tax-forms/form-1099-nec');
      return compute1099NECs(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:w2', (_event, { year }: { year: number }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const { computeW2sForYear } = require('../services/tax-forms/form-w2');
      return computeW2sForYear(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:schedule-se', (_event, { year, w2_ss_wages }: { year: number; w2_ss_wages?: number }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { computeScheduleSE } = require('../services/tax-forms/schedule-se');
      return computeScheduleSE(cid, year, { w2_ss_wages });
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:sales-tax', (_event, { period_start, period_end, opts }: { period_start: string; period_end: string; opts?: any }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { computeSalesTax } = require('../services/tax-forms/sales-tax');
      return computeSalesTax(cid, period_start, period_end, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:w3', (_event, { year }: { year: number }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { computeW3 } = require('../services/tax-forms/form-w3');
      return computeW3(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-940', (_event, { year, opts }: { year: number; opts?: { multi_state?: boolean; credit_reduction_state?: boolean; total_deposits?: number } }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { computeForm940 } = require('../services/tax-forms/form-940');
      return computeForm940(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:1099-misc', (_event, { year }: { year: number }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const { compute1099MISCs } = require('../services/tax-forms/form-1099-misc');
      return compute1099MISCs(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-944', (_event, { year }: { year: number }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { computeForm944 } = require('../services/tax-forms/form-944');
      return computeForm944(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-945', (_event, { year, opts }: { year: number; opts?: any }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { computeForm945 } = require('../services/tax-forms/form-945');
      return computeForm945(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:schedule-941b', (_event, { year, quarter }: { year: number; quarter: 1 | 2 | 3 | 4 }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { computeSchedule941B } = require('../services/tax-forms/form-941-schedule-b');
      return computeSchedule941B(cid, year, quarter);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-945-a', (_event, { year, parent_form }: { year: number; parent_form?: 'form-944' | 'form-945' | 'form-941' }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { computeForm945A } = require('../services/tax-forms/form-945-a');
      return computeForm945A(cid, year, parent_form || 'form-945');
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:1099-int', (_event, { year }: { year: number }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return [];
      const { compute1099INTs } = require('../services/tax-forms/form-1099-int');
      return compute1099INTs(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:1099-div', (_event, { year }: { year: number }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return [];
      const { compute1099DIVs } = require('../services/tax-forms/form-1099-div');
      return compute1099DIVs(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:1099-r', (_event, { year }: { year: number }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return [];
      const { compute1099Rs } = require('../services/tax-forms/form-1099-r');
      return compute1099Rs(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:1099-k', (_event, { year }: { year: number }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return [];
      const { compute1099Ks } = require('../services/tax-forms/form-1099-k');
      return compute1099Ks(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:1099-b', (_event, { year }: { year: number }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return [];
      const { compute1099Bs } = require('../services/tax-forms/form-1099-other');
      return compute1099Bs(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:1099-g', (_event, { year }: { year: number }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return [];
      const { compute1099Gs } = require('../services/tax-forms/form-1099-other');
      return compute1099Gs(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:1099-c', (_event, { year }: { year: number }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return [];
      const { compute1099Cs } = require('../services/tax-forms/form-1099-other');
      return compute1099Cs(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:1099-sa', (_event, { year }: { year: number }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return [];
      const { compute1099SAs } = require('../services/tax-forms/form-1099-other');
      return compute1099SAs(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:w2c', (_event, { year, corrections }: { year: number; corrections: any[] }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return [];
      const { computeW2Cs } = require('../services/tax-forms/form-w2c');
      return computeW2Cs(cid, year, corrections || []);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-1096', (_event, { year }: { year: number }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm1096 } = require('../services/tax-forms/form-1096');
      return computeForm1096(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:schedule-1', (_event, { year, opts }: { year: number; opts?: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeSchedule1 } = require('../services/tax-forms/schedule-1');
      return computeSchedule1(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:schedule-2', (_event, { year, opts }: { year: number; opts?: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeSchedule2 } = require('../services/tax-forms/schedule-2');
      return computeSchedule2(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:schedule-3', (_event, { year }: { year: number }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeSchedule3 } = require('../services/tax-forms/schedule-3');
      return computeSchedule3(cid, year);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:schedule-a', (_event, { year, opts }: { year: number; opts?: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeScheduleA } = require('../services/tax-forms/schedule-a');
      return computeScheduleA(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:schedule-b', (_event, { year, opts }: { year: number; opts?: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeScheduleB } = require('../services/tax-forms/schedule-b');
      return computeScheduleB(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:schedule-d', (_event, { year, opts }: { year: number; opts?: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeScheduleD } = require('../services/tax-forms/schedule-d');
      return computeScheduleD(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-1040-es', (_event, { year, opts }: { year: number; opts?: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm1040ES } = require('../services/tax-forms/form-1040-es');
      return computeForm1040ES(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-8995', (_event, { year, opts }: { year: number; opts?: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm8995 } = require('../services/tax-forms/form-8995');
      return computeForm8995(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-4562', (_event, { year, opts }: { year: number; opts?: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm4562 } = require('../services/tax-forms/form-4562');
      return computeForm4562(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-8829', (_event, { year, opts }: { year: number; opts?: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm8829 } = require('../services/tax-forms/form-8829');
      return computeForm8829(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-4797', (_event, { year, opts }: { year: number; opts?: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm4797 } = require('../services/tax-forms/form-4797');
      return computeForm4797(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-7004', (_event, { opts }: { opts: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm7004 } = require('../services/tax-forms/form-7004');
      return computeForm7004(cid, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-4868', (_event, { year, opts }: { year: number; opts?: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm4868 } = require('../services/tax-forms/form-4868');
      return computeForm4868(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-1065', (_event, { year, opts }: { year: number; opts?: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm1065 } = require('../services/tax-forms/form-1065');
      return computeForm1065(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-1120', (_event, { year, opts }: { year: number; opts?: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm1120 } = require('../services/tax-forms/form-1120');
      return computeForm1120(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-1120s', (_event, { year, opts }: { year: number; opts?: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm1120S } = require('../services/tax-forms/form-1120s');
      return computeForm1120S(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:schedule-k1', (_event, { opts }: { opts: any }) => {
    try {
      const { computeScheduleK1 } = require('../services/tax-forms/schedule-k1');
      return computeScheduleK1(opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-1041', (_event, { year, opts }: { year: number; opts?: any }) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm1041 } = require('../services/tax-forms/form-1041');
      return computeForm1041(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  // Wave 7 — ACA
  ipcMain.handle('tax:form-1094c', (_event, { year, opts }: any) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm1094C } = require('../services/tax-forms/form-1094c');
      return computeForm1094C(cid, year, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-1095c', (_event, { opts }: any) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm1095C } = require('../services/tax-forms/form-1095c');
      return computeForm1095C(cid, opts);
    } catch (err: any) { return { error: err?.message }; }
  });
  // Wave 8 — Entity lifecycle
  ipcMain.handle('tax:form-ss4', (_event, { opts }: any) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeFormSS4 } = require('../services/tax-forms/entity-lifecycle');
      return computeFormSS4(cid, opts || {});
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-2553', (_event, { opts }: any) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm2553 } = require('../services/tax-forms/entity-lifecycle');
      return computeForm2553(cid, opts || {});
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-8832', (_event, { opts }: any) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm8832 } = require('../services/tax-forms/entity-lifecycle');
      return computeForm8832(cid, opts || {});
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:form-8822b', (_event, { opts }: any) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeForm8822B } = require('../services/tax-forms/entity-lifecycle');
      return computeForm8822B(cid, opts || {});
    } catch (err: any) { return { error: err?.message }; }
  });
  // Wave 9 — Utah
  ipcMain.handle('tax:tc40', (_event, { year, opts }: any) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeTC40 } = require('../services/tax-forms/utah-forms');
      return computeTC40(cid, year, opts || {});
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:tc20', (_event, { year, opts }: any) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeTC20 } = require('../services/tax-forms/utah-forms');
      return computeTC20(cid, year, opts || {});
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:tc20s', (_event, { year, opts }: any) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeTC20S } = require('../services/tax-forms/utah-forms');
      return computeTC20S(cid, year, opts || {});
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:tc65', (_event, { year, opts }: any) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeTC65 } = require('../services/tax-forms/utah-forms');
      return computeTC65(cid, year, opts || {});
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:tc62m', (_event, { year, period_start, period_end, opts }: any) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeTC62M } = require('../services/tax-forms/utah-forms');
      return computeTC62M(cid, year, period_start, period_end, opts || {});
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('tax:tc941', (_event, { year, opts }: any) => {
    try { const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No active company' };
      const { computeTC941 } = require('../services/tax-forms/utah-forms');
      return computeTC941(cid, year, opts || {});
    } catch (err: any) { return { error: err?.message }; }
  });
}
