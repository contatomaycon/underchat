import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListReportConversationHistoryMessagesRequest } from '@core/schema/reportConversationHistory/listReportConversationHistoryMessages/request.schema';
import { ReportConversationHistoryMessagesListerUseCase } from '@core/useCases/reportConversationHistory/ReportConversationHistoryMessagesLister.useCase';

export const listReportConversationHistoryMessages = async (
  request: FastifyRequest<{
    Params: ListReportConversationHistoryMessagesRequest;
  }>,
  reply: FastifyReply
) => {
  const reportConversationHistoryMessagesListerUseCase = container.resolve(
    ReportConversationHistoryMessagesListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response =
      await reportConversationHistoryMessagesListerUseCase.execute(
        tokenJwtData.account_id,
        request.params.chat_id
      );

    return sendResponse(reply, {
      message: t('report_conversation_history_messages_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
