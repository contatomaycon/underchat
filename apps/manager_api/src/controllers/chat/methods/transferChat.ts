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
      request.body
    );

    return sendResponse(reply, {
      message: t('chat_transfer_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
