import { describe, it, expect } from 'vitest';
import { transformFeatLine } from './codemod-feat';

const wrap = (ch: string, args: string, body: string) =>
  `  ipcMain.handle('${ch}', (${args}) => { try { ${body} } catch (e: any) { return { error: e?.message }; } });`;

describe('transformFeatLine', () => {
  it('read, no cid', () => {
    const r = transformFeatLine(
      `  ipcMain.handle('feat:invoice:late-fee:compute', (_e, { invoice_id }: any) => { try { return ie().computeLateFee(invoice_id); } catch (e: any) { return { error: e?.message }; } });`,
    );
    expect(r).toEqual({
      accessor: 'ie',
      channel: 'feat:invoice:late-fee:compute',
      entry: `'feat:invoice:late-fee:compute': { call: (s, { invoice_id }: any) => s.computeLateFee(invoice_id) },`,
    });
  });
  it('mutate with r', () => {
    const r = transformFeatLine(
      `  ipcMain.handle('feat:invoice:late-fee:apply', (_e, { invoice_id }: any) => { try { const r = ie().applyLateFee(invoice_id); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });`,
    );
    expect(r!.entry).toBe(
      `'feat:invoice:late-fee:apply': { call: (s, { invoice_id }: any) => s.applyLateFee(invoice_id), mutates: true },`,
    );
  });
  it('list with cid guard returning []', () => {
    const r = transformFeatLine(
      `  ipcMain.handle('feat:credit-memo:list', (_e, { client_id }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ie().listCreditMemos(cid, client_id); } catch (e: any) { return { error: e?.message }; } });`,
    );
    expect(r!.entry).toBe(
      `'feat:credit-memo:list': { call: (s, { client_id }: any = {}, { cid }) => s.listCreditMemos(cid!, client_id), requiresCompany: [] },`,
    );
  });
  it('create with cid injected into payload', () => {
    const r = transformFeatLine(
      `  ipcMain.handle('feat:credit-memo:create', (_e, memo: any) => { try { const cid = db.getCurrentCompanyId(); const r = ie().createCreditMemo({ ...memo, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });`,
    );
    expect(r!.entry).toBe(
      `'feat:credit-memo:create': { call: (s, memo: any, { cid }) => s.createCreditMemo({ ...memo, company_id: cid }), mutates: true },`,
    );
  });
  it('wrapped result', () => {
    const r = transformFeatLine(
      `  ipcMain.handle('feat:invoice:reminders:mark-sent', (_e, { id }: any) => { try { const r = { ok: ie().markReminderSent(id) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });`,
    );
    expect(r!.entry).toBe(
      `'feat:invoice:reminders:mark-sent': { call: (s, { id }: any) => ({ ok: s.markReminderSent(id) }), mutates: true },`,
    );
  });
  it('returns null for multi-line or unrecognised handlers', () => {
    expect(transformFeatLine(`  ipcMain.handle('feat:x:y', (_e, a: any) => {`)).toBeNull();
  });

  it('_r naming and doubled space', () => {
    const r = transformFeatLine(
      wrap(
        'feat:a:b',
        '_e, { id }: any',
        ` const _r = aa().run(id); scheduleAutoBackup(); return _r;`,
      ),
    );
    expect(r!.entry).toBe(`'feat:a:b': { call: (s, { id }: any) => s.run(id), mutates: true },`);
  });
  it('no payload with (_e)', () => {
    const r = transformFeatLine(wrap('feat:a:list', '_e', 'return tr().listAll();'));
    expect(r!.entry).toBe(`'feat:a:list': { call: (s) => s.listAll() },`);
  });
  it('no payload with () and cid', () => {
    const r = transformFeatLine(
      wrap(
        'feat:a:list',
        '',
        'const cid = db.getCurrentCompanyId(); if (!cid) return null; return tr().listAll(cid);',
      ),
    );
    expect(r!.entry).toBe(
      `'feat:a:list': { call: (s, _p: any, { cid }) => s.listAll(cid!), requiresCompany: null },`,
    );
  });
  it('error-object guard copied verbatim', () => {
    const r = transformFeatLine(
      wrap(
        'feat:a:b',
        '_e, a: any',
        `const cid = db.getCurrentCompanyId(); if (!cid) return { error: 'No company selected' }; return tr().f(cid, a);`,
      ),
    );
    expect(r!.entry).toBe(
      `'feat:a:b': { call: (s, a: any, { cid }) => s.f(cid!, a), requiresCompany: { error: 'No company selected' } },`,
    );
  });
  it('cid declared but unused does not destructure ctx', () => {
    const r = transformFeatLine(
      wrap('feat:a:b', '_e, a: any', 'const cid = db.getCurrentCompanyId(); return tr().f(a);'),
    );
    expect(r!.entry).toBe(`'feat:a:b': { call: (s, a: any) => s.f(a) },`);
  });
  it('async body with await', () => {
    const line = `  ipcMain.handle('feat:a:b', async (_e, a: any) => { try { const r = await tr().f(a); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });`;
    expect(transformFeatLine(line)!.entry).toBe(
      `'feat:a:b': { call: async (s, a: any) => await s.f(a), mutates: true },`,
    );
  });
  it('rejects multiple payload args', () => {
    expect(
      transformFeatLine(wrap('feat:a:b', '_e, a: any, b: any', 'return tr().f(a, b);')),
    ).toBeNull();
  });
  it('rejects bodies with extra statements', () => {
    expect(
      transformFeatLine(wrap('feat:a:b', '_e, a: any', 'const x = 1; return tr().f(a, x);')),
    ).toBeNull();
  });
});

describe('transformFeatLine: more shapes', () => {
  it('scalar guard values and renamed catch variable', () => {
    const line = `  ipcMain.handle('feat:a:b', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return 0; return tr().bal(cid); } catch (er: any) { return { error: er?.message }; } });`;
    expect(transformFeatLine(line)!.entry).toBe(
      `'feat:a:b': { call: (s, _p: any, { cid }) => s.bal(cid!), requiresCompany: 0 },`,
    );
    expect(
      transformFeatLine(
        wrap(
          'feat:a:c',
          '_e, a: any',
          `const cid = db.getCurrentCompanyId(); if (!cid) return 'average'; return ip().get(cid, a);`,
        ),
      )!.entry,
    ).toBe(
      `'feat:a:c': { call: (s, a: any, { cid }) => s.get(cid!, a), requiresCompany: 'average' },`,
    );
  });
  it('void call with constant ok result', () => {
    const r = transformFeatLine(
      wrap(
        'feat:a:log',
        '_e, { x }: any',
        `const cid = db.getCurrentCompanyId(); tr().log(cid, x); const _r = { ok: true }; scheduleAutoBackup(); return _r;`,
      ),
    );
    expect(r!.entry).toBe(
      `'feat:a:log': { call: (s, { x }: any, { cid }) => { s.log(cid, x); return { ok: true }; }, mutates: true },`,
    );
  });
  it('returns null without try/catch', () => {
    expect(
      transformFeatLine(
        `  ipcMain.handle('feat:a:b', (_e, a: any) => { const r = eu().f(a); scheduleAutoBackup(); return r; });`,
      ),
    ).toBeNull();
  });
});

it('rejects payloads that bind `s` (collides with the service parameter)', () => {
  expect(transformFeatLine(wrap('feat:a:b', '_e, { s }: any', 'return tr().f(s);'))).toBeNull();
});
