import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import {
  UpdateGroupBody,
  UpdateGroupParams,
} from '@core/schema/internalChat/updateGroup/request.schema';
import { InternalChatGroupUpdaterUseCase } from '@core/useCases/internalChat/InternalChatGroupUpdater.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const updateGroup = async (
  request: FastifyRequest<{ Params: UpdateGroupParams; Body: UpdateGroupBody }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatGroupUpdaterUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params.id,
      request.body
    );

    return sendResponse(reply, {
      message: t('chat_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
