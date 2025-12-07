import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { NotificationsWorkersListerUseCase } from '@core/useCases/notifications/NotificationsWorkersLister.useCase';

export const listWorkers = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const notificationsWorkersListerUseCase = container.resolve(
    NotificationsWorkersListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await notificationsWorkersListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('workers_list_successfully'),
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
