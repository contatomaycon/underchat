import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
