import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
