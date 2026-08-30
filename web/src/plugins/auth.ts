import { notifyError } from '@/utils/message';
import { getWalletDataStore } from '@/stores/auth';
import { apiUrl } from '@/plugins/api';
import {
  authUcanFetch,
  classifyWalletError,
  createInvocationUcan,
  createUcanSession,
  clearUcanSession,
  DEFAULT_UCAN_TOKEN_SKEW_MS,
  decodeUcanPayload,
  focusPendingApproval,
  getAccounts,
  getCapabilityAction,
  getCapabilityResource,
  getUcanTokenTiming,
  getBalance as web3GetBalance,
  getChainId as web3GetChainId,
  getOrCreateUcanRoot,
  getProvider,
  getStoredUcanRoot,
  isUcanTokenFresh,
  normalizeUcanCapabilities,
  onAccountsChanged,
  onChainChanged,
  requestAccounts,
  resolveUcanAuthorization,
  watchProvider,
  type Eip1193Provider,
  type IdentityPresentationScope,
  type UcanCapability,
  type UcanRootProof,
  type UcanSessionKey,
} from '@yeying-community/web3-bs';

type CachedToken = {
  token: string;
};

type AuthProfile = {
  address: string;
  issuer?: string;
  ucanSource?: 'wallet' | 'central';
  authType?: 'jwt' | 'ucan';
  issuedAt?: number;
};

type AuthEnvelope<T> = {
  code: number;
  message: string;
  data: T;
  timestamp: number;
};

type SiweChallenge = {
  address: string;
  challenge: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

type SiweVerifyResult = {
  address: string;
  token: string;
  expiresAt: number;
  refreshExpiresAt: number;
};

const UCAN_API_TOKEN_KEY = 'ucanToken';
const UCAN_WEBDAV_TOKEN_KEY = 'webdavToken';
const AUTH_TOKEN_KEY = 'authToken';
const AUTH_TOKEN_EXPIRES_AT_KEY = 'authTokenExpiresAt';
const AUTH_MANUAL_LOGOUT_KEY = 'authManualLogout';
const LOGIN_COMPLETION_WAIT_MS = 60000;
const LOGIN_COMPLETION_POLL_MS = 300;
const LOGIN_ROUTE_READY_WAIT_MS = 3000;
const WALLET_ACCOUNT_REQUEST_TIMEOUT_MS = 60000;
const WALLET_LOGIN_IDENTITY_SCOPES: IdentityPresentationScope[] = [
  'identity.basic',
  'identity.wallet',
];

type WalletPermission = {
  parentCapability?: string;
  caveats?: Array<{
    type?: string;
    value?: unknown;
  }>;
};

let cachedProvider: Eip1193Provider | null = null;
let providerWatcherReady = false;
let walletListenersProvider: Eip1193Provider | null = null;
let walletListenersTeardown: Array<() => void> = [];
let accountRequestInFlight: { provider: Eip1193Provider; promise: Promise<string[]> } | null = null;
let loginInFlight: {
  accountKey: string;
  provider: Eip1193Provider | null;
  promise: Promise<boolean>;
} | null = null;
let cachedApiToken: CachedToken | null = null;
let cachedApiUcanToken: CachedToken | null = null;
let cachedWebDavToken: CachedToken | null = null;
let cachedSession: UcanSessionKey | null = null;
let cachedRoot: UcanRootProof | null = null;
let cachedCapsKey: string | null = null;

async function resolveProvider(timeoutMs = 5000, options: { refresh?: boolean } = {}) {
  if (cachedProvider && !options.refresh) {
    return cachedProvider;
  }
  const provider = await getProvider({ preferYeYing: true, timeoutMs });
  if (provider) {
    cachedProvider = provider;
  }
  return provider || cachedProvider;
}

function normalizeAccountKey(account?: string | null) {
  return String(account || '').trim().toLowerCase();
}

function isProviderCandidate(value: unknown): value is Eip1193Provider {
  return Boolean(value && typeof (value as Eip1193Provider).request === 'function');
}

function addFocusProviderCandidate(candidates: Eip1193Provider[], candidate: unknown) {
  if (isProviderCandidate(candidate) && !candidates.includes(candidate)) {
    candidates.push(candidate);
    const nestedProviders = (candidate as { providers?: unknown }).providers;
    if (Array.isArray(nestedProviders)) {
      for (const nested of nestedProviders) {
        addFocusProviderCandidate(candidates, nested);
      }
    }
  }
}

function getFocusProviderCandidates(provider?: Eip1193Provider | null) {
  const candidates: Eip1193Provider[] = [];
  addFocusProviderCandidate(candidates, provider);
  addFocusProviderCandidate(candidates, loginInFlight?.provider);
  addFocusProviderCandidate(candidates, accountRequestInFlight?.provider);
  addFocusProviderCandidate(candidates, cachedProvider);
  addFocusProviderCandidate(candidates, walletListenersProvider);

  if (typeof window !== 'undefined') {
    const source = window as Window & Record<string, unknown>;
    for (const name of ['yeying', 'yeeying', '__YEYING_PROVIDER__', 'ethereum']) {
      addFocusProviderCandidate(candidates, source[name]);
    }
  }

  return candidates;
}

async function focusPendingWalletApproval(provider?: Eip1193Provider | null) {
  const candidates = getFocusProviderCandidates(provider);
  for (const candidate of candidates) {
    try {
      const result = await focusPendingApproval(candidate);
      if (result.focused) {
        return true;
      }
    } catch {
      // try the next provider candidate
    }
  }

  try {
    const result = await focusPendingApproval();
    return Boolean(result.focused);
  } catch {
    return false;
  }
}

async function requestWalletAccounts(provider: Eip1193Provider) {
  if (accountRequestInFlight) {
    void focusPendingWalletApproval(provider);
    return await accountRequestInFlight.promise;
  }

  const request = requestWalletLoginPermissions(provider);
  const timeout = new Promise<string[]>((_, reject) => {
    window.setTimeout(() => {
      reject(new Error('Wallet approval timed out after 60 seconds'));
    }, WALLET_ACCOUNT_REQUEST_TIMEOUT_MS);
  });
  const promise = Promise.race([request, timeout]);
  accountRequestInFlight = { provider, promise };
  try {
    return await promise;
  } finally {
    if (accountRequestInFlight?.promise === promise) {
      accountRequestInFlight = null;
    }
  }
}

function walletErrorCode(error: unknown) {
  const value = error as { code?: unknown; data?: { code?: unknown } };
  const code = value?.code ?? value?.data?.code;
  return typeof code === 'number' ? code : Number.NaN;
}

function isUnsupportedPermissionRequest(error: unknown) {
  const code = walletErrorCode(error);
  const message = String((error as { message?: unknown })?.message || '').toLowerCase();
  return (
    code === -32601 ||
    code === -32602 ||
    message.includes('method not found') ||
    message.includes('unsupported') ||
    message.includes('not supported')
  );
}

function extractWalletPermissionAccounts(result: unknown): string[] {
  if (!Array.isArray(result)) {
    return [];
  }
  const accountPermission = (result as WalletPermission[]).find(
    (item) => item?.parentCapability === 'eth_accounts'
  );
  const accountCaveat = accountPermission?.caveats?.find(
    (item) => item?.type === 'restrictReturnedAccounts'
  );
  return Array.isArray(accountCaveat?.value)
    ? accountCaveat.value.map((account) => String(account || '').trim()).filter(Boolean)
    : [];
}

async function requestWalletLoginPermissions(provider: Eip1193Provider): Promise<string[]> {
  try {
    const permissions = await provider.request({
      method: 'wallet_requestPermissions',
      params: [
        {
          eth_accounts: {},
          wallet_identity: {
            scopes: WALLET_LOGIN_IDENTITY_SCOPES,
          },
        },
      ],
    });
    const permittedAccounts = extractWalletPermissionAccounts(permissions);
    if (permittedAccounts.length > 0) {
      return permittedAccounts;
    }
    const accounts = await getAccounts(provider);
    if (accounts.length > 0) {
      return accounts;
    }
    return [];
  } catch (error) {
    if (!isUnsupportedPermissionRequest(error)) {
      throw error;
    }
  }
  return await requestAccounts({ provider });
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForLoginCompletion(timeoutMs = LOGIN_COMPLETION_WAIT_MS) {
  if (loginInFlight) {
    return await loginInFlight.promise;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (getCurrentAccount() && hasValidApiToken()) {
      return true;
    }
    await delay(LOGIN_COMPLETION_POLL_MS);
  }
  return false;
}

async function waitForRoutePath(router: any, expectedPath: string, timeoutMs = LOGIN_ROUTE_READY_WAIT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const currentPath = String(router?.currentRoute?.value?.path || '');
    if (currentPath === expectedPath || currentPath.startsWith(`${expectedPath}/`)) {
      return true;
    }
    await delay(LOGIN_COMPLETION_POLL_MS);
  }
  return false;
}

async function goMarketAfterLogin(router: any) {
  if (!(await waitForLoginCompletion(LOGIN_ROUTE_READY_WAIT_MS))) {
    return false;
  }
  if (router) {
    try {
      await router.isReady?.();
    } catch {
      // ignore router readiness errors and continue with fallback checks
    }
    const target = { path: '/market' };
    await router.replace?.(target).catch(() => undefined);
    if (await waitForRoutePath(router, '/market', LOGIN_ROUTE_READY_WAIT_MS)) {
      return true;
    }
    await router.push?.(target).catch(() => undefined);
    if (await waitForRoutePath(router, '/market', LOGIN_ROUTE_READY_WAIT_MS)) {
      return true;
    }
  }
  window.location.assign(`${getHomeUrl()}market`);
  return true;
}

function removeWalletListeners() {
  for (const teardown of walletListenersTeardown) {
    try {
      teardown();
    } catch {
      // ignore listener cleanup errors
    }
  }
  walletListenersTeardown = [];
  walletListenersProvider = null;
}

function addProviderListener(
  provider: Eip1193Provider,
  event: string,
  handler: (...args: any[]) => void
) {
  const target = provider as Eip1193Provider & {
    on?: (event: string, handler: (...args: any[]) => void) => void;
    removeListener?: (event: string, handler: (...args: any[]) => void) => void;
    off?: (event: string, handler: (...args: any[]) => void) => void;
  };
  target.on?.(event, handler);
  return () => {
    target.removeListener?.(event, handler);
    target.off?.(event, handler);
  };
}

function startProviderWatcher() {
  if (providerWatcherReady || typeof window === 'undefined') {
    return;
  }
  providerWatcherReady = true;
  watchProvider(({ provider, present }) => {
    if (present && provider) {
      cachedProvider = provider;
      void bindWalletProvider(provider);
      return;
    }
    cachedProvider = null;
    getWalletDataStore().setWalletReady(false);
    if (walletListenersProvider) {
      removeWalletListeners();
    }
  }, {
    preferYeYing: true,
    pollIntervalMs: 100,
    maxPolls: 50,
  });
}

async function bindWalletProvider(provider: Eip1193Provider) {
  if (walletListenersProvider === provider) {
    return;
  }
  removeWalletListeners();
  walletListenersProvider = provider;
  getWalletDataStore().setWalletReady(true);

  walletListenersTeardown.push(onAccountsChanged(provider, async (accounts) => {
    if (!accounts || accounts.length === 0) {
      const storedAccount = getCurrentAccount();
      const authorization = await resolveWalletUcanAuthorization({
        root: await getStoredUcanRoot(),
        account: storedAccount || null,
        recoverAccountFromRoot: !storedAccount,
      });
      if (authorization.status === 'authorized') {
        if (authorization.restoredAccount && authorization.account) {
          handleAccountChange(authorization.account);
          emitAccountChange(authorization.account);
        }
        return;
      }
      await clearAuthSession();
      emitAccountChange(null);
      redirectHome();
      return;
    }
    const nextAccount = accounts[0];
    const stored = getCurrentAccount();
    if (!stored || stored.toLowerCase() !== nextAccount.toLowerCase()) {
      handleAccountChange(nextAccount);
      emitAccountChange(nextAccount);
    }
  }));

  walletListenersTeardown.push(onChainChanged(provider, () => {
    resetTokenCaches();
  }));

  walletListenersTeardown.push(addProviderListener(provider, 'connect', () => {
    getWalletDataStore().setWalletReady(true);
  }));

  walletListenersTeardown.push(addProviderListener(provider, 'disconnect', () => {
    getWalletDataStore().setWalletReady(false);
    clearAuthSession();
    emitAccountChange(null);
    redirectHome();
  }));
}

function getHomeUrl() {
  if (typeof window === 'undefined') {
    return '/';
  }
  return `${window.location.origin}/`;
}

function redirectHome() {
  if (typeof window === 'undefined') {
    return;
  }
  const target = getHomeUrl();
  if (window.location.href !== target) {
    window.location.assign(target);
  }
}

function toDidWeb(value: string): string {
  if (!value) return 'did:web:localhost';
  try {
    const url = new URL(value);
    return `did:web:${url.host}`;
  } catch {
    const trimmed = value.replace(/^https?:\/\//, '').split('/')[0];
    return `did:web:${trimmed || 'localhost'}`;
  }
}

function resolveSameOriginApiAudience(): string {
  if (typeof window === 'undefined') {
    return 'did:web:localhost';
  }
  const proxyTarget = import.meta.env.DEV
    ? import.meta.env.VITE_DEV_API_PROXY_TARGET || 'http://localhost:8100'
    : '';
  if (proxyTarget) {
    return toDidWeb(proxyTarget);
  }
  return toDidWeb(window.location.origin);
}

function normalizeActionExpression(raw: string): string {
  const normalized = String(raw || '').trim().toLowerCase().replace(/\|/g, ',');
  if (!normalized) return '';
  const items = normalized
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  if (!items.length) return '';
  return Array.from(new Set(items)).join(',');
}

function sanitizeAppId(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._*-]/g, '-');
}

function resolveAppId(): string {
  const envAppId = sanitizeAppId(import.meta.env.VITE_UCAN_APP_ID || '');
  if (envAppId) return envAppId;
  if (typeof window !== 'undefined') {
    const host = sanitizeAppId(window.location.host || '');
    if (host) return host;
  }
  return 'localhost';
}

function parseDidWebHost(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized.startsWith('did:web:')) {
    return '';
  }
  return normalized
    .slice('did:web:'.length)
    .split('/')[0]
    .trim();
}

function resolveApiCapabilityAppId(): string {
  const envAppId = sanitizeAppId(import.meta.env.VITE_UCAN_APP_ID || '');
  if (envAppId) return envAppId;
  const audienceHost = parseDidWebHost(resolveApiAudience());
  if (audienceHost) {
    const hostname = audienceHost.split(':')[0];
    const normalizedHost = sanitizeAppId(hostname || audienceHost);
    if (normalizedHost) {
      return audienceHost.includes(':') ? `${normalizedHost}-*` : normalizedHost;
    }
  }
  return resolveAppId();
}

function buildUcanCapability(resource: string, action: string): UcanCapability {
  const normalizedResource = String(resource || '').trim();
  const normalizedAction = normalizeActionExpression(action);
  return {
    with: normalizedResource,
    can: normalizedAction,
  };
}

function normalizeCapabilities(caps: UcanCapability[]): UcanCapability[] {
  return normalizeUcanCapabilities(caps || []);
}

function buildCapsKey(caps: UcanCapability[]): string {
  return normalizeUcanCapabilities(caps || [], { includeLegacyAliases: false })
    .map((cap) => {
      const resource = getCapabilityResource(cap);
      const action = getCapabilityAction(cap);
      return `${resource}:${action}`;
    })
    .filter((entry) => entry !== ':')
    .sort()
    .join('|');
}

function resolveApiCapabilityResource(): string {
  return (
    import.meta.env.VITE_UCAN_WITH ||
    `app:all:${resolveApiCapabilityAppId()}`
  );
}

function resolveApiCapabilityAction(): string {
  return (
    import.meta.env.VITE_UCAN_CAN ||
    'invoke'
  );
}

function resolveWebDavCapabilityResource(): string {
  return (
    import.meta.env.VITE_WEBDAV_UCAN_WITH ||
    resolveApiCapabilityResource()
  );
}

function resolveWebDavCapabilityAction(): string {
  return (
    import.meta.env.VITE_WEBDAV_UCAN_CAN ||
    'write'
  );
}

function getApiUcanCapabilities(): UcanCapability[] {
  return normalizeCapabilities([
    buildUcanCapability(resolveApiCapabilityResource(), resolveApiCapabilityAction()),
  ]);
}

function getWebDavUcanCapabilities(): UcanCapability[] {
  return normalizeCapabilities([
    buildUcanCapability(resolveWebDavCapabilityResource(), resolveWebDavCapabilityAction()),
  ]);
}

function getRootUcanCapabilities(): UcanCapability[] {
  return normalizeCapabilities([
    ...getApiUcanCapabilities(),
    ...getWebDavUcanCapabilities(),
  ]);
}

function resolveApiAudience(): string {
  const envAud = import.meta.env.VITE_UCAN_AUD;
  if (envAud) return envAud;
  const endpoint = import.meta.env.VITE_NODE_API_ENDPOINT;
  if (endpoint) {
    if (/^https?:\/\//i.test(endpoint)) {
      return toDidWeb(endpoint);
    }
    return resolveSameOriginApiAudience();
  }
  return resolveSameOriginApiAudience();
}

function resolveWebDavAudience(): string {
  const envAud = import.meta.env.VITE_WEBDAV_AUD;
  if (envAud) return envAud;
  const baseUrl = import.meta.env.VITE_WEBDAV_BASE_URL;
  if (!baseUrl) {
    throw new Error('缺少 WebDAV 服务地址配置 VITE_WEBDAV_BASE_URL');
  }
  return toDidWeb(baseUrl);
}

function resolveServiceHost(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  try {
    const host = new URL(rawUrl).host.trim();
    return host || null;
  } catch {
    const host = rawUrl.replace(/^https?:\/\//, '').split('/')[0].trim();
    return host || null;
  }
}

function buildUcanRootStatement(audience: string, capabilities: UcanCapability[]): string {
  const payload: Record<string, unknown> = {
    version: 'UCAN-AUTH-1',
    aud: audience,
    cap: normalizeCapabilities(capabilities),
  };
  const serviceHosts: Record<string, string> = {};
  const routerHost = resolveServiceHost(import.meta.env.VITE_NODE_API_ENDPOINT);
  const webdavHost = resolveServiceHost(import.meta.env.VITE_WEBDAV_BASE_URL);
  if (routerHost) serviceHosts.router = routerHost;
  if (webdavHost) serviceHosts.webdav = webdavHost;
  if (Object.keys(serviceHosts).length > 0) {
    payload.service_hosts = serviceHosts;
  }
  return `UCAN-AUTH ${JSON.stringify(payload)}`;
}

function parseCachedToken(token: string): CachedToken | null {
  const timing = getUcanTokenTiming(token);
  if (!timing.payload || timing.exp === null) return null;
  return { token };
}

function decodeBase64UrlJson<T>(segment: string): T | null {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
    return JSON.parse(window.atob(padded)) as T;
  } catch {
    return null;
  }
}

function getJwtExpiresAt(token: string): number | null {
  const [, payloadPart] = String(token || '').split('.');
  if (!payloadPart) return null;
  const payload = decodeBase64UrlJson<{ exp?: number; typ?: string }>(payloadPart);
  if (!payload || payload.typ !== 'access' || typeof payload.exp !== 'number') {
    return null;
  }
  return payload.exp * 1000;
}

function isJwtTokenFresh(token: string, skewMs = DEFAULT_UCAN_TOKEN_SKEW_MS): boolean {
  const expiresAt = getJwtExpiresAt(token);
  return Boolean(expiresAt && Date.now() + skewMs < expiresAt);
}

function isTokenValid(entry: CachedToken | null): boolean {
  return Boolean(entry && isUcanTokenFresh(entry.token, {
    skewMs: DEFAULT_UCAN_TOKEN_SKEW_MS,
  }));
}

function tokenMatchesExpectedClaims(
  entry: CachedToken | null,
  options: { audience?: string; capabilities?: UcanCapability[] } = {}
): boolean {
  if (!entry || !isTokenValid(entry)) return false;
  const payload = decodeUcanPayload(entry.token);
  if (!payload) return false;
  if (options.audience && payload.aud !== options.audience) {
    return false;
  }
  if (options.capabilities) {
    const expectedCapsKey = buildCapsKey(options.capabilities);
    const actualCapsKey = buildCapsKey(payload.cap || []);
    if (actualCapsKey !== expectedCapsKey) {
      return false;
    }
  }
  return true;
}

function readStoredToken(
  key: string,
  options: { audience?: string; capabilities?: UcanCapability[] } = {}
): CachedToken | null {
  if (typeof localStorage === 'undefined') return null;
  const token = localStorage.getItem(key);
  if (!token) return null;
  const parsed = parseCachedToken(token);
  if (!tokenMatchesExpectedClaims(parsed, options)) {
    clearStoredToken(key);
    return null;
  }
  return parsed;
}

function persistToken(key: string, entry: CachedToken) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, entry.token);
}

function persistAuthToken(token: string, expiresAt?: number) {
  if (typeof localStorage === 'undefined') return;
  const resolvedExpiresAt = Number(expiresAt || getJwtExpiresAt(token) || 0);
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  if (resolvedExpiresAt > 0) {
    localStorage.setItem(AUTH_TOKEN_EXPIRES_AT_KEY, String(resolvedExpiresAt));
  } else {
    localStorage.removeItem(AUTH_TOKEN_EXPIRES_AT_KEY);
  }
  cachedApiToken = { token };
}

function clearStoredToken(key: string) {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(key);
}

function readStoredAuthToken(): CachedToken | null {
  if (typeof localStorage === 'undefined') return null;
  const token = String(localStorage.getItem(AUTH_TOKEN_KEY) || '').trim();
  if (!token) return null;
  if (!isJwtTokenFresh(token)) {
    clearStoredToken(AUTH_TOKEN_KEY);
    clearStoredToken(AUTH_TOKEN_EXPIRES_AT_KEY);
    return null;
  }
  return { token };
}

function isManualLogout(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(AUTH_MANUAL_LOGOUT_KEY) === '1';
}

function markManualLogout() {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(AUTH_MANUAL_LOGOUT_KEY, '1');
}

function clearManualLogoutMark() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(AUTH_MANUAL_LOGOUT_KEY);
}

async function parseAuthEnvelope<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();
  let payload: AuthEnvelope<T> | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as AuthEnvelope<T>;
    } catch {
      throw new Error(`${fallbackMessage}: ${text}`);
    }
  }
  if (!response.ok || payload?.code !== 0) {
    throw new Error(payload?.message || `${fallbackMessage}: ${response.status}`);
  }
  return payload.data;
}

async function postAuthJson<T>(path: string, body: Record<string, unknown>, fallbackMessage: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return await parseAuthEnvelope<T>(response, fallbackMessage);
}

async function requestSiweChallenge(address: string, chainId?: number): Promise<SiweChallenge> {
  return await postAuthJson<SiweChallenge>(
    '/api/v1/public/auth/challenge',
    { address, chainId },
    '创建登录挑战失败'
  );
}

async function verifySiweSignature(address: string, signature: string): Promise<SiweVerifyResult> {
  return await postAuthJson<SiweVerifyResult>(
    '/api/v1/public/auth/verify',
    { address, signature },
    '钱包签名验证失败'
  );
}

async function refreshSiweToken(): Promise<CachedToken | null> {
  if (isManualLogout()) return null;
  try {
    const result = await postAuthJson<SiweVerifyResult>(
      '/api/v1/public/auth/refresh',
      {},
      '刷新登录态失败'
    );
    persistAuthToken(result.token, result.expiresAt);
    if (result.address) {
      localStorage.setItem('currentAccount', result.address);
    }
    return { token: result.token };
  } catch {
    clearStoredToken(AUTH_TOKEN_KEY);
    clearStoredToken(AUTH_TOKEN_EXPIRES_AT_KEY);
    cachedApiToken = null;
    return null;
  }
}

export async function getVerifiedAuthProfile(): Promise<AuthProfile | null> {
  const token = await getAuthToken();
  if (!token) return null;
  try {
    const response = await fetch(apiUrl('/api/v1/public/profile/me'), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
    });
    return await parseAuthEnvelope<AuthProfile>(response, '查询登录身份失败');
  } catch {
    return null;
  }
}

function updateWebDavTokenCache(token: string) {
  const parsed = parseCachedToken(token);
  if (!parsed) return;
  cachedWebDavToken = parsed;
  persistToken(UCAN_WEBDAV_TOKEN_KEY, parsed);
}

function resetTokenCaches() {
  cachedApiToken = null;
  cachedApiUcanToken = null;
  cachedWebDavToken = null;
  cachedSession = null;
  cachedRoot = null;
  cachedCapsKey = null;
}

function clearTokenStores() {
  clearStoredToken(UCAN_API_TOKEN_KEY);
  clearStoredToken(UCAN_WEBDAV_TOKEN_KEY);
  clearStoredToken(AUTH_TOKEN_KEY);
  clearStoredToken(AUTH_TOKEN_EXPIRES_AT_KEY);
}

function hasValidApiToken(): boolean {
  if (cachedApiToken?.token && isJwtTokenFresh(cachedApiToken.token)) return true;
  const stored = readStoredAuthToken();
  if (stored) {
    cachedApiToken = stored;
    return true;
  }
  return false;
}

function clearUcanSessionQuietly() {
  return clearUcanSession().catch(() => undefined);
}

function clearAuthSession(options: { waitForUcanSession?: boolean } = {}) {
  clearTokenStores();
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('currentAccount');
  }
  resetTokenCaches();
  const clearPromise = clearUcanSessionQuietly();
  if (options.waitForUcanSession) {
    return clearPromise;
  }
  void clearPromise;
  return Promise.resolve();
}

function handleAccountChange(nextAccount: string) {
  clearTokenStores();
  resetTokenCaches();
  void clearUcanSessionQuietly();
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('currentAccount', nextAccount);
  }
}

function emitAccountChange(account: string | null) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.dispatchEvent(
      new CustomEvent('wallet:accountChanged', { detail: { account } })
    );
  } catch {
    // ignore dispatch errors
  }
}

function isSessionExpired(session?: UcanSessionKey | null): boolean {
  if (!session || !session.expiresAt) return false;
  return Date.now() > session.expiresAt;
}

async function ensureUcanSession(provider: Eip1193Provider): Promise<UcanSessionKey> {
  if (cachedSession && !isSessionExpired(cachedSession)) {
    return cachedSession;
  }
  const session = await createUcanSession({ provider });
  cachedSession = session;
  return session;
}

async function ensureUcanRoot(
  provider: Eip1193Provider,
  address?: string
): Promise<UcanRootProof> {
  const capabilities = getRootUcanCapabilities();
  const capsKey = buildCapsKey(capabilities);
  if (cachedRoot && cachedCapsKey === capsKey && !(cachedRoot.exp && Date.now() > cachedRoot.exp)) {
    return cachedRoot;
  }
  const session = await ensureUcanSession(provider);
  const statement = buildUcanRootStatement(session.did, capabilities);
  const root = await getOrCreateUcanRoot({
    provider,
    session,
    capabilities,
    address,
    statement,
  });
  cachedRoot = root;
  cachedCapsKey = capsKey;
  return root;
}

async function resolveWalletUcanAuthorization(options: {
  root?: UcanRootProof | null;
  account?: string | null;
  recoverAccountFromRoot?: boolean;
} = {}) {
  return await resolveUcanAuthorization({
    root: options.root,
    currentAccount: options.account ?? getCurrentAccount(),
    expectedCapabilities: getRootUcanCapabilities(),
    expectedServiceHosts: {
      router: resolveServiceHost(import.meta.env.VITE_NODE_API_ENDPOINT),
      webdav: resolveServiceHost(import.meta.env.VITE_WEBDAV_BASE_URL),
    },
    recoverAccountFromRoot: options.recoverAccountFromRoot,
  });
}

async function issueInvocationToken(options: {
  provider?: Eip1193Provider;
  audience: string;
  capabilities: UcanCapability[];
  address?: string;
  cache: 'api' | 'webdav';
}): Promise<string> {
  if (isManualLogout()) {
    throw new Error('用户已退出登录');
  }

  const cache = options.cache === 'api' ? cachedApiUcanToken : cachedWebDavToken;
  if (tokenMatchesExpectedClaims(cache, {
    audience: options.audience,
    capabilities: options.capabilities,
  })) {
    return cache!.token;
  }

  const stored = readStoredToken(
    options.cache === 'api' ? UCAN_API_TOKEN_KEY : UCAN_WEBDAV_TOKEN_KEY,
    {
      audience: options.audience,
      capabilities: options.capabilities,
    }
  );
  if (stored) {
  if (options.cache === 'api') {
      cachedApiUcanToken = stored;
    } else {
      cachedWebDavToken = stored;
    }
    return stored.token;
  }

  const provider = options.provider || (await resolveProvider());
  if (!provider) {
    throw new Error('未检测到钱包提供方');
  }
  const session = await ensureUcanSession(provider);
  const root = await ensureUcanRoot(provider, options.address);
  const token = await createInvocationUcan({
    issuer: session,
    audience: options.audience,
    capabilities: options.capabilities,
    proofs: [root],
  });
  if (options.cache === 'api') {
    const parsed = parseCachedToken(token);
    if (parsed) {
      cachedApiUcanToken = parsed;
      persistToken(UCAN_API_TOKEN_KEY, parsed);
    }
  } else {
    updateWebDavTokenCache(token);
  }
  return token;
}

export async function getAuthToken(providerOverride?: Eip1193Provider): Promise<string> {
  if (isManualLogout()) {
    throw new Error('用户已退出登录');
  }
  if (cachedApiToken?.token && isJwtTokenFresh(cachedApiToken.token)) {
    return cachedApiToken.token;
  }
  const stored = readStoredAuthToken();
  if (stored) {
    cachedApiToken = stored;
    return stored.token;
  }
  const refreshed = await refreshSiweToken();
  if (refreshed) {
    return refreshed.token;
  }
  throw new Error('缺少登录态，请重新登录');
}

export async function getWebDavToken(providerOverride?: Eip1193Provider): Promise<string> {
  const capabilities = getWebDavUcanCapabilities();
  return await issueInvocationToken({
    provider: providerOverride,
    audience: resolveWebDavAudience(),
    capabilities,
    cache: 'webdav',
  });
}

export async function authWebDavFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  providerOverride?: Eip1193Provider
): Promise<Response> {
  const provider = providerOverride || (await resolveProvider());
  if (!provider) {
    throw new Error('未检测到钱包提供方');
  }
  const session = await ensureUcanSession(provider);
  const root = await ensureUcanRoot(provider);
  return await authUcanFetch(input, init, {
    issuer: session,
    audience: resolveWebDavAudience(),
    capabilities: getWebDavUcanCapabilities(),
    proofs: [root],
  });
}

// 等待钱包注入
export async function waitForWallet() {
  const provider = await resolveProvider(5000);
  if (!provider) {
    throw new Error('未检测到钱包');
  }
  return provider;
}

// 连接钱包
export async function connectWallet(router: any, route: any) {
  try {
    const provider = await resolveProvider();
    if (!provider) {
      getWalletDataStore().setWalletReady(false);
      notifyError('未检测到钱包，请先安装并连接钱包');
      return;
    }
    getWalletDataStore().setWalletReady(true);
    void setupWalletListeners({ provider });
    try {
      if (loginInFlight) {
        await focusPendingWalletApproval(provider);
        const ok = await waitForLoginCompletion();
        if (ok) {
          if (!(await goMarketAfterLogin(router))) {
            notifyError('登录成功，但跳转应用商店失败，请重试');
          }
        }
        return;
      }
      const accounts = await requestWalletAccounts(provider);
      if (Array.isArray(accounts) && accounts.length > 0) {
        const currentAccount = accounts[0];
        const ok = await loginWithSiwe(provider, currentAccount);
        if (!ok) {
          notifyError('登录失败，未获取到令牌');
          return;
        }
        if (!(await goMarketAfterLogin(router))) {
          notifyError('登录成功，但跳转应用商店失败，请重试');
        }
      } else {
        notifyError('未获取到账户');
      }
    } catch (error) {
      const walletError = classifyWalletError(error);
      if (walletError.message.includes('Session expired')) {
        notifyError(`会话已过期，请打开钱包插件输入密码激活钱包状态。${walletError.message}`);
      } else if (walletError.type === 'userRejected') {
        notifyError(`用户拒绝了连接请求。${walletError.message}`);
      } else if (walletError.type === 'disconnected' || walletError.type === 'timeout') {
        notifyError(`钱包未在规定时间内响应。请打开钱包扩展，解锁并确认连接请求后重试。${walletError.message}`);
      } else {
        notifyError(`连接失败，请检查钱包状态。${walletError.message}`);
      }
      return;
    }
  } catch (error) {
    notifyError(`连接失败：${error}`);
  }
}

export function getCurrentAccount() {
  return localStorage.getItem('currentAccount');
}

export function getStoredAuthToken() {
  if (typeof localStorage === 'undefined') {
    return '';
  }
  const stored = readStoredAuthToken();
  if (stored) {
    cachedApiToken = stored;
  }
  return String(stored?.token || '').trim();
}

export async function logoutWithUcan(options: { redirect?: boolean } = {}) {
  const redirect = options.redirect !== false;
  markManualLogout();
  await fetch(apiUrl('/api/v1/public/auth/logout'), {
    method: 'POST',
    credentials: 'include',
  }).catch(() => undefined);
  await clearAuthSession({ waitForUcanSession: true });
  emitAccountChange(null);
  if (redirect) {
    redirectHome();
  }
}

export async function signWithWallet(message: string): Promise<string> {
  const provider = await resolveProvider();
  if (!provider) {
    throw new Error('未检测到钱包提供方');
  }
  let account = getCurrentAccount();
  if (!account) {
    try {
      const accounts = await getAccounts(provider);
      account = accounts?.[0];
    } catch {
      account = null;
    }
  }
  if (!account) {
    try {
      const accounts = await requestAccounts({ provider });
      account = accounts?.[0];
    } catch {
      account = null;
    }
  }
  if (!account) {
    throw new Error('未获取到钱包账户');
  }
  const payload = typeof message === 'string' ? message : JSON.stringify(message);
  return (await provider.request({
    method: 'personal_sign',
    params: [payload, account],
  })) as string;
}

export async function ensureWalletSession(options: { redirect?: boolean } = {}) {
  const redirect = options.redirect !== false;
  if (isManualLogout()) {
    if (redirect) {
      redirectHome();
    }
    return false;
  }
  const provider = await resolveProvider();
  if (!provider) {
    if (hasValidApiToken()) {
      return true;
    }
    clearAuthSession();
    emitAccountChange(null);
    if (redirect) {
      redirectHome();
    }
    return false;
  }
  let accounts: string[] = [];
  try {
    accounts = await getAccounts(provider);
  } catch {
    accounts = [];
  }
  if (!accounts[0]) {
    if (getCurrentAccount() && hasValidApiToken()) {
      return true;
    }
    clearAuthSession();
    emitAccountChange(null);
    if (redirect) {
      redirectHome();
    }
    return false;
  }
  const activeAccount = accounts[0];
  const storedAccount = getCurrentAccount();
  const accountChanged =
    !storedAccount || storedAccount.toLowerCase() !== activeAccount.toLowerCase();
  if (accountChanged) {
    handleAccountChange(activeAccount);
    emitAccountChange(activeAccount);
  }
  if (!accountChanged && hasValidApiToken()) {
    const stored = readStoredAuthToken();
    if (stored) {
      cachedApiToken = stored;
    }
    return true;
  }
  if (!hasValidApiToken()) {
    clearAuthSession();
    if (redirect) {
      redirectHome();
    }
    return false;
  }
  return true;
}

export async function setupWalletListeners(options: {
  provider?: Eip1193Provider;
  refreshProvider?: boolean;
} = {}) {
  startProviderWatcher();
  const provider = options.provider || (await resolveProvider(5000, {
    refresh: options.refreshProvider,
  }));
  if (!provider) {
    return;
  }
  await bindWalletProvider(provider);
}

// 获取链 ID
export async function getChainId() {
  try {
    const provider = await resolveProvider();
    if (!provider) {
      notifyError('未检测到钱包，请先安装并连接钱包');
      return;
    }
    const chainId = await web3GetChainId(provider);
    if (!chainId) {
      notifyError('未获取到链 ID');
      return;
    }

    const chainNames = {
      '0x1': 'Ethereum Mainnet',
      '0xaa36a7': 'Sepolia Testnet',
      '0x5': 'Goerli Testnet',
      '0x1538': 'YeYing Network',
    };

    const chainName = chainNames[chainId as keyof typeof chainNames] || '未知网络';
    return `链 ID: ${chainId}\n网络: ${chainName}`;
  } catch (error) {
    notifyError(`获取链 ID 失败：${error}`);
  }
}

// 获取余额
export async function getBalance() {
  const currentAccount = getCurrentAccount();
  if (!currentAccount) {
    notifyError('请先连接钱包');
    return;
  }
  try {
    const provider = await resolveProvider();
    if (!provider) {
      notifyError('未检测到钱包，请先安装并连接钱包');
      return;
    }
    const balance = await web3GetBalance(provider, currentAccount, 'latest');
    const ethBalance = parseInt(balance, 16) / 1e18;
    return `余额: ${ethBalance.toFixed(6)} ETH\n原始值: ${balance}`;
  } catch (error) {
    notifyError(`获取余额失败：${error}`);
  }
}

// SIWE 登录
export async function loginWithSiwe(
  providerOverride?: Eip1193Provider,
  accountOverride?: string
): Promise<boolean> {
  if (loginInFlight) {
    void focusPendingWalletApproval(providerOverride || cachedProvider);
    const requestedKey = normalizeAccountKey(accountOverride);
    if (!requestedKey || requestedKey === loginInFlight.accountKey) {
      return await loginInFlight.promise;
    }
    await loginInFlight.promise.catch(() => false);
  }
  const accountKey = normalizeAccountKey(accountOverride);
  const promise = (async () => {
    try {
      const provider = providerOverride || (await resolveProvider());
      if (!provider) {
        notifyError('未检测到钱包，请先安装并连接钱包');
        return false;
      }
      void setupWalletListeners({ provider });
      const accounts = accountOverride
        ? [accountOverride]
        : await requestWalletAccounts(provider);
      const currentAccount = accountOverride || accounts?.[0];
      if (!currentAccount) {
        notifyError('未获取到账户');
        return false;
      }
      handleAccountChange(currentAccount);
      emitAccountChange(currentAccount);
      clearManualLogoutMark();
      let chainId: number | undefined;
      try {
        const rawChainId = await web3GetChainId(provider);
        chainId = rawChainId ? Number.parseInt(String(rawChainId), 16) : undefined;
      } catch {
        chainId = undefined;
      }
      const challenge = await requestSiweChallenge(currentAccount, chainId);
      const signature = (await provider.request({
        method: 'personal_sign',
        params: [challenge.challenge, currentAccount],
      })) as string;
      const verified = await verifySiweSignature(currentAccount, signature);
      persistAuthToken(verified.token, verified.expiresAt);
      try {
        await getWebDavToken(provider);
      } catch {
        // webdav may be optional in some environments
      }
      return true;
    } catch (error) {
      notifyError(`登录失败：${error}`);
      return false;
    }
  })();
  loginInFlight = { accountKey, provider: providerOverride || cachedProvider, promise };
  try {
    return await promise;
  } finally {
    if (loginInFlight?.promise === promise) {
      loginInFlight = null;
    }
  }
}

// 保留旧名称，避免已有调用断裂；Node 主登录现在走 SIWE/JWT。
export async function loginWithUcan(
  providerOverride?: Eip1193Provider,
  accountOverride?: string
): Promise<boolean> {
  return await loginWithSiwe(providerOverride, accountOverride);
}

// 保留旧名称，保持兼容
export async function loginWithChallenge(
  providerOverride?: Eip1193Provider,
  accountOverride?: string
): Promise<boolean> {
  return await loginWithUcan(providerOverride, accountOverride);
}
