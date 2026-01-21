const webcrypto = globalThis.crypto;

if (!webcrypto || !webcrypto.subtle) {
  throw new Error('Web Crypto API not available');
}

export { webcrypto };

export default {
  webcrypto,
};
