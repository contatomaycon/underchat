import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListSentNotificationsUseCase } from '@core/useCases/notifications/ListSentNotifications.useCase';
import { ListSentNotificationsRequest } from '@core/schema/notifications/listSentNotifications/request.schema';

export const listSentNotifications = async (
  request: FastifyRequest<{
    Querystring: ListSentNotificationsRequest;
  }>,
  reply: FastifyReply
) => {
  const listSentNotificationsUseCase = container.resolve(
    ListSentNotificationsUseCase
  );
  const { t, query } = request;

  try {
    const response = await listSentNotificationsUseCase.execute(query);

    return sendResponse(reply, {
      message: t('sent_notifications_listed_successfully'),
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
