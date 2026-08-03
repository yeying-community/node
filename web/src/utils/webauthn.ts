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

export async function startAuthentication(options: PublicKeyCredentialRequestOptionsJson) {
  if (!isWebAuthnAvailable()) {
    throw new Error('WEBAUTHN_UNAVAILABLE')
  }
  const credential = await navigator.credentials.get({
    publicKey: toPublicKeyRequestOptions(options),
  })
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
    clientExtensionResults: publicKeyCredential.getClientExtensionResults(),
    authenticatorAttachment: publicKeyCredential.authenticatorAttachment || undefined,
  }
}
