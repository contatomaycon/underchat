import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
