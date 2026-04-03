import {
  buildActionSignatureMessage,
  normalizeAddress,
  verifyWalletSignature,
} from './actionSignature';

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
  text?: string;
  timestamp: string;
  nonce: string;
};

function normalizeType(value: string): string {
  return (value || '').trim().toLowerCase();
}

export function buildSubmitAuditMessage(input: SubmitAuditSignatureInput): string {
  const version = Number(input.targetVersion);
  return buildActionSignatureMessage({
    action: 'submit_audit',
    actor: input.applicant,
    timestamp: input.timestamp,
    requestId: input.nonce,
    payload: {
      targetType: normalizeType(input.targetType),
      targetDid: input.targetDid,
      targetVersion: Number.isFinite(version) ? version : input.targetVersion,
      applicant: normalizeAddress(input.applicant),
    },
  });
}

export function buildAuditDecisionMessage(input: AuditDecisionSignatureInput): string {
  return buildActionSignatureMessage({
    action: 'audit_decision',
    actor: input.approver,
    timestamp: input.timestamp,
    requestId: input.nonce,
    payload: {
      auditId: input.auditId,
      decision: normalizeType(input.decision),
      approver: normalizeAddress(input.approver),
      text: String(input.text || ''),
    },
  });
}

export { normalizeAddress, verifyWalletSignature };
