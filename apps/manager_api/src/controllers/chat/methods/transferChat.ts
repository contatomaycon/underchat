import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  TransferChatParams,
  TransferChatBody,
} from '@core/schema/chat/transferChat/request.schema';
import { TransferChatUseCase } from '@core/useCases/chat/TransferChat.useCase';

export const transferChat = async (
  request: FastifyRequest<{
    Params: TransferChatParams;
    Body: TransferChatBody;
  }>,
  reply: FastifyReply
) => {
  const transferChatUseCase = container.resolve(TransferChatUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await transferChatUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      request.body,
      tokenJwtData.user_id,
      tokenJwtData.permission_role_id ?? null,
      tokenJwtData.actions,
      tokenJwtData.channels
    );

    return sendResponse(reply, {
      message: t('chat_transfer_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (
        error.message === t('chat_only_primary_can_transfer') ||
        error.message === t('chat_access_denied')
      ) {
        return sendResponse(reply, {
          message: error.message,
          httpStatusCode: EHTTPStatusCode.forbidden,
        });
      }

      if (error.message === t('chat_cannot_transfer_to_current_primary')) {
        return sendResponse(reply, {
          message: error.message,
          httpStatusCode: EHTTPStatusCode.bad_request,
        });
      }
    }

    handleControllerError(error, reply, t);
  }
};
