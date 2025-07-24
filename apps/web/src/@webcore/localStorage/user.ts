import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import {
  AuthUserResponse,
  AccountInfoResponse,
} from '@core/schema/auth/login/response.schema';

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

export const setLayout = (layout: AccountInfoResponse): void => {
  localStorage.setItem('layout', JSON.stringify(layout));
};

export const getLayout = (): AccountInfoResponse | null => {
  const layout = localStorage.getItem('layout');

  return layout ? JSON.parse(layout) : null;
};

export const removeUserData = (): boolean => {
  localStorage.removeItem('token');
  localStorage.removeItem('permissions');
  localStorage.removeItem('user');
  localStorage.removeItem('layout');

  return !getToken() && !getUser() && getPermissions().length === 0;
};

export const isLoggedIn = (): boolean => {
  return !!getToken() && !!getUser() && getPermissions().length > 0;
};
