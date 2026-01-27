import { AsyncLocalStorage } from 'async_hooks';

export type AuthUser = {
  address: string;
  issuer?: string;
  authType: 'jwt' | 'ucan';
};

type RequestContextStore = {
  user?: AuthUser;
};

const storage = new AsyncLocalStorage<RequestContextStore>();

export function runWithRequestContext(user: AuthUser | undefined, next: () => void) {
  storage.run({ user }, next);
}

export function getRequestUser(): AuthUser | undefined {
  return storage.getStore()?.user;
}
