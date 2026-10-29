type PublicKeyCredentialRequestOptionsJson = {
  challenge: string
  timeout?: number
  rpId?: string
  allowCredentials?: Array<{
    id: string
    type?: 'public-key'
    transports?: AuthenticatorTransport[]
  }>
  userVerification?: UserVerificationRequirement
}

type PublicKeyCredentialCreationOptionsJson = {
  challenge: string
  rp?: PublicKeyCredentialRpEntity
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams?: PublicKeyCredentialParameters[]
  timeout?: number
  authenticatorSelection?: AuthenticatorSelectionCriteria
  attestation?: AttestationConveyancePreference
  hints?: PublicKeyCredentialHint[]
}

export type PublicKeyCredentialHint = 'security-key' | 'client-device' | 'hybrid'
export type WebAuthnCapabilities = {
  available: boolean
  secureContext: boolean
  platformAuthenticatorAvailable: boolean
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  const binary = window.atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function arrayBufferToBase64Url(value?: ArrayBuffer | null): string {
  if (!value) return ''
  const bytes = new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function toPublicKeyCreationOptions(options: PublicKeyCredentialCreationOptionsJson): PublicKeyCredentialCreationOptions {
  return {
    challenge: base64UrlToArrayBuffer(options.challenge),
    rp: options.rp,
    user: { ...options.user, id: base64UrlToArrayBuffer(options.user.id) },
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout,
    authenticatorSelection: options.authenticatorSelection,
    attestation: options.attestation,
    ...(options.hints?.length ? { hints: options.hints } : {}),
  } as PublicKeyCredentialCreationOptions
}

export async function startRegistration(options: PublicKeyCredentialCreationOptionsJson, hint?: PublicKeyCredentialHint) {
  if (!isWebAuthnAvailable()) throw new Error('WEBAUTHN_UNAVAILABLE')
  if (!window.isSecureContext) throw new Error('WEBAUTHN_SECURE_CONTEXT_REQUIRED')
  let credential: Credential | null
  try {
    credential = await navigator.credentials.create({
      publicKey: toPublicKeyCreationOptions(hint ? { ...options, hints: [hint] } : options),
    })
  } catch (error) {
    throw normalizeWebAuthnError(error)
  }
  if (!credential) throw new Error('WEBAUTHN_CREDENTIAL_EMPTY')
  const publicKeyCredential = credential as PublicKeyCredential
  const response = publicKeyCredential.response as AuthenticatorAttestationResponse
  const transports = typeof response.getTransports === 'function' ? response.getTransports() : []
  return {
    id: publicKeyCredential.id,
    rawId: arrayBufferToBase64Url(publicKeyCredential.rawId),
    type: publicKeyCredential.type,
    authenticatorAttachment: publicKeyCredential.authenticatorAttachment || undefined,
    response: {
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      attestationObject: arrayBufferToBase64Url(response.attestationObject),
      transports,
    },
  }
}

function toPublicKeyRequestOptions(
  options: PublicKeyCredentialRequestOptionsJson
): PublicKeyCredentialRequestOptions {
  return {
    challenge: base64UrlToArrayBuffer(options.challenge),
    timeout: options.timeout,
    rpId: options.rpId,
    allowCredentials: options.allowCredentials?.map((item) => ({
      id: base64UrlToArrayBuffer(item.id),
      type: 'public-key',
      transports: item.transports,
    })),
    userVerification: options.userVerification,
  }
}

export function isWebAuthnAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.PublicKeyCredential && navigator.credentials)
}

export async function detectWebAuthnCapabilities(): Promise<WebAuthnCapabilities> {
  const secureContext = typeof window !== 'undefined' && window.isSecureContext === true
  const available = secureContext && isWebAuthnAvailable()
  if (!available) return { available: false, secureContext, platformAuthenticatorAvailable: false }
  const detectPlatformAuthenticator = window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
  if (typeof detectPlatformAuthenticator !== 'function') {
    return { available: true, secureContext, platformAuthenticatorAvailable: false }
  }
  try {
    return {
      available: true,
      secureContext,
      platformAuthenticatorAvailable: await detectPlatformAuthenticator.call(window.PublicKeyCredential),
    }
  } catch {
    return { available: true, secureContext, platformAuthenticatorAvailable: false }
  }
}

function normalizeWebAuthnError(error: unknown): Error {
  const name = typeof DOMException !== 'undefined' && error instanceof DOMException
    ? error.name
    : String((error as { name?: unknown })?.name || '')
  const code = ({
    NotAllowedError: 'IDENTITY_PASSKEY_CANCELLED',
    NotSupportedError: 'IDENTITY_PASSKEY_UNSUPPORTED',
    SecurityError: 'IDENTITY_PASSKEY_SECURITY_ERROR',
    InvalidStateError: 'IDENTITY_PASSKEY_ALREADY_REGISTERED',
  } as Record<string, string>)[name]
  return code ? new Error(code) : error instanceof Error ? error : new Error('IDENTITY_PASSKEY_OPERATION_FAILED')
}

export async function startAuthentication(options: PublicKeyCredentialRequestOptionsJson) {
  if (!isWebAuthnAvailable()) {
    throw new Error('WEBAUTHN_UNAVAILABLE')
  }
  if (!window.isSecureContext) throw new Error('WEBAUTHN_SECURE_CONTEXT_REQUIRED')
  let credential: Credential | null
  try {
    credential = await navigator.credentials.get({
      publicKey: toPublicKeyRequestOptions(options),
    })
  } catch (error) {
    throw normalizeWebAuthnError(error)
  }
  if (!credential) {
    throw new Error('WEBAUTHN_CREDENTIAL_EMPTY')
  }
  const publicKeyCredential = credential as PublicKeyCredential
  const response = publicKeyCredential.response as AuthenticatorAssertionResponse
  return {
    id: publicKeyCredential.id,
    rawId: arrayBufferToBase64Url(publicKeyCredential.rawId),
    type: publicKeyCredential.type,
    response: {
      authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      signature: arrayBufferToBase64Url(response.signature),
      userHandle: arrayBufferToBase64Url(response.userHandle),
    },
  }
}
