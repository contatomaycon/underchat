import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
      tokenJwtData.is_administrator,
      request.params,
      request.body,
      tokenJwtData.user_id,
      tokenJwtData.sectors
    );

    return sendResponse(reply, {
      message: t('chat_transfer_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
