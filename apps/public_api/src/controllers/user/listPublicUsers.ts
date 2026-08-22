import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PublicUserScopeRepository } from '@/repositories/PublicUserScope.repository';

export async function listPublicUsers(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const repository = container.resolve(PublicUserScopeRepository);
  const { t, tokenJwtData } = request;

  try {
    const users = await repository.listActiveUsers(tokenJwtData.account_id);
    sendResponse(reply, {
      message: t('user_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: users,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
}
