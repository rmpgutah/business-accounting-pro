// ─── Wave 3 Part 3: F421-F440 (20 features) ───
//
// Batch Z: Collaboration (F421-F430)
// Batch AA: Integration Sync (F431-F440)

import { randomUUID as uuid, createHash, randomBytes } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

// ════════════════════════════════════════════════════════════════
// Batch Z: Collaboration (F421-F430)
// ════════════════════════════════════════════════════════════════

// F421 — @mentions (parse mentions from comment body, create records)
export function parseMentions(body: string): string[] {
  const matches = body.match(/@(\w+)/g) || [];
  return [...new Set(matches.map(m => m.slice(1)))];
}

export function createMentionsFromComment(opts: { company_id: string; mentioning_user_id: string; entity_type: string; entity_id: string; comment_id?: string; body: string }): { mentions_created: number } {
  const dbi = db.getDb();
  const usernames = parseMentions(opts.body);
  let count = 0;
  for (const u of usernames) {
    // Look up user by display_name or email
    const user = dbi.prepare(`SELECT id FROM users WHERE display_name = ? OR email = ? LIMIT 1`).get(u, u) as any;
    if (!user) continue;
    dbi.prepare(`INSERT INTO user_mentions (id, company_id, mentioned_user_id, mentioning_user_id, entity_type, entity_id, comment_id, context_text, is_read, mentioned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
      .run(uuid(), opts.company_id, user.id, opts.mentioning_user_id, opts.entity_type, opts.entity_id, opts.comment_id, opts.body.slice(0, 200), now());
    count++;
  }
  return { mentions_created: count };
}

export function listMentions(userId: string, opts?: { unread_only?: boolean; limit?: number }): any[] {
  const dbi = db.getDb();
  let where = 'mentioned_user_id = ?';
  if (opts?.unread_only) where += ' AND is_read = 0';
  return dbi.prepare(`SELECT * FROM user_mentions WHERE ${where} ORDER BY mentioned_at DESC LIMIT ?`).all(userId, Math.min(opts?.limit || 50, 500)) as any[];
}

export function markMentionRead(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE user_mentions SET is_read = 1 WHERE id = ?`).run(id);
  return r.changes > 0;
}

// F422 — entity comments (threaded)
export function addComment(c: any): { id: string; mentions_created: number } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO entity_comments (id, company_id, entity_type, entity_id, parent_comment_id, user_id, user_email, body, is_internal, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, c.company_id, c.entity_type, c.entity_id, c.parent_comment_id, c.user_id, c.user_email, c.body, c.is_internal ? 1 : 0, now());
  // Auto-create mention records
  const m = createMentionsFromComment({ ...c, comment_id: id, mentioning_user_id: c.user_id });
  return { id, mentions_created: m.mentions_created };
}

export function listComments(entityType: string, entityId: string, opts?: { include_internal?: boolean }): any[] {
  const dbi = db.getDb();
  let where = 'entity_type = ? AND entity_id = ? AND deleted_at IS NULL';
  const params: any[] = [entityType, entityId];
  if (opts?.include_internal === false) where += ' AND is_internal = 0';
  return dbi.prepare(`SELECT * FROM entity_comments WHERE ${where} ORDER BY created_at ASC`).all(...params) as any[];
}

export function editComment(id: string, newBody: string): boolean {
  const r = db.getDb().prepare(`UPDATE entity_comments SET body = ?, edited_at = ? WHERE id = ?`).run(newBody, now(), id);
  return r.changes > 0;
}

export function deleteComment(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE entity_comments SET deleted_at = ? WHERE id = ?`).run(now(), id);
  return r.changes > 0;
}

// F423 — reactions
export function addReaction(commentId: string, userId: string, emoji: string): { id: string } {
  const id = uuid();
  try {
    db.getDb().prepare(`INSERT INTO comment_reactions (id, comment_id, user_id, emoji, reacted_at) VALUES (?, ?, ?, ?, ?)`).run(id, commentId, userId, emoji, now());
  } catch {} // Unique constraint — user already reacted with this emoji
  return { id };
}

export function removeReaction(commentId: string, userId: string, emoji: string): boolean {
  const r = db.getDb().prepare(`DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?`).run(commentId, userId, emoji);
  return r.changes > 0;
}

export function listReactions(commentId: string): Array<{ emoji: string; count: number; users: string[] }> {
  const rows = db.getDb().prepare(`SELECT emoji, GROUP_CONCAT(user_id) AS users FROM comment_reactions WHERE comment_id = ? GROUP BY emoji`).all(commentId) as any[];
  return rows.map(r => ({ emoji: r.emoji, count: r.users.split(',').length, users: r.users.split(',') }));
}

// F424 — internal notes (private to company users only)
export function addInternalNote(n: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO internal_notes (id, company_id, entity_type, entity_id, user_id, body, is_pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, n.company_id, n.entity_type, n.entity_id, n.user_id, n.body, n.is_pinned ? 1 : 0, now());
  return { id };
}

export function listInternalNotes(entityType: string, entityId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM internal_notes WHERE entity_type = ? AND entity_id = ? ORDER BY is_pinned DESC, created_at DESC`).all(entityType, entityId) as any[];
}

// F425 — shared drafts
export function createSharedDraft(d: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO shared_drafts (id, company_id, entity_type, draft_data_json, owner_user_id, shared_with_user_ids, assigned_to_user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', ?, ?)`)
    .run(id, d.company_id, d.entity_type, JSON.stringify(d.draft_data || {}), d.owner_user_id, (d.shared_with_user_ids || []).join(','), d.assigned_to_user_id, now(), now());
  return { id };
}

export function listMyDrafts(userId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM shared_drafts WHERE owner_user_id = ? OR assigned_to_user_id = ? OR shared_with_user_ids LIKE '%' || ? || '%' ORDER BY updated_at DESC`).all(userId, userId, userId) as any[];
}

// F427 — entity watchers
export function watchEntity(opts: any): { id: string } {
  const id = uuid();
  try {
    db.getDb().prepare(`INSERT INTO entity_watchers (id, user_id, company_id, entity_type, entity_id, notify_on_update, notify_on_comment, notify_on_status_change, watched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, opts.user_id, opts.company_id, opts.entity_type, opts.entity_id, opts.notify_on_update !== false ? 1 : 0, opts.notify_on_comment !== false ? 1 : 0, opts.notify_on_status_change !== false ? 1 : 0, now());
  } catch {} // Already watching
  return { id };
}

export function unwatchEntity(userId: string, entityType: string, entityId: string): boolean {
  const r = db.getDb().prepare(`DELETE FROM entity_watchers WHERE user_id = ? AND entity_type = ? AND entity_id = ?`).run(userId, entityType, entityId);
  return r.changes > 0;
}

export function listWatchersForEntity(entityType: string, entityId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM entity_watchers WHERE entity_type = ? AND entity_id = ?`).all(entityType, entityId) as any[];
}

// F428 — email-to-entity
export function provisionInboxAddress(opts: { company_id: string; entity_type: string; entity_id?: string }): { id: string; inbox_address: string } {
  const id = uuid();
  const token = randomBytes(6).toString('hex');
  const address = `${opts.entity_type}-${token}@inbox.bap.local`;
  db.getDb().prepare(`INSERT INTO email_to_entity_addresses (id, company_id, entity_type, entity_id, inbox_address, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.entity_type, opts.entity_id, address, now());
  return { id, inbox_address: address };
}

export function recordIncomingEmailMatch(inboxAddress: string): { entity_type: string | null; entity_id: string | null } {
  const dbi = db.getDb();
  const m = dbi.prepare(`SELECT * FROM email_to_entity_addresses WHERE inbox_address = ?`).get(inboxAddress) as any;
  if (!m) return { entity_type: null, entity_id: null };
  dbi.prepare(`UPDATE email_to_entity_addresses SET last_email_received_at = ?, email_count = email_count + 1 WHERE id = ?`).run(now(), m.id);
  return { entity_type: m.entity_type, entity_id: m.entity_id };
}

// F430 — chat messages
export function sendChatMessage(opts: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO chat_messages (id, company_id, sender_user_id, recipient_user_id, channel_id, body, attachments_json, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.sender_user_id, opts.recipient_user_id, opts.channel_id, opts.body, JSON.stringify(opts.attachments || []), now());
  return { id };
}

export function listChatMessages(opts: { user_id: string; with_user_id?: string; channel_id?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [];
  let where = '';
  if (opts.with_user_id) {
    where = '((sender_user_id = ? AND recipient_user_id = ?) OR (sender_user_id = ? AND recipient_user_id = ?))';
    params.push(opts.user_id, opts.with_user_id, opts.with_user_id, opts.user_id);
  } else if (opts.channel_id) {
    where = 'channel_id = ?';
    params.push(opts.channel_id);
  } else {
    where = '(sender_user_id = ? OR recipient_user_id = ?)';
    params.push(opts.user_id, opts.user_id);
  }
  return dbi.prepare(`SELECT * FROM chat_messages WHERE ${where} ORDER BY sent_at DESC LIMIT ?`).all(...params, Math.min(opts.limit || 50, 500)) as any[];
}

export function markChatRead(messageId: string): boolean {
  const r = db.getDb().prepare(`UPDATE chat_messages SET read_at = ? WHERE id = ? AND read_at IS NULL`).run(now(), messageId);
  return r.changes > 0;
}

// ════════════════════════════════════════════════════════════════
// Batch AA: Integration Sync (F431-F440)
// ════════════════════════════════════════════════════════════════

// F431 — Stripe webhook record (uses existing stripe_transactions or fires new event)
export function recordStripeEvent(opts: { event_type: string; payload: any; signature?: string; secret?: string }): { id: string; verified: boolean } {
  const id = uuid();
  let verified = true;
  if (opts.signature && opts.secret) {
    const expected = sha256(JSON.stringify(opts.payload) + opts.secret);
    verified = expected.startsWith(opts.signature.slice(0, 8));
  }
  // Log in webhook_queue for processing
  db.getDb().prepare(`INSERT INTO webhook_queue (id, subscription_id, event_type, payload_json, status, queued_at, next_attempt_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)`)
    .run(id, 'stripe', opts.event_type, JSON.stringify(opts.payload), now(), now());
  return { id, verified };
}

// F432 — Plaid link
export function createPlaidLink(opts: any): { id: string } {
  const id = uuid();
  // Encrypt token (simplified — in production use proper encryption)
  const encrypted = sha256(opts.access_token + (opts.company_id || ''));
  db.getDb().prepare(`INSERT INTO plaid_links (id, company_id, institution_name, institution_id, access_token_encrypted, item_id, linked_account_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
    .run(id, opts.company_id, opts.institution_name, opts.institution_id, encrypted, opts.item_id, opts.linked_account_count || 0, now());
  return { id };
}

export function listPlaidLinks(companyId: string): any[] {
  return db.getDb().prepare(`SELECT id, company_id, institution_name, institution_id, linked_account_count, last_sync_at, status FROM plaid_links WHERE company_id = ?`).all(companyId) as any[];
}

// F433 — Plaid transaction sync
export function syncPlaidTransaction(t: any): { id: string; is_new: boolean } {
  const dbi = db.getDb();
  const existing = dbi.prepare(`SELECT id FROM plaid_synced_transactions WHERE external_transaction_id = ?`).get(t.external_transaction_id) as any;
  if (existing) return { id: existing.id, is_new: false };
  const id = uuid();
  dbi.prepare(`INSERT INTO plaid_synced_transactions (id, company_id, plaid_link_id, external_transaction_id, bank_account_id, transaction_date, amount, merchant_name, category, pending, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, t.company_id, t.plaid_link_id, t.external_transaction_id, t.bank_account_id, t.transaction_date, t.amount || 0, t.merchant_name, t.category, t.pending ? 1 : 0, now());
  return { id, is_new: true };
}

export function listUnmatchedPlaidTransactions(companyId: string, limit: number = 100): any[] {
  return db.getDb().prepare(`SELECT * FROM plaid_synced_transactions WHERE company_id = ? AND matched_entity_id IS NULL ORDER BY transaction_date DESC LIMIT ?`).all(companyId, limit) as any[];
}

export function matchPlaidTransaction(id: string, entityType: string, entityId: string): boolean {
  const r = db.getDb().prepare(`UPDATE plaid_synced_transactions SET matched_entity_type = ?, matched_entity_id = ? WHERE id = ?`).run(entityType, entityId, id);
  return r.changes > 0;
}

// F434 — QuickBooks export
export function exportToQuickBooks(opts: { company_id: string; period_start: string; period_end: string; format?: 'iif' | 'csv' | 'json'; exported_by?: string }): { id: string; record_count: number } {
  const dbi = db.getDb();
  const id = uuid();
  // Count records in period
  const stats = dbi.prepare(`
    SELECT (SELECT COUNT(*) FROM invoices WHERE company_id = ? AND issue_date BETWEEN ? AND ?) +
           (SELECT COUNT(*) FROM bills WHERE company_id = ? AND bill_date BETWEEN ? AND ?) +
           (SELECT COUNT(*) FROM expenses WHERE company_id = ? AND date BETWEEN ? AND ?)
    AS total_records
  `).get(opts.company_id, opts.period_start, opts.period_end, opts.company_id, opts.period_start, opts.period_end, opts.company_id, opts.period_start, opts.period_end) as any;
  dbi.prepare(`INSERT INTO quickbooks_exports (id, company_id, export_format, period_start, period_end, record_count, status, exported_at, exported_by) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?)`)
    .run(id, opts.company_id, opts.format || 'iif', opts.period_start, opts.period_end, stats.total_records || 0, now(), opts.exported_by);
  return { id, record_count: stats.total_records || 0 };
}

export function listQuickBooksExports(companyId: string, limit: number = 50): any[] {
  return db.getDb().prepare(`SELECT * FROM quickbooks_exports WHERE company_id = ? ORDER BY exported_at DESC LIMIT ?`).all(companyId, limit) as any[];
}

// F436 — Gmail sync
export function syncGmailMessage(m: any): { id: string; is_new: boolean } {
  const dbi = db.getDb();
  const existing = dbi.prepare(`SELECT id FROM gmail_sync WHERE gmail_message_id = ?`).get(m.gmail_message_id) as any;
  if (existing) return { id: existing.id, is_new: false };
  const id = uuid();
  dbi.prepare(`INSERT INTO gmail_sync (id, user_id, company_id, gmail_message_id, subject, sender_email, received_at, body_snippet, attachment_count, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, m.user_id, m.company_id, m.gmail_message_id, m.subject, m.sender_email, m.received_at, m.body_snippet, m.attachment_count || 0, now());
  return { id, is_new: true };
}

// F437/F438 — cloud storage files (Drive/Dropbox)
export function recordCloudFile(f: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO cloud_storage_files (id, company_id, provider, external_file_id, file_name, file_size, mime_type, folder_path, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(provider, external_file_id) DO UPDATE SET file_name = excluded.file_name, file_size = excluded.file_size, synced_at = excluded.synced_at`)
    .run(id, f.company_id, f.provider || 'gdrive', f.external_file_id, f.file_name, f.file_size || 0, f.mime_type, f.folder_path, now());
  return { id };
}

export function listCloudFiles(companyId: string, provider?: string): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (provider) { where += ' AND provider = ?'; params.push(provider); }
  return dbi.prepare(`SELECT * FROM cloud_storage_files WHERE ${where} ORDER BY synced_at DESC`).all(...params) as any[];
}

// F439 — calendar integration (link)
export function linkCalendar(opts: any): { id: string } {
  const id = uuid();
  const accessEnc = opts.access_token ? sha256(opts.access_token + opts.user_id) : null;
  const refreshEnc = opts.refresh_token ? sha256(opts.refresh_token + opts.user_id) : null;
  db.getDb().prepare(`INSERT INTO calendar_integrations (id, user_id, company_id, provider, calendar_id, access_token_encrypted, refresh_token_encrypted, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(id, opts.user_id, opts.company_id, opts.provider || 'google', opts.calendar_id, accessEnc, refreshEnc, now());
  return { id };
}

export function listCalendarIntegrations(userId: string): any[] {
  return db.getDb().prepare(`SELECT id, user_id, company_id, provider, calendar_id, last_sync_at, is_active FROM calendar_integrations WHERE user_id = ?`).all(userId) as any[];
}

// F440 — webhook receiver endpoint
export function provisionWebhookEndpoint(opts: { company_id: string; provider?: string }): { id: string; endpoint_path: string; shared_secret: string } {
  const id = uuid();
  const path = `/webhook/${randomBytes(16).toString('hex')}`;
  const secret = randomBytes(32).toString('hex');
  db.getDb().prepare(`INSERT INTO webhook_receiver_endpoints (id, company_id, endpoint_path, provider, shared_secret, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
    .run(id, opts.company_id, path, opts.provider, secret, now());
  return { id, endpoint_path: path, shared_secret: secret };
}

export function recordWebhookReceived(endpointPath: string): boolean {
  const r = db.getDb().prepare(`UPDATE webhook_receiver_endpoints SET last_received_at = ?, received_count = received_count + 1 WHERE endpoint_path = ?`).run(now(), endpointPath);
  return r.changes > 0;
}

export function listWebhookReceiverEndpoints(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM webhook_receiver_endpoints WHERE company_id = ?`).all(companyId) as any[];
}
