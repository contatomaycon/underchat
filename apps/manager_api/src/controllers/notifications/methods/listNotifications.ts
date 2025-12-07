import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { NotificationsViewerUseCase } from '@core/useCases/notifications/NotificationsViewer.useCase';

export const listNotifications = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const notificationsViewerUseCase = container.resolve(
    NotificationsViewerUseCase
  );
  const { t } = request;

  try {
    const response = await notificationsViewerUseCase.execute();

    return sendResponse(reply, {
      message: t('notifications_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    console.error(error);

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
