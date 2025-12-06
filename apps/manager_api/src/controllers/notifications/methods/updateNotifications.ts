import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { NotificationsUpserterUseCase } from '@core/useCases/notifications/NotificationsUpserter.useCase';
import { UpdateNotificationsRequest } from '@core/schema/notifications/updateNotifications/request.schema';

export const updateNotifications = async (
  request: FastifyRequest<{ Body: UpdateNotificationsRequest }>,
  reply: FastifyReply
) => {
  const notificationsUpserterUseCase = container.resolve(
    NotificationsUpserterUseCase
  );
  const { t, body } = request;

  try {
    const response = await notificationsUpserterUseCase.execute(body);

    return sendResponse(reply, {
      message: t('notifications_update_successfully'),
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
