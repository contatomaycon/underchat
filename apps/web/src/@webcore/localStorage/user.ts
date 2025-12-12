import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import {
  AuthUserResponse,
  AccountInfoResponse,
} from '@core/schema/auth/login/response.schema';

const PLAN_STATUS_KEY = 'plan_is_active';

export const setSectors = (sectors: string[]): void => {
  localStorage.setItem('sectors', JSON.stringify(sectors));
};

export const getSectors = (): string[] => {
  const sectors = localStorage.getItem('sectors');
  return sectors ? JSON.parse(sectors) : [];
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
  const permissions = localStorage.getItem('permissions');

  return permissions ? JSON.parse(permissions) : [];
};

export const setUser = (user: AuthUserResponse): void => {
  localStorage.setItem('user', JSON.stringify(user));
};

export const getUser = (): AuthUserResponse | null => {
  const user = localStorage.getItem('user');

  return user ? JSON.parse(user) : null;
};

export const setLayout = (layout: AccountInfoResponse | null): void => {
  if (layout === null) {
    localStorage.removeItem('layout');
  } else {
    localStorage.setItem('layout', JSON.stringify(layout));
  }
};

export const getLayout = (): AccountInfoResponse | null => {
  const layout = localStorage.getItem('layout');

  return layout ? JSON.parse(layout) : null;
};

const setPlanStatusToStorage = (isActive: boolean): void => {
  localStorage.setItem(PLAN_STATUS_KEY, JSON.stringify(isActive));
};

const getPlanStatusFromStorage = (): boolean => {
  const value = localStorage.getItem(PLAN_STATUS_KEY);
  return value ? JSON.parse(value) : false;
};

export const initializePlanStatus = (): boolean => {
  return getPlanStatusFromStorage();
};

export const persistPlanStatus = (isActive: boolean): void => {
  setPlanStatusToStorage(isActive);
};

export const removeUserData = (): boolean => {
  localStorage.removeItem('token');
  localStorage.removeItem('permissions');
  localStorage.removeItem('user');
  localStorage.removeItem('layout');
  localStorage.removeItem('sectors');
  localStorage.removeItem(PLAN_STATUS_KEY);

  return !getToken() && !getUser() && getPermissions().length === 0;
};

export const isLoggedIn = (): boolean => {
  return !!getToken() && !!getUser();
};
