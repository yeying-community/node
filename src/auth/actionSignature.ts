import { createHash } from 'crypto';
import { verifyMessage } from 'ethers';
import { Envelope } from './envelope';
import { getCurrentUtcString } from '../common/date';
import { ActionRequestService } from '../domain/service/actionRequest';

const MESSAGE_PREFIX = 'YeYing Market';

function parsePositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MAX_SIGNATURE_AGE_MS = parsePositiveNumber(
  process.env.ACTION_SIGNATURE_MAX_AGE_MS,
  5 * 60 * 1000
);
const MAX_SIGNATURE_FUTURE_SKEW_MS = parsePositiveNumber(
  process.env.ACTION_SIGNATURE_FUTURE_SKEW_MS,
  30 * 1000
);

export type ActionSignatureMeta = {
  requestId: string;
  timestamp: string;
  signature: string;
};

export type VerifiedActionSignature = ActionSignatureMeta & {
  actor: string;
  action: string;
  payloadHash: string;
};

export type SignedActionResult<T = unknown> = {
  status: number;
  body: Envelope<T | null>;
};

export type ActionSignatureInput = {
  action: string;
  actor: string;
  timestamp: string;
  requestId: string;
  payload?: unknown;
};

function normalizeType(value: string): string {
  return String(value || '').trim().toLowerCase();
}

export function normalizeAddress(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function stableStringify(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'null';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
}

export function buildActionPayloadHash(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function getActionSignatureErrorStatus(message: string) {
  switch (message) {
    case 'Missing signature fields':
    case 'Invalid signature timestamp':
      return 400;
    case 'Invalid signature':
    case 'Signature timestamp expired':
      return 401;
    case 'Request replayed':
    case 'Request replay payload mismatch':
    case 'Request in progress':
      return 409;
    default:
      return undefined;
  }
}

function parseSignatureTimestamp(value: string): number | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function assertSignatureFresh(timestamp: string) {
  const signedAt = parseSignatureTimestamp(timestamp);
  if (signedAt === null) {
    throw new Error('Invalid signature timestamp');
  }
  const now = Date.now();
  if (signedAt > now + MAX_SIGNATURE_FUTURE_SKEW_MS) {
    throw new Error('Signature timestamp expired');
  }
  if (now - signedAt > MAX_SIGNATURE_AGE_MS) {
    throw new Error('Signature timestamp expired');
  }
}

export function buildActionSignatureMessage(input: ActionSignatureInput): string {
  return [
    MESSAGE_PREFIX,
    `Action: ${normalizeType(input.action)}`,
    `Actor: ${normalizeAddress(input.actor)}`,
    `Timestamp: ${input.timestamp}`,
    `RequestId: ${input.requestId}`,
    `PayloadHash: ${buildActionPayloadHash(input.payload ?? null)}`,
  ].join('\n');
}

export function verifyWalletSignature(
  message: string,
  signature: string,
  expectedAddress: string
): boolean {
  try {
    const recovered = verifyMessage(message, signature);
    return normalizeAddress(recovered) === normalizeAddress(expectedAddress);
  } catch {
    return false;
  }
}

export function readActionSignatureMeta(raw: Record<string, unknown>): ActionSignatureMeta {
  const requestId = String(raw.requestId ?? '').trim();
  const timestamp = String(raw.timestamp ?? '').trim();
  const signature = String(raw.signature ?? '').trim();
  return { requestId, timestamp, signature };
}

export async function assertActionSignature(input: {
  raw: Record<string, unknown>;
  action: string;
  actor: string;
  payload?: unknown;
}) {
  const meta = readActionSignatureMeta(input.raw);
  if (!meta.requestId || !meta.timestamp || !meta.signature) {
    throw new Error('Missing signature fields');
  }
  assertSignatureFresh(meta.timestamp);
  const normalizedActor = normalizeAddress(input.actor);
  const normalizedAction = normalizeType(input.action);
  const payloadHash = buildActionPayloadHash(input.payload ?? null);
  const message = buildActionSignatureMessage({
    action: normalizedAction,
    actor: normalizedActor,
    timestamp: meta.timestamp,
    requestId: meta.requestId,
    payload: input.payload,
  });
  if (!verifyWalletSignature(message, meta.signature, normalizedActor)) {
    throw new Error('Invalid signature');
  }
  return {
    ...meta,
    actor: normalizedActor,
    action: normalizedAction,
    payloadHash,
  } as VerifiedActionSignature;
}

export async function executeSignedAction<T>(input: {
  raw: Record<string, unknown>;
  action: string;
  actor: string;
  payload?: unknown;
  execute: (verified: VerifiedActionSignature) => Promise<SignedActionResult<T>>;
  onError: (error: unknown) => SignedActionResult<T>;
}) {
  let verified: VerifiedActionSignature;
  try {
    verified = await assertActionSignature({
      raw: input.raw,
      action: input.action,
      actor: input.actor,
      payload: input.payload,
    });
  } catch (error) {
    return input.onError(error);
  }

  const service = new ActionRequestService();
  try {
    const reservation = await service.begin({
      actor: verified.actor,
      action: verified.action,
      requestId: verified.requestId,
      payloadHash: verified.payloadHash,
      signedAt: verified.timestamp,
      signature: verified.signature,
      createdAt: getCurrentUtcString(),
      status: 'pending',
      responseCode: 0,
      responseBody: '',
      completedAt: '',
    });
    if (reservation.kind === 'replay') {
      return {
        status: reservation.responseCode,
        body: JSON.parse(reservation.responseBody) as Envelope<T | null>,
      };
    }
  } catch (error) {
    return input.onError(error);
  }

  let result: SignedActionResult<T>;
  try {
    result = await input.execute(verified);
  } catch (error) {
    result = input.onError(error);
  }

  await service.complete({
    actor: verified.actor,
    requestId: verified.requestId,
    responseCode: result.status,
    responseBody: JSON.stringify(result.body),
    completedAt: getCurrentUtcString(),
  });

  return result;
}
