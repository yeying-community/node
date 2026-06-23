import { notifyError } from '@/utils/message';
import { getWalletDataStore } from '@/stores/auth';
import {
  classifyWalletError,
  createInvocationUcan,
  createUcanSession,
  clearUcanSession,
  DEFAULT_UCAN_TOKEN_SKEW_MS,
  focusPendingApproval,
  getAccounts,
  getCapabilityAction,
  getCapabilityResource,
  getUcanTokenTiming,
  getBalance as web3GetBalance,
  getChainId as web3GetChainId,
  getOrCreateUcanRoot,
  getProvider,
  isUcanTokenFresh,
  normalizeUcanCapabilities,
  onAccountsChanged,
  onChainChanged,
  requestAccounts,
  watchProvider,
  type Eip1193Provider,
  type UcanCapability,
  type UcanRootProof,
  type UcanSessionKey,
} from '@yeying-community/web3-bs';

type CachedToken = {
  token: string;
};

const UCAN_API_TOKEN_KEY = 'ucanToken';
const UCAN_WEBDAV_TOKEN_KEY = 'webdavToken';
const AUTH_TOKEN_KEY = 'authToken';
const AUTH_MANUAL_LOGOUT_KEY = 'authManualLogout';
const LOGIN_COMPLETION_WAIT_MS = 60000;
const LOGIN_COMPLETION_POLL_MS = 300;
const LOGIN_ROUTE_READY_WAIT_MS = 3000;

let cachedProvider: Eip1193Provider | null = null;
let providerWatcherReady = false;
let walletListenersProvider: Eip1193Provider | null = null;
let walletListenersTeardown: Array<() => void> = [];
let loginInFlight: { accountKey: string; promise: Promise<boolean> } | null = null;
let cachedApiToken: CachedToken | null = null;
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

async function focusPendingWalletApproval(provider?: Eip1193Provider | null) {
  try {
    const result = await focusPendingApproval(provider || undefined);
    return Boolean(result.focused);
  } catch {
    return false;
  }
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
      if (!hasValidApiToken()) {
        clearAuthSession();
        emitAccountChange(null);
        redirectHome();
      }
      return;
    }
    const nextAccount = accounts[0];
    const stored = getCurrentAccount();
    if (!stored || stored.toLowerCase() !== nextAccount.toLowerCase()) {
      handleAccountChange(nextAccount);
      emitAccountChange(nextAccount);
      try {
        const ok = await loginWithUcan(provider, nextAccount);
        if (!ok) {
          throw new Error('登录失败');
        }
      } catch {
        clearAuthSession();
        redirectHome();
      }
    }
  }));

  walletListenersTeardown.push(onChainChanged(provider, () => {
    resetTokenCaches();
  }));

  walletListenersTeardown.push(addProviderListener(provider, 'connect', () => {
    getWalletDataStore().setWalletReady(true);
    void ensureWalletSession({ redirect: false });
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
    .replace(/[^a-zA-Z0-9._-]/g, '-');
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
    `app:all:${resolveAppId()}`
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
    if (typeof window !== 'undefined') {
      return toDidWeb(window.location.origin);
    }
  }
  if (typeof window !== 'undefined') {
    return toDidWeb(window.location.origin);
  }
  return 'did:web:localhost';
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

function isTokenValid(entry: CachedToken | null): boolean {
  return Boolean(entry && isUcanTokenFresh(entry.token, {
    skewMs: DEFAULT_UCAN_TOKEN_SKEW_MS,
  }));
}

function readStoredToken(key: string): CachedToken | null {
  if (typeof localStorage === 'undefined') return null;
  const token = localStorage.getItem(key);
  if (!token) return null;
  const parsed = parseCachedToken(token);
  if (!parsed || !isTokenValid(parsed)) return null;
  return parsed;
}

function persistToken(key: string, entry: CachedToken) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, entry.token);
}

function clearStoredToken(key: string) {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(key);
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

function updateAuthTokenCache(token: string) {
  const parsed = parseCachedToken(token);
  if (!parsed) return;
  cachedApiToken = parsed;
  persistToken(UCAN_API_TOKEN_KEY, parsed);
  persistToken(AUTH_TOKEN_KEY, parsed);
}

function updateWebDavTokenCache(token: string) {
  const parsed = parseCachedToken(token);
  if (!parsed) return;
  cachedWebDavToken = parsed;
  persistToken(UCAN_WEBDAV_TOKEN_KEY, parsed);
}

function resetTokenCaches() {
  cachedApiToken = null;
  cachedWebDavToken = null;
  cachedSession = null;
  cachedRoot = null;
  cachedCapsKey = null;
}

function clearTokenStores() {
  clearStoredToken(UCAN_API_TOKEN_KEY);
  clearStoredToken(UCAN_WEBDAV_TOKEN_KEY);
  clearStoredToken(AUTH_TOKEN_KEY);
}

function hasValidApiToken(): boolean {
  if (isTokenValid(cachedApiToken)) return true;
  return Boolean(readStoredToken(UCAN_API_TOKEN_KEY));
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

  const cache = options.cache === 'api' ? cachedApiToken : cachedWebDavToken;
  if (isTokenValid(cache)) {
    return cache!.token;
  }

  const stored = readStoredToken(options.cache === 'api' ? UCAN_API_TOKEN_KEY : UCAN_WEBDAV_TOKEN_KEY);
  if (stored) {
    if (options.cache === 'api') {
      cachedApiToken = stored;
      persistToken(AUTH_TOKEN_KEY, stored);
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
    updateAuthTokenCache(token);
  } else {
    updateWebDavTokenCache(token);
  }
  return token;
}

export async function getAuthToken(providerOverride?: Eip1193Provider): Promise<string> {
  const capabilities = getApiUcanCapabilities();
  return await issueInvocationToken({
    provider: providerOverride,
    audience: resolveApiAudience(),
    capabilities,
    cache: 'api',
  });
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
      if (loginInFlight && await focusPendingWalletApproval(provider)) {
          const ok = await waitForLoginCompletion();
          if (ok) {
            if (!(await goMarketAfterLogin(router))) {
              notifyError('登录成功，但跳转应用商店失败，请重试');
            }
          }
        return;
      }
      const accounts = await requestAccounts({ provider });
      if (Array.isArray(accounts) && accounts.length > 0) {
        const currentAccount = accounts[0];
        const ok = await loginWithUcan(provider, currentAccount);
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
        notifyError(`钱包连接已断开，请恢复钱包后重试。${walletError.message}`);
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
  return String(localStorage.getItem(AUTH_TOKEN_KEY) || '').trim();
}

export async function logoutWithUcan(options: { redirect?: boolean } = {}) {
  const redirect = options.redirect !== false;
  markManualLogout();
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
    const stored = readStoredToken(UCAN_API_TOKEN_KEY);
    if (stored) {
      cachedApiToken = stored;
    }
    return true;
  }
  try {
    const ok = await loginWithUcan(provider, activeAccount);
    if (!ok) {
      throw new Error('登录失败');
    }
  } catch (error) {
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

// UCAN 登录
export async function loginWithUcan(
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
        : await requestAccounts({ provider });
      const currentAccount = accountOverride || accounts?.[0];
      if (!currentAccount) {
        notifyError('未获取到账户');
        return false;
      }
      handleAccountChange(currentAccount);
      emitAccountChange(currentAccount);
      clearManualLogoutMark();
      await getAuthToken(provider);
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
  loginInFlight = { accountKey, promise };
  try {
    return await promise;
  } finally {
    if (loginInFlight?.promise === promise) {
      loginInFlight = null;
    }
  }
}

// 保留旧名称，保持兼容
export async function loginWithChallenge(
  providerOverride?: Eip1193Provider,
  accountOverride?: string
): Promise<boolean> {
  return await loginWithUcan(providerOverride, accountOverride);
}
