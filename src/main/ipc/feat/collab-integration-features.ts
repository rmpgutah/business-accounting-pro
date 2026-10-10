import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const COLLAB_INTEGRATION_FEAT: Record<string, FeatSpec<any>> = {
  'feat:mentions:parse': { call: (s, { body }: any) => s.parseMentions(body) },
  'feat:mentions:list': { call: (s, { user_id, ...opts }: any) => s.listMentions(user_id, opts) },
  'feat:mentions:mark-read': {
    call: (s, { id }: any) => ({ ok: s.markMentionRead(id) }),
    mutates: true,
  },
  'feat:comment:add': {
    call: (s, c: any, { cid }) => s.addComment({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:comment:list': {
    call: (s, { entity_type, entity_id, ...opts }: any) =>
      s.listComments(entity_type, entity_id, opts),
  },
  'feat:comment:edit': { call: (s, { id, body }: any) => ({ ok: s.editComment(id, body) }) },
  'feat:comment:delete': { call: (s, { id }: any) => ({ ok: s.deleteComment(id) }), mutates: true },
  'feat:reaction:add': {
    call: (s, { comment_id, user_id, emoji }: any) => s.addReaction(comment_id, user_id, emoji),
    mutates: true,
  },
  'feat:reaction:remove': {
    call: (s, { comment_id, user_id, emoji }: any) => ({
      ok: s.removeReaction(comment_id, user_id, emoji),
    }),
    mutates: true,
  },
  'feat:reaction:list': { call: (s, { comment_id }: any) => s.listReactions(comment_id) },
  'feat:internal-note:add': {
    call: (s, n: any, { cid }) => s.addInternalNote({ ...n, company_id: cid }),
    mutates: true,
  },
  'feat:internal-note:list': {
    call: (s, { entity_type, entity_id }: any) => s.listInternalNotes(entity_type, entity_id),
  },
  'feat:draft:create': {
    call: (s, d: any, { cid }) => s.createSharedDraft({ ...d, company_id: cid }),
    mutates: true,
  },
  'feat:draft:mine': { call: (s, { user_id }: any) => s.listMyDrafts(user_id) },
  'feat:watch:add': {
    call: (s, opts: any, { cid }) => s.watchEntity({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:watch:remove': {
    call: (s, { user_id, entity_type, entity_id }: any) => ({
      ok: s.unwatchEntity(user_id, entity_type, entity_id),
    }),
    mutates: true,
  },
  'feat:watch:list-for-entity': {
    call: (s, { entity_type, entity_id }: any) => s.listWatchersForEntity(entity_type, entity_id),
  },
  'feat:inbox:provision': {
    call: (s, opts: any, { cid }) => s.provisionInboxAddress({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:inbox:match': {
    call: (s, { inbox_address }: any) => s.recordIncomingEmailMatch(inbox_address),
    mutates: true,
  },
  'feat:chat:send': {
    call: (s, opts: any, { cid }) => s.sendChatMessage({ ...opts, company_id: cid }),
  },
  'feat:chat:list': { call: (s, opts: any) => s.listChatMessages(opts) },
  'feat:chat:mark-read': { call: (s, { id }: any) => ({ ok: s.markChatRead(id) }), mutates: true },
  'feat:stripe:record': { call: (s, opts: any) => s.recordStripeEvent(opts), mutates: true },
  'feat:plaid-link:create': {
    call: (s, opts: any, { cid }) => s.createPlaidLink({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:plaid-link:list': {
    call: (s, _p: any, { cid }) => s.listPlaidLinks(cid!),
    requiresCompany: [],
  },
  'feat:plaid-tx:sync': {
    call: (s, t: any, { cid }) => s.syncPlaidTransaction({ ...t, company_id: cid }),
  },
  'feat:plaid-tx:unmatched': {
    call: (s, { limit }: any = {}, { cid }) => s.listUnmatchedPlaidTransactions(cid!, limit),
    requiresCompany: [],
  },
  'feat:plaid-tx:match': {
    call: (s, { id, entity_type, entity_id }: any) => ({
      ok: s.matchPlaidTransaction(id, entity_type, entity_id),
    }),
  },
  'feat:qb-export:run': {
    call: (s, opts: any, { cid }) => s.exportToQuickBooks({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:qb-export:list': {
    call: (s, { limit }: any = {}, { cid }) => s.listQuickBooksExports(cid!, limit),
    requiresCompany: [],
  },
  'feat:gmail:sync': {
    call: (s, m: any, { cid }) => s.syncGmailMessage({ ...m, company_id: cid }),
  },
  'feat:cloud-file:record': {
    call: (s, f: any, { cid }) => s.recordCloudFile({ ...f, company_id: cid }),
    mutates: true,
  },
  'feat:cloud-file:list': {
    call: (s, { provider }: any = {}, { cid }) => s.listCloudFiles(cid!, provider),
    requiresCompany: [],
  },
  'feat:calendar:link': {
    call: (s, opts: any, { cid }) => s.linkCalendar({ ...opts, company_id: cid }),
  },
  'feat:calendar:integrations': {
    call: (s, { user_id }: any) => s.listCalendarIntegrations(user_id),
  },
  'feat:webhook-recv:provision': {
    call: (s, opts: any, { cid }) => s.provisionWebhookEndpoint({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:webhook-recv:received': {
    call: (s, { endpoint_path }: any) => ({ ok: s.recordWebhookReceived(endpoint_path) }),
    mutates: true,
  },
  'feat:webhook-recv:list': {
    call: (s, _p: any, { cid }) => s.listWebhookReceiverEndpoints(cid!),
    requiresCompany: [],
  },
};

export function registerCollabIntegrationFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('collab-integration-features'), COLLAB_INTEGRATION_FEAT);
}
