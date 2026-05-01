import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { CreateGroupBody } from '@core/schema/internalChat/createGroup/request.schema';
import { InternalChatGroupCreatorUseCase } from '@core/useCases/internalChat/InternalChatGroupCreator.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const createGroup = async (
  request: FastifyRequest<{ Body: CreateGroupBody }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatGroupCreatorUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('chat_create_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
