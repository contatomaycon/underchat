import { EGeneralPermissions } from '../enums/EPermissions/general';
import { IJwtGroupHierarchy } from '../interfaces/IJwtGroupHierarchy';
import { hasRequiredPermission } from './hasRequiredPermission';

export function hasFullAccess(actions: IJwtGroupHierarchy[]): boolean {
  return hasRequiredPermission(actions, [
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
  ]);
}

function isAccountIdAll<T extends { account_id?: string | null }>(
  query: T
): boolean {
  return query.account_id === 'all';
}

function isAccountIdNotProvided<T extends { account_id?: string | null }>(
  query: T
): boolean {
  return !('account_id' in query) || query.account_id === undefined;
}

function removeAccountIdFromQuery<T extends { account_id?: string | null }>(
  query: T,
  hasPermission: boolean
): Omit<T, 'account_id'> & { account_id?: string | null } {
  const sanitizedQuery = { ...query };

  if (!hasPermission && 'account_id' in sanitizedQuery) {
    delete sanitizedQuery.account_id;
  }

  return sanitizedQuery;
}

function resolveAccountIdAndPermission<
  T extends { account_id?: string | null },
>(
  query: T,
  hasPermission: boolean,
  defaultAccountId: string
): {
  accountId: string | null;
  canReturnAll: boolean;
} {
  if (!hasPermission) {
    return {
      accountId: defaultAccountId,
      canReturnAll: false,
    };
  }

  if (isAccountIdNotProvided(query)) {
    return {
      accountId: defaultAccountId,
      canReturnAll: false,
    };
  }

  if (isAccountIdAll(query)) {
    return {
      accountId: null,
      canReturnAll: true,
    };
  }

  if (query.account_id === null || query.account_id === '') {
    return {
      accountId: defaultAccountId,
      canReturnAll: false,
    };
  }

  return {
    accountId: query.account_id as string,
    canReturnAll: false,
  };
}

export function sanitizeQueryAccountId<
  T extends { account_id?: string | null },
>(
  query: T,
  actions: IJwtGroupHierarchy[],
  defaultAccountId: string
): {
  query: Omit<T, 'account_id'> & { account_id?: string | null };
  accountId: string | null;
  canReturnAll: boolean;
} {
  const userHasFullAccess = hasFullAccess(actions);

  if (!userHasFullAccess && 'account_id' in query && query.account_id) {
    const sanitizedQuery = { ...query };
    delete sanitizedQuery.account_id;

    return {
      query: sanitizedQuery,
      accountId: defaultAccountId,
      canReturnAll: false,
    };
  }

  const sanitizedQuery = removeAccountIdFromQuery(query, userHasFullAccess);
  const { accountId, canReturnAll } = resolveAccountIdAndPermission(
    query,
    userHasFullAccess,
    defaultAccountId
  );

  return {
    query: sanitizedQuery,
    accountId,
    canReturnAll,
  };
}
