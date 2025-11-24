import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { StartChatWithContactRequest } from '@core/schema/chat/startChatWithContact/request.schema';
import { StartChatWithContactUseCase } from '@core/useCases/chat/StartChatWithContact.useCase';

export const startChatWithContact = async (
  request: FastifyRequest<{
    Body: StartChatWithContactRequest;
  }>,
  reply: FastifyReply
) => {
  const startChatWithContactUseCase = container.resolve(
    StartChatWithContactUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await startChatWithContactUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      tokenJwtData.is_administrator,
      request.body
    );

    return sendResponse(reply, {
      message: t('chat_create_success'),
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
