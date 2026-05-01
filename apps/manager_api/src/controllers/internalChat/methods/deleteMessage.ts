import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { DeleteMessageParams } from '@core/schema/internalChat/deleteMessage/request.schema';
import { InternalChatMessageDeleterUseCase } from '@core/useCases/internalChat/InternalChatMessageDeleter.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const deleteMessage = async (
  request: FastifyRequest<{ Params: DeleteMessageParams }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatMessageDeleterUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params.conversation_id,
      request.params.message_id
    );

    return sendResponse(reply, {
      message: t('chat_delete_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response ? null : null,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
