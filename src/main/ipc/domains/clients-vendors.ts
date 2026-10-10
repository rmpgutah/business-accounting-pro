import type { IpcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import * as db from '../../database';
import type { IpcDeps } from '../core/types';

export function registerClientsVendorsIpc(ipcMain: IpcMain, deps: IpcDeps): void {
  const { scheduleAutoBackup } = deps;

  // ─── Vendor Locations ─────────────────────────────────────────────────
  ipcMain.handle('vendor-locations:list', (_event, { vendor_id }: { vendor_id: string }) => {
    try {
      const rows = db
        .getDb()
        .prepare(
          'SELECT * FROM vendor_locations WHERE vendor_id = ? ORDER BY is_primary DESC, name ASC',
        )
        .all(vendor_id);
      return rows;
    } catch (err: any) {
      return { error: err?.message || 'Query failed' };
    }
  });

  ipcMain.handle(
    'vendor-locations:sync',
    (_event, { vendor_id, locations }: { vendor_id: string; locations: any[] }) => {
      try {
        const dbi = db.getDb();
        dbi.transaction(() => {
          dbi.prepare('DELETE FROM vendor_locations WHERE vendor_id = ?').run(vendor_id);
          const stmt = dbi.prepare(
            `INSERT INTO vendor_locations
           (id, vendor_id, name, location_type, address_line1, address_line2,
            city, state, zip, country, phone, email, is_primary, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          );
          for (const loc of locations) {
            stmt.run(
              loc.id || uuid(),
              vendor_id,
              loc.name || '',
              loc.location_type || 'physical',
              loc.address_line1 || '',
              loc.address_line2 || '',
              loc.city || '',
              loc.state || '',
              loc.zip || '',
              loc.country || '',
              loc.phone || '',
              loc.email || '',
              loc.is_primary ? 1 : 0,
              loc.notes || '',
            );
          }
        })();
        try {
          scheduleAutoBackup();
        } catch {
          /* non-fatal */
        }
        return { ok: true };
      } catch (err: any) {
        return { error: err?.message || 'Sync failed' };
      }
    },
  );

  ipcMain.handle('vendor-locations:delete', (_event, { id }: { id: string }) => {
    try {
      db.getDb().prepare('DELETE FROM vendor_locations WHERE id = ?').run(id);
      try {
        scheduleAutoBackup();
      } catch {
        /* non-fatal */
      }
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message || 'Delete failed' };
    }
  });

  ipcMain.handle(
    'vendor-locations:set-primary',
    (_event, { id, vendor_id }: { id: string; vendor_id: string }) => {
      try {
        const dbi = db.getDb();
        dbi.transaction(() => {
          dbi
            .prepare('UPDATE vendor_locations SET is_primary = 0 WHERE vendor_id = ?')
            .run(vendor_id);
          dbi.prepare('UPDATE vendor_locations SET is_primary = 1 WHERE id = ?').run(id);
        })();
        try {
          scheduleAutoBackup();
        } catch {
          /* non-fatal */
        }
        return { ok: true };
      } catch (err: any) {
        return { error: err?.message || 'Set primary failed' };
      }
    },
  );

  // Tags CRUD
  ipcMain.handle(
    'tags:list',
    (_e, { companyId, includeDeleted }: { companyId: string; includeDeleted?: boolean }) => {
      try {
        const sql = includeDeleted
          ? `SELECT * FROM tags WHERE company_id = ? ORDER BY sort_order, name`
          : `SELECT * FROM tags WHERE company_id = ? AND deleted_at IS NULL ORDER BY sort_order, name`;
        return db.getDb().prepare(sql).all(companyId);
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  ipcMain.handle('tags:groups-list', (_e, { companyId }: { companyId: string }) => {
    try {
      return db
        .getDb()
        .prepare(`SELECT * FROM tag_groups WHERE company_id = ? ORDER BY sort_order, name`)
        .all(companyId);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('tags:group-create', (_e, data: any) => {
    try {
      const r = db.create('tag_groups', data);
      scheduleAutoBackup();
      return r;
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('tags:group-update', (_e, { id, data }: any) => {
    try {
      const r = db.update('tag_groups', id, data);
      scheduleAutoBackup();
      return r;
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('tags:group-delete', (_e, { id }: { id: string }) => {
    try {
      db.getDb().prepare(`UPDATE tags SET group_id = NULL WHERE group_id = ?`).run(id);
      db.remove('tag_groups', id);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('tags:create', (_e, data: any) => {
    try {
      const r = db.create('tags', data);
      scheduleAutoBackup();
      return r;
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('tags:update', (_e, { id, data }: { id: string; data: any }) => {
    try {
      const r = db.update('tags', id, data);
      scheduleAutoBackup();
      return r;
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('tags:rename', (_e, { id, name }: { id: string; name: string }) => {
    try {
      db.getDb().prepare(`UPDATE tags SET name = ? WHERE id = ?`).run(name, id);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('tags:soft-delete', (_e, { id }: { id: string }) => {
    try {
      db.getDb().prepare(`UPDATE tags SET deleted_at = datetime('now') WHERE id = ?`).run(id);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('tags:restore', (_e, { id }: { id: string }) => {
    try {
      db.getDb().prepare(`UPDATE tags SET deleted_at = NULL WHERE id = ?`).run(id);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle(
    'tags:merge',
    (_e, { sourceId, targetId }: { sourceId: string; targetId: string }) => {
      try {
        const d = db.getDb();
        const tx = d.transaction(() => {
          const rows = d
            .prepare(`SELECT * FROM entity_tags WHERE tag_id = ?`)
            .all(sourceId) as any[];
          const upsert = d.prepare(
            `INSERT OR IGNORE INTO entity_tags (id, company_id, entity_type, entity_id, tag_id, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          );
          for (const r of rows) {
            upsert.run(uuid(), r.company_id, r.entity_type, r.entity_id, targetId);
          }
          d.prepare(`DELETE FROM entity_tags WHERE tag_id = ?`).run(sourceId);
          d.prepare(`DELETE FROM tags WHERE id = ?`).run(sourceId);
        });
        tx();
        scheduleAutoBackup();
        return { ok: true };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // Entity tag assignments
  ipcMain.handle(
    'tags:get-for-entity',
    (
      _e,
      {
        companyId,
        entityType,
        entityId,
      }: { companyId: string; entityType: string; entityId: string },
    ) => {
      try {
        return db
          .getDb()
          .prepare(
            `SELECT t.* FROM tags t JOIN entity_tags et ON et.tag_id = t.id
         WHERE et.company_id = ? AND et.entity_type = ? AND et.entity_id = ? AND t.deleted_at IS NULL
         ORDER BY t.sort_order, t.name`,
          )
          .all(companyId, entityType, entityId);
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  ipcMain.handle(
    'tags:set-for-entity',
    (
      _e,
      {
        companyId,
        entityType,
        entityId,
        tagIds,
      }: { companyId: string; entityType: string; entityId: string; tagIds: string[] },
    ) => {
      try {
        const d = db.getDb();
        const tx = d.transaction(() => {
          d.prepare(
            `DELETE FROM entity_tags WHERE company_id = ? AND entity_type = ? AND entity_id = ?`,
          ).run(companyId, entityType, entityId);
          const ins = d.prepare(
            `INSERT OR IGNORE INTO entity_tags (id, company_id, entity_type, entity_id, tag_id, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          );
          for (const tagId of tagIds || []) {
            ins.run(uuid(), companyId, entityType, entityId, tagId);
          }
        });
        tx();
        scheduleAutoBackup();
        return { ok: true };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  ipcMain.handle('tags:bulk-apply', (_e, { companyId, entityType, entityIds, tagIds }: any) => {
    try {
      const d = db.getDb();
      const ins = d.prepare(
        `INSERT OR IGNORE INTO entity_tags (id, company_id, entity_type, entity_id, tag_id, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      );
      const tx = d.transaction(() => {
        for (const eid of entityIds || [])
          for (const tid of tagIds || []) {
            ins.run(uuid(), companyId, entityType, eid, tid);
          }
      });
      tx();
      scheduleAutoBackup();
      return { ok: true, count: (entityIds?.length || 0) * (tagIds?.length || 0) };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('tags:bulk-remove', (_e, { companyId, entityType, entityIds, tagIds }: any) => {
    try {
      const d = db.getDb();
      const del = d.prepare(
        `DELETE FROM entity_tags WHERE company_id = ? AND entity_type = ? AND entity_id = ? AND tag_id = ?`,
      );
      const tx = d.transaction(() => {
        for (const eid of entityIds || [])
          for (const tid of tagIds || []) {
            del.run(companyId, entityType, eid, tid);
          }
      });
      tx();
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle(
    'tags:search-entities',
    (
      _e,
      {
        companyId,
        entityType,
        tagIds,
        mode = 'all',
      }: { companyId: string; entityType: string; tagIds: string[]; mode?: 'all' | 'any' },
    ) => {
      try {
        if (!tagIds?.length) return [];
        const d = db.getDb();
        const placeholders = tagIds.map(() => '?').join(',');
        if (mode === 'any') {
          return d
            .prepare(
              `SELECT DISTINCT entity_id FROM entity_tags
           WHERE company_id = ? AND entity_type = ? AND tag_id IN (${placeholders})`,
            )
            .all(companyId, entityType, ...tagIds)
            .map((r: any) => r.entity_id);
        }
        return d
          .prepare(
            `SELECT entity_id FROM entity_tags
         WHERE company_id = ? AND entity_type = ? AND tag_id IN (${placeholders})
         GROUP BY entity_id HAVING COUNT(DISTINCT tag_id) = ?`,
          )
          .all(companyId, entityType, ...tagIds, tagIds.length)
          .map((r: any) => r.entity_id);
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  ipcMain.handle('tags:usage-stats', (_e, { companyId }: { companyId: string }) => {
    try {
      return db
        .getDb()
        .prepare(
          `SELECT t.id, t.name, t.color, t.group_id,
                COUNT(et.id) AS usage_count,
                COUNT(DISTINCT et.entity_type) AS entity_type_count
         FROM tags t
         LEFT JOIN entity_tags et ON et.tag_id = t.id
         WHERE t.company_id = ? AND t.deleted_at IS NULL
         GROUP BY t.id ORDER BY usage_count DESC, t.name`,
        )
        .all(companyId);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Tag rules engine
  ipcMain.handle('tags:rules-list', (_e, { companyId }: { companyId: string }) => {
    try {
      return db
        .getDb()
        .prepare(`SELECT * FROM tag_rules WHERE company_id = ? ORDER BY created_at DESC`)
        .all(companyId);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('tags:rule-create', (_e, data: any) => {
    try {
      const r = db.create('tag_rules', data);
      scheduleAutoBackup();
      return r;
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('tags:rule-update', (_e, { id, data }: any) => {
    try {
      const r = db.update('tag_rules', id, data);
      scheduleAutoBackup();
      return r;
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('tags:rule-delete', (_e, { id }: any) => {
    try {
      db.remove('tag_rules', id);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle(
    'tags:run-rules',
    (
      _e,
      { companyId, entityType, entity }: { companyId: string; entityType: string; entity: any },
    ) => {
      try {
        const rules = db
          .getDb()
          .prepare(
            `SELECT * FROM tag_rules WHERE company_id = ? AND entity_type = ? AND is_active = 1`,
          )
          .all(companyId, entityType) as any[];
        const applied: string[] = [];
        const ins = db.getDb().prepare(
          `INSERT OR IGNORE INTO entity_tags (id, company_id, entity_type, entity_id, tag_id, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        );
        for (const r of rules) {
          let cond: any = {};
          try {
            cond = JSON.parse(r.when_condition_json || '{}');
          } catch {
            /* skip */
          }
          if (matchTagCondition(entity, cond)) {
            ins.run(uuid(), companyId, entityType, entity.id, r.then_apply_tag_id);
            applied.push(r.then_apply_tag_id);
          }
        }
        if (applied.length > 0) scheduleAutoBackup();
        return { applied };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // CSV export/import for tags
  ipcMain.handle('tags:export-csv', (_e, { companyId }: { companyId: string }) => {
    try {
      const tags = db
        .getDb()
        .prepare(
          `SELECT t.name, t.color, COALESCE(g.name, '') AS group_name, t.sort_order
         FROM tags t LEFT JOIN tag_groups g ON g.id = t.group_id
         WHERE t.company_id = ? AND t.deleted_at IS NULL ORDER BY g.name, t.sort_order, t.name`,
        )
        .all(companyId) as any[];
      const header = 'name,color,group,sort_order\n';
      const body = tags
        .map((t) =>
          [t.name, t.color, t.group_name, t.sort_order]
            .map((v) => {
              const s = String(v ?? '');
              return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
            })
            .join(','),
        )
        .join('\n');
      return { csv: header + body };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle(
    'tags:import-csv',
    (_e, { companyId, csv }: { companyId: string; csv: string }) => {
      try {
        const lines = csv.split(/\r?\n/).filter(Boolean);
        if (!lines.length) return { imported: 0 };
        const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
        const idx = (k: string) => header.indexOf(k);
        const d = db.getDb();
        const groupCache = new Map<string, string>();
        const findGroup = (name: string) => {
          if (!name) return null;
          if (groupCache.has(name)) return groupCache.get(name)!;
          const existing = d
            .prepare(`SELECT id FROM tag_groups WHERE company_id = ? AND name = ?`)
            .get(companyId, name) as any;
          if (existing) {
            groupCache.set(name, existing.id);
            return existing.id;
          }
          const id = uuid();
          d.prepare(
            `INSERT INTO tag_groups (id, company_id, name, color, allow_multiple) VALUES (?, ?, ?, '#6b7280', 1)`,
          ).run(id, companyId, name);
          groupCache.set(name, id);
          return id;
        };
        let imported = 0;
        for (let i = 1; i < lines.length; i++) {
          const cells = parseCsvLine(lines[i]);
          const name = cells[idx('name')] || '';
          if (!name) continue;
          const color = cells[idx('color')] || '#6b7280';
          const groupName = idx('group') >= 0 ? cells[idx('group')] : '';
          const sortOrder = idx('sort_order') >= 0 ? Number(cells[idx('sort_order')]) || 0 : 0;
          const existing = d
            .prepare(`SELECT id FROM tags WHERE company_id = ? AND name = ?`)
            .get(companyId, name) as any;
          if (existing) continue;
          d.prepare(
            `INSERT INTO tags (id, company_id, name, color, group_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(uuid(), companyId, name, color, findGroup(groupName), sortOrder);
          imported++;
        }
        if (imported > 0) scheduleAutoBackup();
        return { imported };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // ─── Vendor Account Features (VN1–VN150) ────────────────
  const vn = () => require('../../services/vendor-account-features');

  ipcMain.handle('vn:dashboard', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorDashboard(c, vendorId) : null;
  });

  ipcMain.handle('vn:profile', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorProfile(c, vendorId) : null;
  });

  ipcMain.handle('vn:expenses', (_e, { vendorId, limit }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorExpenses(c, vendorId, limit) : [];
  });

  ipcMain.handle('vn:bills', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorBills(c, vendorId) : [];
  });

  ipcMain.handle('vn:pos', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorPurchaseOrders(c, vendorId) : [];
  });

  ipcMain.handle('vn:spend-by-month', (_e, { vendorId, months }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorSpendByMonth(c, vendorId, months) : [];
  });

  ipcMain.handle('vn:spend-by-category', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorSpendByCategory(c, vendorId) : [];
  });

  ipcMain.handle('vn:payment-methods', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorPaymentMethods(c, vendorId) : [];
  });

  ipcMain.handle('vn:avg-transaction', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorAvgTransaction(c, vendorId) : {};
  });

  ipcMain.handle('vn:yoy-spend', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorYoYSpend(c, vendorId) : [];
  });

  ipcMain.handle('vn:1099-status', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendor1099Status(c, vendorId) : {};
  });

  ipcMain.handle('vn:contract-info', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorContractInfo(c, vendorId) : null;
  });

  ipcMain.handle('vn:insurance-info', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorInsuranceInfo(c, vendorId) : null;
  });

  ipcMain.handle('vn:compliance-docs', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorComplianceDocs(c, vendorId) : [];
  });

  ipcMain.handle('vn:w9-status', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorW9Status(c, vendorId) : {};
  });

  ipcMain.handle('vn:scorecard', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorScorecard(c, vendorId) : {};
  });

  ipcMain.handle('vn:ranking', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorRanking(c, limit) : [];
  });

  ipcMain.handle('vn:concentration', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorConcentration(c) : {};
  });

  ipcMain.handle('vn:growth-trend', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorGrowthTrend(c, vendorId) : [];
  });

  ipcMain.handle('vn:frequency', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorFrequency(c, vendorId) : {};
  });

  ipcMain.handle('vn:list', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorList(c) : [];
  });

  ipcMain.handle('vn:search', (_e, { query }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorSearch(c, query) : [];
  });

  ipcMain.handle('vn:by-type', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorsByType(c) : [];
  });

  ipcMain.handle('vn:by-status', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorsByStatus(c) : [];
  });

  ipcMain.handle('vn:by-approval', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorsByApproval(c) : [];
  });

  ipcMain.handle('vn:by-location', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorsByLocation(c) : [];
  });

  ipcMain.handle('vn:expired-insurance', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorsWithExpiredInsurance(c) : [];
  });

  ipcMain.handle('vn:expired-contracts', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorsWithExpiredContracts(c) : [];
  });

  ipcMain.handle('vn:needing-1099', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorsNeeding1099(c) : [];
  });

  ipcMain.handle('vn:without-w9', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorsWithoutW9(c) : [];
  });

  ipcMain.handle('vn:inactive', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().inactiveVendors(c, days || 180) : [];
  });

  ipcMain.handle('vn:new-vendors', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().newVendors(c, days || 30) : [];
  });

  ipcMain.handle('vn:count', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorCount(c) : {};
  });

  ipcMain.handle('vn:export', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorExport(c) : [];
  });

  ipcMain.handle('vn:bill-summary', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorBillSummary(c, vendorId) : {};
  });

  ipcMain.handle('vn:payment-history', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorPaymentHistory(c, vendorId) : [];
  });

  ipcMain.handle('vn:avg-payment-days', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorAvgPaymentDays(c, vendorId) : {};
  });

  ipcMain.handle('vn:bills-by-month', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorBillsByMonth(c, vendorId) : [];
  });

  ipcMain.handle('vn:upcoming-bills', (_e, { vendorId, days }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorUpcomingBills(c, vendorId, days) : [];
  });

  ipcMain.handle('vn:po-summary', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorPOSummary(c, vendorId) : {};
  });

  ipcMain.handle('vn:notes', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorNotes(c, vendorId) : [];
  });

  ipcMain.handle('vn:note-add', (_e, { vendorId, note, createdBy }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().addVendorNote(c, vendorId, note, createdBy) : {};
  });

  ipcMain.handle('vn:email-history', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorEmailHistory(c, vendorId) : [];
  });

  ipcMain.handle('vn:activity-log', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorActivityLog(c, vendorId) : [];
  });

  ipcMain.handle('vn:related', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorRelatedEntities(c, vendorId) : {};
  });

  ipcMain.handle('vn:full-snapshot', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorFullSnapshot(c, vendorId) : null;
  });

  ipcMain.handle('vn:health-check', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorHealthCheck(c) : {};
  });

  ipcMain.handle('vn:spend-forecast', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorSpendForecast(c, vendorId) : {};
  });

  ipcMain.handle('vn:comparison', (_e, { vendorIds }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorComparison(c, vendorIds) : [];
  });

  ipcMain.handle('vn:all-scores', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().allVendorScores(c) : [];
  });

  ipcMain.handle('vn:diversity', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorDiversityBreakdown(c) : [];
  });

  ipcMain.handle('vn:payment-terms', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorPaymentTermsBreakdown(c) : [];
  });

  ipcMain.handle('vn:portfolio-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorPortfolioSummary(c) : {};
  });

  ipcMain.handle('vn:quarterly-spend', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorQuarterlySpend(c, vendorId) : [];
  });

  ipcMain.handle('vn:disputes', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorDisputes(c, vendorId) : [];
  });

  ipcMain.handle('vn:w9-records', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorW9Records(c, vendorId) : [];
  });

  ipcMain.handle('vn:insurance-policies', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? vn().vendorInsurancePolicies(c, vendorId) : [];
  });
  // ─── Vendor delete (dedicated, reference-safe) ───────────────
  // The generic db:delete soft-deletes vendors but SKIPS reference
  // cleanup for soft-delete tables — so expenses/bills/POs keep
  // pointing at a now-hidden vendor, and bank_rules.action_vendor_id
  // (an enforced FK) blocks a hard delete entirely. This handler:
  //   1. Counts what references the vendor (so the UI can warn).
  //   2. Nulls EVERY reference (expenses, bills, purchase_orders,
  //      bank_rules.action_vendor_id) regardless of soft/hard.
  //   3. Soft-deletes (default → recoverable in Trash) or hard-deletes
  //      when {hard:true}.
  // Returns a clear { ok, unlinked } so the renderer can report it and
  // never masks a failure.
  ipcMain.handle('vendors:delete', (_event, { id, hard }: { id: string; hard?: boolean }) => {
    try {
      if (!id) return { error: 'No vendor id' };
      const dbi = db.getDb();
      const companyId = db.getCurrentCompanyId();
      const vendor = db.getById('vendors', id);
      if (!vendor) return { error: 'Vendor not found' };

      // Count references for the response (best-effort per table).
      const count = (sql: string): number => {
        try {
          return (dbi.prepare(sql).get(id) as any)?.c || 0;
        } catch {
          return 0;
        }
      };
      const unlinked = {
        expenses: count('SELECT COUNT(*) c FROM expenses WHERE vendor_id = ?'),
        bills: count('SELECT COUNT(*) c FROM bills WHERE vendor_id = ?'),
        purchase_orders: count('SELECT COUNT(*) c FROM purchase_orders WHERE vendor_id = ?'),
        bank_rules: count('SELECT COUNT(*) c FROM bank_rules WHERE action_vendor_id = ?'),
      };

      const tx = dbi.transaction(() => {
        const run = (sql: string) => {
          try {
            dbi.prepare(sql).run(id);
          } catch {
            /* table may not exist */
          }
        };
        // Null all enforced + soft FK references so nothing dangles.
        run('DELETE FROM vendor_locations WHERE vendor_id = ?');
        run('UPDATE expenses SET vendor_id = NULL, vendor_location_id = NULL WHERE vendor_id = ?');
        run('UPDATE bills SET vendor_id = NULL WHERE vendor_id = ?');
        run('UPDATE purchase_orders SET vendor_id = NULL WHERE vendor_id = ?');
        run('UPDATE bank_rules SET action_vendor_id = NULL WHERE action_vendor_id = ?');

        if (hard) {
          dbi.prepare('DELETE FROM vendors WHERE id = ?').run(id);
        } else {
          // Soft delete → recoverable from Trash for 30 days.
          dbi.prepare("UPDATE vendors SET deleted_at = datetime('now') WHERE id = ?").run(id);
        }
      });
      tx();

      if (companyId) {
        try {
          db.logAudit(companyId, 'vendors', id, 'delete');
        } catch {
          /* non-fatal */
        }
      }
      try {
        scheduleAutoBackup();
      } catch {
        /* non-fatal */
      }

      return { ok: true, hard: !!hard, unlinked, vendor_name: vendor.name };
    } catch (err: any) {
      return { error: err?.message || 'Delete failed' };
    }
  });
  // ─── B7: Client risk scoring ─────────────────────────
  ipcMain.handle('clients:risk-score', (_event, opts?: { client_id?: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const { scoreOneClient, scoreAllClients } = require('../../services/client-risk-scorer');
      if (opts?.client_id) {
        const r = scoreOneClient(cid, opts.client_id);
        return r ? [r] : [];
      }
      return scoreAllClients(cid);
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  // PORTAL: lets the renderer build the portal URL using the configured
  // SYNC_SERVER without hard-coding the host. Returned here (rather than
  // computed in the renderer) so a future env-driven override flows through.
  ipcMain.handle('portal:base-url', () => {
    // Returns the customer-facing portal URL — what we embed in QR codes
    // and email merge variables. This is DIFFERENT from SYNC_SERVER:
    //   • SYNC_SERVER  = backend API the desktop app talks to for sync
    //   • portal URL   = where the recipient logs in / views their invoice
    // The user can override per-company via settings table key
    // 'portal_base_url'. Defaults to the RMPG Pro Services client portal.
    const companyId = db.getCurrentCompanyId();
    let baseUrl = 'https://rmpgutahps.us/client/login';
    if (companyId) {
      try {
        const setting = db
          .getDb()
          .prepare("SELECT value FROM settings WHERE company_id = ? AND key = 'portal_base_url'")
          .get(companyId) as any;
        if (setting?.value) baseUrl = setting.value;
      } catch {
        /* fall through to default */
      }
    }
    return { baseUrl };
  });
  // ─── Client Portal Integration (rmpgutahps.us) ───────────
  // The API key is encrypted with Electron's safeStorage (OS keychain
  // backed) before being written to SQLite. Plaintext never touches
  // disk — DB backups expose only ciphertext, which is undecryptable
  // without the user's OS login.
  //
  // SECURITY NOTE: safeStorage availability depends on the OS keychain
  // being unlocked. On macOS/Windows this is normally true after login;
  // on Linux it requires libsecret. If safeStorage is unavailable, we
  // refuse to store the key and surface a clear error to the UI rather
  // than silently falling back to plaintext.
  function ensurePortalIntegrationRow(companyId: string): void {
    const existing = db
      .getDb()
      .prepare(`SELECT id FROM portal_integration_settings WHERE company_id = ?`)
      .get(companyId) as any;
    if (existing) return;
    db.getDb()
      .prepare(`INSERT INTO portal_integration_settings (id, company_id) VALUES (?, ?)`)
      .run(uuid(), companyId);
  }
  ipcMain.handle('portal-integration:get', (_event) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { error: 'No active company' };
      ensurePortalIntegrationRow(companyId);
      const row = db
        .getDb()
        .prepare(`SELECT * FROM portal_integration_settings WHERE company_id = ?`)
        .get(companyId) as any;
      // Never return the ciphertext to the renderer — only a boolean
      // indicating whether a key is stored. Treats the API key as a
      // write-only field; user must rotate by entering a new value.
      return {
        portal_base_url: row?.portal_base_url || 'https://rmpgutahps.us/client/login',
        api_endpoint: row?.api_endpoint || 'https://rmpgutahps.us/api/v1',
        auth_scheme: row?.auth_scheme || 'bearer',
        health_check_path: row?.health_check_path ?? '/health',
        auto_sync_invoices: !!row?.auto_sync_invoices,
        api_key_set: !!row?.api_key_encrypted,
        last_sync_at: row?.last_sync_at || null,
        last_sync_status: row?.last_sync_status || null,
        last_test_at: row?.last_test_at || null,
        last_test_status: row?.last_test_status || null,
        last_test_message: row?.last_test_message || '',
      };
    } catch (err: any) {
      return { error: err?.message || 'Failed to load portal integration settings' };
    }
  });
  ipcMain.handle(
    'portal-integration:save',
    async (
      _event,
      payload: {
        portal_base_url?: string;
        api_endpoint?: string;
        auth_scheme?: 'bearer' | 'apikey-header';
        health_check_path?: string;
        auto_sync_invoices?: boolean;
        api_key?: string; // plaintext — encrypted before storage
        clear_api_key?: boolean; // explicit signal to wipe the stored key
      },
    ) => {
      try {
        const companyId = db.getCurrentCompanyId();
        if (!companyId) return { error: 'No active company' };
        ensurePortalIntegrationRow(companyId);

        const { safeStorage } = await import('electron');
        const updates: Record<string, any> = {};
        if (payload.portal_base_url !== undefined)
          updates.portal_base_url = payload.portal_base_url;
        if (payload.api_endpoint !== undefined) updates.api_endpoint = payload.api_endpoint;
        if (payload.auth_scheme !== undefined) updates.auth_scheme = payload.auth_scheme;
        if (payload.health_check_path !== undefined)
          updates.health_check_path = payload.health_check_path;
        if (payload.auto_sync_invoices !== undefined)
          updates.auto_sync_invoices = payload.auto_sync_invoices ? 1 : 0;
        if (payload.clear_api_key) {
          updates.api_key_encrypted = null;
        } else if (payload.api_key !== undefined) {
          if (!safeStorage.isEncryptionAvailable()) {
            return {
              error:
                'OS keychain is not available — cannot securely store API key. Unlock your keychain (macOS Keychain Access / Windows Credential Manager) and try again.',
            };
          }
          const cipher = safeStorage.encryptString(payload.api_key);
          updates.api_key_encrypted = cipher.toString('base64');
        }
        updates.updated_at = new Date().toISOString();

        const row = db
          .getDb()
          .prepare(`SELECT id FROM portal_integration_settings WHERE company_id = ?`)
          .get(companyId) as any;
        if (row) db.update('portal_integration_settings', row.id, updates);
        scheduleAutoBackup();
        return { ok: true };
      } catch (err: any) {
        return { error: err?.message || 'Failed to save portal integration settings' };
      }
    },
  );
  // Decrypt the stored API key. Internal helper — NEVER expose this
  // via IPC. Returns null if no key is stored or decryption fails.
  async function getPortalApiKey(companyId: string): Promise<string | null> {
    try {
      const row = db
        .getDb()
        .prepare(`SELECT api_key_encrypted FROM portal_integration_settings WHERE company_id = ?`)
        .get(companyId) as any;
      if (!row?.api_key_encrypted) return null;
      const { safeStorage } = await import('electron');
      if (!safeStorage.isEncryptionAvailable()) return null;
      const buf = Buffer.from(row.api_key_encrypted, 'base64');
      return safeStorage.decryptString(buf);
    } catch {
      return null;
    }
  }
  // Test the integration: makes an authenticated GET to the configured
  // endpoint and reports back. Endpoint convention assumed:
  //   GET <api_endpoint>/ping  → 200 OK with body { ok: true, ts }
  // If your portal uses a different health-check path, configure it
  // via api_endpoint (the path is appended to the base).
  ipcMain.handle('portal-integration:test', async (_event) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { ok: false, error: 'No active company' };
      ensurePortalIntegrationRow(companyId);
      const row = db
        .getDb()
        .prepare(
          `SELECT api_endpoint, auth_scheme, health_check_path FROM portal_integration_settings WHERE company_id = ?`,
        )
        .get(companyId) as any;
      const apiKey = await getPortalApiKey(companyId);
      if (!apiKey) {
        const msg = 'API key not configured';
        db.update(
          'portal_integration_settings',
          (
            db
              .getDb()
              .prepare(`SELECT id FROM portal_integration_settings WHERE company_id = ?`)
              .get(companyId) as any
          ).id,
          {
            last_test_at: new Date().toISOString(),
            last_test_status: 'no_key',
            last_test_message: msg,
          },
        );
        return { ok: false, error: msg };
      }
      const endpoint = (row?.api_endpoint || 'https://rmpgutahps.us/api/v1').replace(/\/$/, '');
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (row?.auth_scheme === 'apikey-header') {
        headers['X-API-Key'] = apiKey;
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      // Configurable health-check path so users can adapt to whatever
      // endpoint their portal actually exposes (Laravel /health,
      // Express /status, REST /api/v1, etc.). Empty string = base URL.
      const rawPath = (row?.health_check_path ?? '/health').toString().trim();
      const path = rawPath && !rawPath.startsWith('/') ? `/${rawPath}` : rawPath;
      const url = `${endpoint}${path}`;
      const start = Date.now();
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10_000),
      }).catch((err: any) => {
        throw new Error(`Network error: ${err?.message || err}`);
      });
      const elapsed = Date.now() - start;
      const txt = await res.text().catch(() => '');
      const status = res.ok ? 'success' : `http_${res.status}`;
      const message = res.ok
        ? `Connected (${elapsed}ms)`
        : `HTTP ${res.status} ${res.statusText} — ${txt.slice(0, 200)}`;
      const updateRow = db
        .getDb()
        .prepare(`SELECT id FROM portal_integration_settings WHERE company_id = ?`)
        .get(companyId) as any;
      if (updateRow) {
        db.update('portal_integration_settings', updateRow.id, {
          last_test_at: new Date().toISOString(),
          last_test_status: status,
          last_test_message: message,
        });
      }
      return { ok: res.ok, status: res.status, elapsedMs: elapsed, message };
    } catch (err: any) {
      const message = err?.message || 'Test failed';
      try {
        const companyId = db.getCurrentCompanyId();
        if (companyId) {
          const r = db
            .getDb()
            .prepare(`SELECT id FROM portal_integration_settings WHERE company_id = ?`)
            .get(companyId) as any;
          if (r)
            db.update('portal_integration_settings', r.id, {
              last_test_at: new Date().toISOString(),
              last_test_status: 'error',
              last_test_message: message,
            });
        }
      } catch {
        /* ignore */
      }
      return { ok: false, error: message };
    }
  });
  // ─── Client Contacts ──────────────────────────────────
  ipcMain.handle('client:contacts-list', (_event, clientId: string) => {
    try {
      return db.queryAll(
        'client_contacts',
        { client_id: clientId },
        { field: 'is_primary', dir: 'desc' },
      );
    } catch {
      return [];
    }
  });
  ipcMain.handle(
    'client:contacts-save',
    (_event, { clientId, contacts }: { clientId: string; contacts: any[] }) => {
      try {
        const saveContacts = db.getDb().transaction(() => {
          db.getDb().prepare('DELETE FROM client_contacts WHERE client_id = ?').run(clientId);
          return contacts.map((c) =>
            db.create('client_contacts', {
              id: c.id || undefined,
              client_id: clientId,
              name: c.name || '',
              title: c.title || '',
              email: c.email || '',
              phone: c.phone || '',
              is_primary: c.is_primary ? 1 : 0,
            }),
          );
        });
        const inserted = saveContacts();
        scheduleAutoBackup();
        return inserted;
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
  // ─── Client Insights ─────────────────────────────────────
  ipcMain.handle('client:insights', (_event, { clientId }: { clientId: string }) => {
    const dbI = db.getDb();
    const cid = db.getCurrentCompanyId();
    if (!cid)
      return {
        total_invoiced: 0,
        total_paid: 0,
        outstanding: 0,
        avg_payment_days: 0,
        status_breakdown: [],
        payment_history: [],
        active_projects: 0,
        lifetime_value: 0,
      };

    const invoiced = dbI
      .prepare(
        'SELECT COALESCE(SUM(total), 0) as total FROM invoices WHERE client_id = ? AND company_id = ?',
      )
      .get(clientId, cid) as any;
    const paid = dbI
      .prepare(
        'SELECT COALESCE(SUM(amount_paid), 0) as total FROM invoices WHERE client_id = ? AND company_id = ?',
      )
      .get(clientId, cid) as any;
    const outstanding = dbI
      .prepare(
        "SELECT COALESCE(SUM(total - amount_paid), 0) as total FROM invoices WHERE client_id = ? AND company_id = ? AND status NOT IN ('paid','void','cancelled')",
      )
      .get(clientId, cid) as any;
    const avgDays = dbI
      .prepare(
        "SELECT AVG(julianday(updated_at) - julianday(issue_date)) as avg_days FROM invoices WHERE client_id = ? AND company_id = ? AND status = 'paid'",
      )
      .get(clientId, cid) as any;
    const statusBreakdown = dbI
      .prepare(
        'SELECT status, COUNT(*) as count FROM invoices WHERE client_id = ? AND company_id = ? GROUP BY status',
      )
      .all(clientId, cid);
    const paymentHistory = dbI
      .prepare(
        `
      SELECT strftime('%Y-%m', updated_at) as month, SUM(amount_paid) as total
      FROM invoices WHERE client_id = ? AND company_id = ? AND status = 'paid'
      GROUP BY month ORDER BY month DESC LIMIT 12
    `,
      )
      .all(clientId, cid);
    const projects = dbI
      .prepare(
        "SELECT COUNT(*) as count FROM projects WHERE client_id = ? AND company_id = ? AND status != 'completed'",
      )
      .get(clientId, cid) as any;
    const lifetime = dbI
      .prepare(
        'SELECT COALESCE(SUM(amount_paid), 0) as total FROM invoices WHERE client_id = ? AND company_id = ?',
      )
      .get(clientId, cid) as any;

    return {
      total_invoiced: invoiced?.total || 0,
      total_paid: paid?.total || 0,
      outstanding: outstanding?.total || 0,
      avg_payment_days: Math.round(avgDays?.avg_days || 0),
      status_breakdown: statusBreakdown,
      payment_history: paymentHistory,
      active_projects: projects?.count || 0,
      lifetime_value: lifetime?.total || 0,
    };
  });
}

// ── Helpers for tag rules ──

function matchTagCondition(entity: any, cond: any): boolean {
  if (!cond || typeof cond !== 'object') return false;
  const evalOne = (c: any) => {
    const v = entity?.[c.field];
    switch (c.op) {
      case '=':
      case 'eq':
        return v == c.value;
      case '!=':
      case 'ne':
        return v != c.value;
      case '>':
        return Number(v) > Number(c.value);
      case '<':
        return Number(v) < Number(c.value);
      case '>=':
        return Number(v) >= Number(c.value);
      case '<=':
        return Number(v) <= Number(c.value);
      case 'contains':
        return String(v ?? '')
          .toLowerCase()
          .includes(String(c.value ?? '').toLowerCase());
      case 'in':
        return Array.isArray(c.value) && c.value.includes(v);
      case 'empty':
        return v === null || v === undefined || v === '';
      case 'not_empty':
        return !(v === null || v === undefined || v === '');
      default:
        return false;
    }
  };
  if (Array.isArray(cond.all)) return cond.all.every(evalOne);
  if (Array.isArray(cond.any)) return cond.any.some(evalOne);
  if (cond.field) return evalOne(cond);
  return false;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}
