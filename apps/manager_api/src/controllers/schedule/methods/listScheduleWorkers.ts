import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ScheduleWorkersListerUseCase } from '@core/useCases/schedule/ScheduleWorkersLister.useCase';

export const listScheduleWorkers = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const scheduleWorkersListerUseCase = container.resolve(
    ScheduleWorkersListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await scheduleWorkersListerUseCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.channels
    );

    if (response) {
      return sendResponse(reply, {
        message: t('schedule_workers_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('schedule_workers_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
