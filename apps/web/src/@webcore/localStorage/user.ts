import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { AuthUserResponse } from '@core/schema/auth/login/response.schema';

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

export const logout = (): void => {
  localStorage.removeItem('token');
  localStorage.removeItem('permissions');
  localStorage.removeItem('user');
};

export const isLoggedIn = (): boolean => {
  return !!getToken() && !!getUser() && getPermissions().length > 0;
};
