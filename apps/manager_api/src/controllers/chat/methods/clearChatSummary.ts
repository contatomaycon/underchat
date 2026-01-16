import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  ClearChatSummaryParams,
  ClearChatSummaryBody,
} from '@core/schema/chat/clearChatSummary/request.schema';
import { ChatSummaryClearUseCase } from '@core/useCases/chat/ChatSummaryClear.useCase';

export const clearChatSummary = async (
  request: FastifyRequest<{
    Params: ClearChatSummaryParams;
    Body: ClearChatSummaryBody;
  }>,
  reply: FastifyReply
) => {
  const chatSummaryClearUseCase = container.resolve(ChatSummaryClearUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatSummaryClearUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_summary_clear_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: { success: true },
      });
    }

    return sendResponse(reply, {
      message: t('chat_summary_clear_failed'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
