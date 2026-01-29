import { notifyError } from '@/utils/message';
import { getWalletDataStore } from '@/stores/auth';
import {
  createInvocationUcan,
  createUcanSession,
  clearUcanSession,
  getAccounts,
  getBalance as web3GetBalance,
  getChainId as web3GetChainId,
  getOrCreateUcanRoot,
  getProvider,
  onAccountsChanged,
  requestAccounts,
  type Eip1193Provider,
  type UcanCapability,
  type UcanRootProof,
  type UcanSessionKey,
} from '@yeying-community/web3-bs';

type CachedToken = {
  token: string;
  exp: number;
  nbf?: number;
};

const UCAN_API_TOKEN_KEY = 'ucanToken';
const UCAN_WEBDAV_TOKEN_KEY = 'webdavToken';
const AUTH_TOKEN_KEY = 'authToken';
const TOKEN_SKEW_MS = 5000;

let cachedProvider: Eip1193Provider | null = null;
let listenersReady = false;
let loginInFlight: Promise<boolean> | null = null;
let cachedApiToken: CachedToken | null = null;
let cachedWebDavToken: CachedToken | null = null;
let cachedSession: UcanSessionKey | null = null;
let cachedRoot: UcanRootProof | null = null;
let cachedCapsKey: string | null = null;

async function resolveProvider(timeoutMs = 5000) {
  if (cachedProvider) {
    return cachedProvider;
  }
  cachedProvider = await getProvider({ timeoutMs });
  return cachedProvider;
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
    window.location.href = target;
  }
}

function decodeBase64Url(input: string): string | null {
  if (!input) return null;
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  try {
    if (typeof atob === 'function') {
      return atob(padded);
    }
  } catch {
    // ignore
  }
  try {
    const nodeBuffer = (globalThis as {
      Buffer?: { from: (value: string, encoding: string) => { toString: (encoding: string) => string } };
    }).Buffer;
    if (nodeBuffer) {
      return nodeBuffer.from(padded, 'base64').toString('utf8');
    }
  } catch {
    return null;
  }
  return null;
}

function decodeUcanPayload(token: string): { exp?: number; nbf?: number } | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const decoded = decodeBase64Url(parts[1]);
  if (!decoded) return null;
  try {
    return JSON.parse(decoded) as { exp?: number; nbf?: number };
  } catch {
    return null;
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

function getUcanCapabilities(): UcanCapability[] {
  const resource = import.meta.env.VITE_UCAN_RESOURCE || 'profile';
  const action = import.meta.env.VITE_UCAN_ACTION || 'read';
  return [{ resource, action }];
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
    throw new Error('Missing VITE_WEBDAV_BASE_URL');
  }
  return toDidWeb(baseUrl);
}

function parseCachedToken(token: string): CachedToken | null {
  const payload = decodeUcanPayload(token);
  if (!payload || typeof payload.exp !== 'number') return null;
  return { token, exp: payload.exp, nbf: payload.nbf };
}

function isTokenValid(entry: CachedToken | null): boolean {
  if (!entry || !entry.exp) return false;
  const nowMs = Date.now();
  if (entry.nbf && nowMs < entry.nbf) return false;
  return entry.exp - TOKEN_SKEW_MS > nowMs;
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

function clearAuthSession() {
  clearTokenStores();
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('currentAccount');
  }
  resetTokenCaches();
  void clearUcanSession();
}

function handleAccountChange(nextAccount: string) {
  clearTokenStores();
  resetTokenCaches();
  void clearUcanSession();
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
  capabilities: UcanCapability[],
  address?: string
): Promise<UcanRootProof> {
  const capsKey = JSON.stringify(capabilities || []);
  if (cachedRoot && cachedCapsKey === capsKey && !(cachedRoot.exp && Date.now() > cachedRoot.exp)) {
    return cachedRoot;
  }
  const session = await ensureUcanSession(provider);
  const root = await getOrCreateUcanRoot({
    provider,
    session,
    capabilities,
    address,
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
    throw new Error('No wallet provider');
  }
  const session = await ensureUcanSession(provider);
  const root = await ensureUcanRoot(provider, options.capabilities, options.address);
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
  const capabilities = getUcanCapabilities();
  return await issueInvocationToken({
    provider: providerOverride,
    audience: resolveApiAudience(),
    capabilities,
    cache: 'api',
  });
}

export async function getWebDavToken(providerOverride?: Eip1193Provider): Promise<string> {
  const capabilities = getUcanCapabilities();
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
    throw new Error('❌未检测到钱包');
  }
  return provider;
}

// 连接钱包
export async function connectWallet(router: any, route: any) {
  if (localStorage.getItem('hasConnectedWallet') === 'false') {
    notifyError('❌未检测到钱包，请先安装并连接钱包');
    return;
  }
  try {
    const provider = await resolveProvider();
    if (!provider) {
      notifyError('❌未检测到钱包，请先安装并连接钱包');
      return;
    }
    getWalletDataStore().setWalletReady(true);
    try {
      const accounts = await requestAccounts({ provider });
      if (Array.isArray(accounts) && accounts.length > 0) {
        const currentAccount = accounts[0];
        const ok = await loginWithUcan(provider, currentAccount);
        if (!ok) {
          notifyError('❌登录失败，未获取到 token');
          return;
        }
        if (router) {
          await router.push('/market');
        } else {
          window.location.href = `${getHomeUrl()}market`;
        }
      } else {
        notifyError('❌未获取到账户');
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'message' in error) {
        const err = error as { message?: string; code?: number; [key: string]: any };
        console.log(`❌error.message=${err.message}`);
        if (typeof err.message === 'string' && err.message.includes('Session expired')) {
          notifyError(`❌会话已过期，请打开钱包插件输入密码激活钱包状态 ${error}`);
        } else if (err.code === 4001) {
          notifyError(`❌用户拒绝了连接请求 ${error}`);
        } else {
          console.error('❌未知连接错误:', error);
          notifyError(`❌连接失败，请检查钱包状态 ${error}`);
        }
      } else {
        console.error('❌非预期的错误类型:', error);
        notifyError(`❌连接失败，发生未知错误 ${error}`);
      }
      return;
    }
  } catch (error) {
    console.error('❌连接失败:', error);
    notifyError(`❌连接失败: ${error}`);
  }
}

export function getCurrentAccount() {
  return localStorage.getItem('currentAccount');
}

export async function signWithWallet(message: string): Promise<string> {
  const provider = await resolveProvider();
  if (!provider) {
    throw new Error('No wallet provider');
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
      const accounts = await requestAccounts(provider);
      account = accounts?.[0];
    } catch {
      account = null;
    }
  }
  if (!account) {
    throw new Error('No wallet account');
  }
  const payload = typeof message === 'string' ? message : JSON.stringify(message);
  return (await provider.request({
    method: 'personal_sign',
    params: [payload, account],
  })) as string;
}

export async function ensureWalletSession(options: { redirect?: boolean } = {}) {
  const redirect = options.redirect !== false;
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
      throw new Error('Login failed');
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

export async function setupWalletListeners() {
  if (listenersReady) {
    return;
  }
  const provider = await resolveProvider();
  if (!provider) {
    return;
  }
  listenersReady = true;
  onAccountsChanged(provider, async (accounts) => {
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
          throw new Error('Login failed');
        }
      } catch {
        clearAuthSession();
        redirectHome();
      }
    }
  });
}

// 获取链 ID
export async function getChainId() {
  if (localStorage.getItem('hasConnectedWallet') === 'false') {
    notifyError('❌未检测到钱包，请先安装并连接钱包');
    return;
  }
  try {
    const provider = await resolveProvider();
    if (!provider) {
      notifyError('❌未检测到钱包，请先安装并连接钱包');
      return;
    }
    const chainId = await web3GetChainId(provider);
    if (!chainId) {
      notifyError('❌未获取到链 ID');
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
    console.error('❌获取链 ID 失败:', error);
    notifyError(`❌获取链 ID 失败: ${error}`);
  }
}

// 获取余额
export async function getBalance() {
  if (localStorage.getItem('hasConnectedWallet') === 'false') {
    notifyError('❌未检测到钱包，请先安装并连接钱包');
    return;
  }
  const currentAccount = getCurrentAccount();
  if (!currentAccount) {
    notifyError('❌请先连接钱包');
    return;
  }
  try {
    const provider = await resolveProvider();
    if (!provider) {
      notifyError('❌未检测到钱包，请先安装并连接钱包');
      return;
    }
    const balance = await web3GetBalance(provider, currentAccount, 'latest');
    const ethBalance = parseInt(balance, 16) / 1e18;
    return `余额: ${ethBalance.toFixed(6)} ETH\n原始值: ${balance}`;
  } catch (error) {
    console.error('❌获取余额失败:', error);
    notifyError(`❌获取余额失败: ${error}`);
  }
}

// UCAN 登录
export async function loginWithUcan(
  providerOverride?: Eip1193Provider,
  accountOverride?: string
): Promise<boolean> {
  if (loginInFlight) {
    return await loginInFlight;
  }
  if (localStorage.getItem('hasConnectedWallet') === 'false') {
    notifyError('❌未检测到钱包，请先安装并连接钱包');
    return false;
  }
  loginInFlight = (async () => {
    try {
      const provider = providerOverride || (await resolveProvider());
      if (!provider) {
        notifyError('❌未检测到钱包，请先安装并连接钱包');
        return false;
      }
      const accounts = accountOverride
        ? [accountOverride]
        : await requestAccounts({ provider });
      const currentAccount = accountOverride || accounts?.[0];
      if (!currentAccount) {
        notifyError('❌未获取到账户');
        return false;
      }
      const storedAccount = getCurrentAccount();
      if (!storedAccount || storedAccount.toLowerCase() !== currentAccount.toLowerCase()) {
        handleAccountChange(currentAccount);
      } else {
        localStorage.setItem('currentAccount', currentAccount);
      }
      await getAuthToken(provider);
      try {
        await getWebDavToken(provider);
      } catch {
        // webdav may be optional in some environments
      }
      return true;
    } catch (error) {
      console.error('❌登录失败:', error);
      notifyError(`❌登录失败: ${error}`);
      return false;
    }
  })();
  try {
    return await loginInFlight;
  } finally {
    loginInFlight = null;
  }
}

// 保留旧名称，保持兼容
export async function loginWithChallenge(
  providerOverride?: Eip1193Provider,
  accountOverride?: string
): Promise<boolean> {
  return await loginWithUcan(providerOverride, accountOverride);
}
