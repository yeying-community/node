export type SubmitAuditSignatureInput = {
  targetType: string;
  targetDid: string;
  targetVersion: number;
  applicant: string;
  timestamp: string;
  nonce: string;
};

export type AuditDecisionSignatureInput = {
  auditId: string;
  decision: 'approve' | 'reject';
  approver: string;
  timestamp: string;
  nonce: string;
};

const MESSAGE_PREFIX = 'YeYing Market';

export function normalizeAddress(value: string): string {
  return (value || '').trim().toLowerCase();
}

function normalizeType(value: string): string {
  return (value || '').trim().toLowerCase();
}

export function buildSubmitAuditMessage(input: SubmitAuditSignatureInput): string {
  const version = Number(input.targetVersion);
  return [
    MESSAGE_PREFIX,
    'Action: submit_audit',
    `TargetType: ${normalizeType(input.targetType)}`,
    `TargetDid: ${input.targetDid}`,
    `TargetVersion: ${Number.isFinite(version) ? version : input.targetVersion}`,
    `Applicant: ${normalizeAddress(input.applicant)}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
  ].join('\n');
}

export function buildAuditDecisionMessage(input: AuditDecisionSignatureInput): string {
  return [
    MESSAGE_PREFIX,
    'Action: audit_decision',
    `AuditId: ${input.auditId}`,
    `Decision: ${normalizeType(input.decision)}`,
    `Approver: ${normalizeAddress(input.approver)}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
  ].join('\n');
}
