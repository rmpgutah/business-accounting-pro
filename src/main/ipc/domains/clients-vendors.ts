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
