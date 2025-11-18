import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ClearChatSummaryBody } from '@core/schema/chat/clearChatSummary/request.schema';
import { ChatSummaryClearerUseCase } from '@core/useCases/chat/ChatSummaryClearer.useCase';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';

export const clearChatSummary = async (
  request: FastifyRequest<{
    Body: ClearChatSummaryBody;
  }>,
  reply: FastifyReply
) => {
  const chatSummaryClearerUseCase = container.resolve(
    ChatSummaryClearerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatSummaryClearerUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.body.chat_ids
    );

    return sendResponse(reply, {
      message: t('chat_summary_clear_success'),
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
