import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DashboardConversationsViewerUseCase } from '@core/useCases/dashboard/DashboardConversationsViewer.useCase';

export const getDashboardConversations = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const dashboardConversationsViewerUseCase = container.resolve(
    DashboardConversationsViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await dashboardConversationsViewerUseCase.execute(
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('dashboard_conversations_loaded_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('dashboard_conversations_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
