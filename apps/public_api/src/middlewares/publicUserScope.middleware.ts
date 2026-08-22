import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { isMasterOrAdministratorRole } from '@core/common/functions/isMasterOrAdministratorRole';
import { isUuidLike } from '@core/common/functions/isUuidLike';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PublicUserScopeRepository } from '@/repositories/PublicUserScope.repository';

interface PublicUserParams {
  user_id?: string;
}

interface WrappedValue {
  value?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapValue(value: unknown): unknown {
  if (isObject(value) && 'value' in value) {
    return (value as WrappedValue).value;
  }
  return value;
}

function readString(value: unknown): string | null {
  const unwrapped = unwrapValue(value);
  return typeof unwrapped === 'string' && unwrapped.length > 0
    ? unwrapped
    : null;
}

function readStringArray(value: unknown): string[] {
  const unwrapped = unwrapValue(value);
  if (Array.isArray(unwrapped)) {
    return unwrapped.filter((item): item is string => typeof item === 'string');
  }

  if (typeof unwrapped !== 'string' || unwrapped.length === 0) return [];

  try {
    const parsed: unknown = JSON.parse(unwrapped);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    // Multipart inputs may send a single UUID instead of a JSON array.
  }

  return [unwrapped];
}

function readIndexedStrings(
  body: Record<string, unknown>,
  fieldName: string
): string[] {
  const indexedFieldPattern = new RegExp(`^${fieldName}\\[\\d+\\]$`);

  return Object.entries(body).flatMap(([key, value]) => {
    if (!indexedFieldPattern.test(key)) return [];
    const stringValue = readString(value);
    return stringValue ? [stringValue] : [];
  });
}

function reject(
  request: FastifyRequest,
  reply: FastifyReply,
  messageKey: string,
  httpStatusCode: EHTTPStatusCode
): void {
  sendResponse(reply, {
    message: request.t(messageKey),
    httpStatusCode,
  });
}

export async function guardPublicUserTarget(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const params = request.params as PublicUserParams;
  if (!params?.user_id) return;

  const repository = container.resolve(PublicUserScopeRepository);
  const belongsToAccount = await repository.userBelongsToAccount(
    params.user_id,
    request.tokenJwtData.account_id
  );

  if (!belongsToAccount) {
    reject(request, reply, 'user_not_found', EHTTPStatusCode.not_found);
  }
}

export async function guardPublicUserReferences(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const repository = container.resolve(PublicUserScopeRepository);
  const accountId = request.tokenJwtData.account_id;
  const body = isObject(request.body) ? request.body : {};
  const query = isObject(request.query) ? request.query : {};

  const permissionRoleId =
    readString(body.permission_role_id) ?? readString(query.permission_role_id);

  if (permissionRoleId) {
    if (!isUuidLike(permissionRoleId)) {
      reject(
        request,
        reply,
        'permission_role_not_found',
        EHTTPStatusCode.bad_request
      );
      return;
    }

    if (isMasterOrAdministratorRole(permissionRoleId)) {
      reject(request, reply, 'permission_denied', EHTTPStatusCode.forbidden);
      return;
    }

    const belongsToAccount = await repository.roleBelongsToAccount(
      permissionRoleId,
      accountId
    );
    if (!belongsToAccount) {
      reject(
        request,
        reply,
        'permission_role_not_found',
        EHTTPStatusCode.bad_request
      );
      return;
    }
  }

  const querySectorId = readString(query.sector_id);
  const sectorIds = [
    ...readStringArray(body.sector_ids),
    ...readIndexedStrings(body, 'sector_ids'),
    ...(querySectorId ? [querySectorId] : []),
  ];
  if (sectorIds.some((sectorId) => !isUuidLike(sectorId))) {
    reject(request, reply, 'sector_not_found', EHTTPStatusCode.bad_request);
    return;
  }
  if (
    sectorIds.length > 0 &&
    !(await repository.sectorsBelongToAccount(sectorIds, accountId))
  ) {
    reject(request, reply, 'sector_not_found', EHTTPStatusCode.bad_request);
    return;
  }

  const channelIds = [
    ...readStringArray(body.channel_ids),
    ...readIndexedStrings(body, 'channel_ids'),
  ];
  if (channelIds.some((channelId) => !isUuidLike(channelId))) {
    reject(request, reply, 'channel_not_found', EHTTPStatusCode.bad_request);
    return;
  }
  if (
    channelIds.length > 0 &&
    !(await repository.channelsBelongToAccount(channelIds, accountId))
  ) {
    reject(request, reply, 'channel_not_found', EHTTPStatusCode.bad_request);
  }
}
