import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CLIENT_VENDOR_DOC_FEAT: Record<string, FeatSpec<any>> = {
  'feat:client:merge': {
    call: (s, { primary_id, duplicate_ids }: any) => s.mergeClients(primary_id, duplicate_ids),
    mutates: true,
  },
  'feat:client:find-duplicates': {
    call: (s, opts: any = {}, { cid }) => s.findClientDuplicates(cid!, opts),
    requiresCompany: [],
  },
  'feat:tag:add': {
    call: (s, record: any, { cid }) => s.addTag({ ...record, company_id: cid }),
    mutates: true,
  },
  'feat:tag:remove': { call: (s, { id }: any) => ({ ok: s.removeTag(id) }), mutates: true },
  'feat:tag:list-entity': {
    call: (s, { entity_type, entity_id }: any, { cid }) =>
      s.listEntityTags(cid!, entity_type, entity_id),
    requiresCompany: [],
  },
  'feat:tag:list-all': {
    call: (s, { entity_type }: any = {}, { cid }) => s.listAllTags(cid!, entity_type),
    requiresCompany: [],
  },
  'feat:tag:search': {
    call: (s, { entity_type, tag }: any, { cid }) => s.searchByTag(cid!, entity_type, tag),
    requiresCompany: [],
  },
  'feat:communication:log': {
    call: (s, record: any, { cid }) => s.logCommunication({ ...record, company_id: cid }),
    mutates: true,
  },
  'feat:communication:list': {
    call: (s, { client_id, ...opts }: any) => s.listCommunications(client_id, opts),
  },
  'feat:communication:follow-ups': {
    call: (s, _p: any, { cid }) => s.pendingFollowUps(cid!),
    requiresCompany: [],
  },
  'feat:vendor:1099-status': {
    call: (s, { year }: any, { cid }) => s.checkVendor1099Status(cid!, year),
    requiresCompany: [],
  },
  'feat:vendor:scorecard': {
    call: (s, { vendor_id, lookback_days }: any, { cid }) =>
      s.computeVendorScorecard(cid!, vendor_id, lookback_days),
    requiresCompany: null,
  },
  'feat:vendor:set-contract': {
    call: (s, { vendor_id, contract }: any) => ({ ok: s.setVendorContract(vendor_id, contract) }),
    mutates: true,
  },
  'feat:vendor:expiring-contracts': {
    call: (s, { days_ahead }: any = {}, { cid }) => s.getExpiringContracts(cid!, days_ahead),
    requiresCompany: [],
  },
  'feat:document:set-expiration': {
    call: (s, { document_id, expires_at, reminder_days_before }: any) => ({
      ok: s.setDocumentExpiration(document_id, expires_at, reminder_days_before),
    }),
    mutates: true,
  },
  'feat:document:expiring': {
    call: (s, { days_ahead }: any = {}, { cid }) => s.expiringDocuments(cid!, days_ahead),
    requiresCompany: [],
  },
  'feat:document:add-version': {
    call: (s, record: any) => s.addDocumentVersion(record),
    mutates: true,
  },
  'feat:document:list-versions': {
    call: (s, { document_id }: any) => s.listDocumentVersions(document_id),
  },
  'feat:document:set-encrypted': {
    call: (s, { document_id, is_encrypted }: any) =>
      s.setDocumentEncrypted(document_id, is_encrypted),
    mutates: true,
  },
};

export function registerClientVendorDocFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('client-vendor-doc-features'), CLIENT_VENDOR_DOC_FEAT);
}
