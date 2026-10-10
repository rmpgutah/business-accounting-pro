import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const COMPLIANCE_SECURITY_FEAT: Record<string, FeatSpec<any>> = {
  'feat:retention:upsert': {
    call: (s, p: any, { cid }) => s.upsertRetentionPolicy({ ...p, company_id: cid }),
    mutates: true,
  },
  'feat:retention:list': {
    call: (s, _p: any, { cid }) => s.listRetentionPolicies(cid!),
    requiresCompany: [],
  },
  'feat:retention:apply': {
    call: (s, { policy_id }: any) => s.applyRetentionPolicy(policy_id),
    mutates: true,
  },
  'feat:dsr:create': {
    call: (s, r: any, { cid }) => s.createDataSubjectRequest({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:dsr:export': {
    call: (s, { subject_email }: any, { cid }) => s.exportSubjectData(cid!, subject_email),
    mutates: true,
    requiresCompany: null,
  },
  'feat:dsr:complete': {
    call: (s, { id, fulfilled_by, export_path }: any) => ({
      ok: s.completeDsr(id, fulfilled_by, export_path),
    }),
    mutates: true,
  },
  'feat:dsr:list': {
    call: (s, opts: any = {}, { cid }) => s.listDsrs(cid!, opts),
    requiresCompany: [],
  },
  'feat:anonymize:subject': {
    call: (s, opts: any, { cid }) => s.anonymizeSubject(cid!, opts),
    mutates: true,
    requiresCompany: null,
  },
  'feat:anonymize:list': {
    call: (s, { limit }: any = {}, { cid }) => s.listAnonymizations(cid!, limit),
    mutates: true,
    requiresCompany: [],
  },
  'feat:audit:record': {
    call: (s, e: any, { cid }) => {
      s.recordAuditEvent({ ...e, company_id: cid });
      return { ok: true };
    },
    mutates: true,
  },
  'feat:audit:history': {
    call: (s, { entity_type, entity_id, limit }: any, { cid }) =>
      s.getEntityAuditHistory(cid!, entity_type, entity_id, limit),
    requiresCompany: [],
  },
  'feat:session:log': {
    call: (svc, s: any, { cid }) => svc.logSession({ ...s, company_id: cid }),
    mutates: true,
  },
  'feat:session:logout': { call: (s, { session_id }: any) => ({ ok: s.logLogout(session_id) }) },
  'feat:session:list': { call: (s, { user_id, limit }: any) => s.listSessions(user_id, limit) },
  'feat:whitelist:add': {
    call: (s, w: any, { cid }) => s.addToWhitelist({ ...w, company_id: cid }),
    mutates: true,
  },
  'feat:whitelist:remove': {
    call: (s, { id }: any) => ({ ok: s.removeFromWhitelist(id) }),
    mutates: true,
  },
  'feat:whitelist:list': {
    call: (s, { active_only }: any = {}, { cid }) => s.listWhitelist(cid!, active_only !== false),
    requiresCompany: [],
  },
  'feat:whitelist:check': {
    call: (s, { ip }: any, { cid }) => s.isIpAllowed(cid!, ip),
    requiresCompany: true,
  },
  'feat:2fa:setup': {
    call: (s, { user_id, method }: any) => s.setup2FA(user_id, method),
    mutates: true,
  },
  'feat:2fa:enable': {
    call: (s, { user_id }: any) => ({ ok: s.enable2FA(user_id) }),
    mutates: true,
  },
  'feat:2fa:disable': {
    call: (s, { user_id }: any) => ({ ok: s.disable2FA(user_id) }),
    mutates: true,
  },
  'feat:2fa:status': { call: (s, { user_id }: any) => s.get2FAStatus(user_id) },
  'feat:api-token:create': {
    call: (s, opts: any, { cid }) => s.createApiToken(cid!, opts),
    mutates: true,
    requiresCompany: null,
  },
  'feat:api-token:verify': { call: (s, { plaintext }: any) => s.verifyApiToken(plaintext) },
  'feat:api-token:revoke': {
    call: (s, { id }: any) => ({ ok: s.revokeApiToken(id) }),
    mutates: true,
  },
  'feat:api-token:list': {
    call: (s, { include_revoked }: any = {}, { cid }) => s.listApiTokens(cid!, !!include_revoked),
    requiresCompany: [],
  },
  'feat:rate-limit:upsert': {
    call: (s, r: any, { cid }) => s.upsertRateLimit({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:api-request:log': {
    call: (s, r: any, { cid }) => {
      s.logApiRequest({ ...r, company_id: cid });
      return { ok: true };
    },
    mutates: true,
  },
  'feat:rate-limit:check': { call: (s, { token_id }: any) => s.checkRateLimit(token_id) },
  'feat:webhook:rotate': {
    call: (s, { subscription_id, rotated_by, reason }: any) =>
      s.rotateWebhookSecret(subscription_id, rotated_by, reason),
    mutates: true,
  },
  'feat:webhook:rotations': {
    call: (s, { subscription_id }: any) => s.listSecretRotations(subscription_id),
  },
  'feat:pci:upsert': {
    call: (s, i: any, { cid }) => s.upsertPciItem({ ...i, company_id: cid }),
    mutates: true,
  },
  'feat:pci:list': {
    call: (s, opts: any = {}, { cid }) => s.listPciItems(cid!, opts),
    requiresCompany: [],
  },
  'feat:soc2:upsert': {
    call: (s, c: any, { cid }) => s.upsertSoc2Control({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:soc2:list': {
    call: (s, opts: any = {}, { cid }) => s.listSoc2Controls(cid!, opts),
    requiresCompany: [],
  },
  'feat:mask:upsert': {
    call: (s, r: any, { cid }) => s.upsertMaskingRule({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:mask:apply': {
    call: (s, { value, mask_type, visible_chars, replacement_char }: any) =>
      s.applyMask(value, mask_type, visible_chars, replacement_char),
    mutates: true,
  },
  'feat:mask:list': {
    call: (s, _p: any, { cid }) => s.listMaskingRules(cid!),
    requiresCompany: [],
  },
  'feat:rtbf:create': {
    call: (s, r: any, { cid }) => s.createRtbfRequest({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:rtbf:verify': { call: (s, { id }: any) => ({ ok: s.verifyRtbfRequest(id) }) },
  'feat:rtbf:fulfill': {
    call: (s, { id, ...opts }: any) => ({ ok: s.fulfillRtbfRequest(id, opts) }),
  },
  'feat:rtbf:list': {
    call: (s, opts: any = {}, { cid }) => s.listRtbfRequests(cid!, opts),
    requiresCompany: [],
  },
  'feat:consent:record': {
    call: (s, c: any, { cid }) => s.recordConsent({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:consent:withdraw': { call: (s, { id }: any) => ({ ok: s.withdrawConsent(id) }) },
  'feat:consent:list': {
    call: (s, opts: any = {}, { cid }) => s.getConsents(cid!, opts),
    requiresCompany: [],
  },
  'feat:sub-processor:upsert': {
    call: (svc, s: any, { cid }) => svc.upsertSubProcessor({ ...s, company_id: cid }),
    mutates: true,
  },
  'feat:sub-processor:list': {
    call: (s, { active_only }: any = {}, { cid }) =>
      s.listSubProcessors(cid!, active_only !== false),
    requiresCompany: [],
  },
  'feat:classify:upsert': {
    call: (s, c: any, { cid }) => s.classifyData({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:classify:list': {
    call: (s, opts: any = {}, { cid }) => s.listClassifications(cid!, opts),
    requiresCompany: [],
  },
  'feat:encryption:verify': {
    call: (s, v: any, { cid }) => s.recordEncryptionVerification({ ...v, company_id: cid }),
    mutates: true,
  },
  'feat:encryption:list': {
    call: (s, { limit }: any = {}, { cid }) => s.listEncryptionVerifications(cid!, limit),
    requiresCompany: [],
  },
  'feat:backup-verify:record': {
    call: (s, v: any, { cid }) => s.recordBackupVerification({ ...v, company_id: cid }),
    mutates: true,
  },
  'feat:backup-verify:list': {
    call: (s, { limit }: any = {}, { cid }) => s.listBackupVerifications(cid, limit),
  },
  'feat:vuln:upsert': {
    call: (s, v: any, { cid }) => s.upsertVulnerability({ ...v, company_id: cid }),
    mutates: true,
  },
  'feat:vuln:list': {
    call: (s, opts: any = {}, { cid }) => s.listVulnerabilities(cid!, opts),
    requiresCompany: [],
  },
  'feat:vuln:remediated': {
    call: (s, { id }: any) => ({ ok: s.markVulnerabilityRemediated(id) }),
    mutates: true,
  },
};

export function registerComplianceSecurityFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('compliance-security-features'), COMPLIANCE_SECURITY_FEAT);
}
