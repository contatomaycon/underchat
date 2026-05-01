import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { ListUsersQuery } from '@core/schema/internalChat/listUsers/request.schema';
import { InternalChatUsersListerUseCase } from '@core/useCases/internalChat/InternalChatUsersLister.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const listUsers = async (
  request: FastifyRequest<{ Querystring: ListUsersQuery }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatUsersListerUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.query
    );

    return sendResponse(reply, {
      message: t('chat_list_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
