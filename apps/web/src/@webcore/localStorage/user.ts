import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import {
  AuthUserResponse,
  AccountInfoResponse,
} from '@core/schema/auth/login/response.schema';
import {
  IUserChannel,
  ITokenJwtData,
} from '@core/common/interfaces/ITokenJwtData';
import { normalizeUserChannels } from '@core/common/functions/extractUserChannelIds';

const PLAN_STATUS_KEY = 'plan_is_active';
const PLAN_PRODUCTS_KEY = 'plan_products';

type AuthContext = Pick<ITokenJwtData, 'account_id' | 'user_id'>;

const readJson = <T>(key: string, fallback: T): T => {
  const value = localStorage.getItem(key);

  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
};

const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);

  return globalThis.atob(normalized + padding);
};

const hasAuthContext = (
  value: Partial<ITokenJwtData>
): value is AuthContext => {
  return (
    typeof value.account_id === 'string' && typeof value.user_id === 'string'
  );
};

export const setSectors = (sectors: string[]): void => {
  localStorage.setItem('sectors', JSON.stringify(sectors));
};

export const getSectors = (): string[] => {
  return readJson<string[]>('sectors', []);
};

export const setChannels = (channels: IUserChannel[]): void => {
  localStorage.setItem(
    'channels',
    JSON.stringify(normalizeUserChannels(channels))
  );
};

export const getChannels = (): IUserChannel[] => {
  const channels = localStorage.getItem('channels');
  if (!channels) {
    return [];
  }

  try {
    const parsedChannels = JSON.parse(channels) as IUserChannel[];
    return normalizeUserChannels(parsedChannels);
  } catch {
    return [];
  }
};

export const setToken = (token: string): void => {
  localStorage.setItem('token', token);
};

export const getToken = (): string | null => {
  return localStorage.getItem('token');
};

export const setPermissions = (permissions: EPermissionsRoles[]): void => {
  localStorage.setItem('permissions', JSON.stringify(permissions));
};

export const getPermissions = (): EPermissionsRoles[] => {
  return readJson<EPermissionsRoles[]>('permissions', []);
};

export const setUser = (user: AuthUserResponse): void => {
  localStorage.setItem('user', JSON.stringify(user));
};

export const getUser = (): AuthUserResponse | null => {
  return readJson<AuthUserResponse | null>('user', null);
};

export const getTokenJwtData = (): AuthContext | null => {
  const token = getToken();
  const payload = token?.split('.')[1];

  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      decodeBase64Url(payload)
    ) as Partial<ITokenJwtData>;

    return hasAuthContext(parsed)
      ? { account_id: parsed.account_id, user_id: parsed.user_id }
      : null;
  } catch {
    return null;
  }
};

export const isStoredAuthContextConsistent = (): boolean => {
  const tokenData = getTokenJwtData();
  const user = getUser();

  if (!tokenData || !user) {
    return false;
  }

  return (
    tokenData.account_id === user.account_id &&
    tokenData.user_id === user.user_id
  );
};

export const setLayout = (layout: AccountInfoResponse | null): void => {
  if (layout === null) {
    localStorage.removeItem('layout');
  } else {
    localStorage.setItem('layout', JSON.stringify(layout));
  }
};

export const getLayout = (): AccountInfoResponse | null => {
  return readJson<AccountInfoResponse | null>('layout', null);
};

const setPlanStatusToStorage = (isActive: boolean): void => {
  localStorage.setItem(PLAN_STATUS_KEY, JSON.stringify(isActive));
};

const getPlanStatusFromStorage = (): boolean => {
  return readJson<boolean>(PLAN_STATUS_KEY, false);
};

export const initializePlanStatus = (): boolean => {
  return getPlanStatusFromStorage();
};

export const persistPlanStatus = (isActive: boolean): void => {
  setPlanStatusToStorage(isActive);
};

export const setPlanProducts = (planProducts: string[]): void => {
  localStorage.setItem(PLAN_PRODUCTS_KEY, JSON.stringify(planProducts));
};

export const getPlanProducts = (): string[] => {
  const planProducts = localStorage.getItem(PLAN_PRODUCTS_KEY);
  if (!planProducts) {
    return [];
  }

  try {
    const parsed = JSON.parse(planProducts) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
};

export const initializePlanProducts = (): string[] => {
  return getPlanProducts();
};

export const removeUserData = (): boolean => {
  localStorage.removeItem('token');
  localStorage.removeItem('permissions');
  localStorage.removeItem('user');
  localStorage.removeItem('layout');
  localStorage.removeItem('sectors');
  localStorage.removeItem('channels');
  localStorage.removeItem(PLAN_STATUS_KEY);
  localStorage.removeItem(PLAN_PRODUCTS_KEY);

  return !getToken() && !getUser() && getPermissions().length === 0;
};

export const isLoggedIn = (): boolean => {
  const hasPersistedSession = !!getToken() && !!getUser();

  if (!hasPersistedSession) {
    return false;
  }

  if (isStoredAuthContextConsistent()) {
    return true;
  }

  removeUserData();
  return false;
};
