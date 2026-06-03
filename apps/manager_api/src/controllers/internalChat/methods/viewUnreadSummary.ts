import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { InternalChatUnreadSummaryViewerUseCase } from '@core/useCases/internalChat/InternalChatUnreadSummaryViewer.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const viewUnreadSummary = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatUnreadSummaryViewerUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id
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
