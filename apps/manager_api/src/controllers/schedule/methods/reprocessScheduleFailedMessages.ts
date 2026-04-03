import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ScheduleMessagesReprocessorUseCase } from '@core/useCases/schedule/ScheduleMessagesReprocessor.useCase';
import { ReprocessScheduleFailedParamsRequest } from '@core/schema/schedule/reprocessScheduleFailed/request.schema';

export const reprocessScheduleFailedMessages = async (
  request: FastifyRequest<{
    Params: ReprocessScheduleFailedParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const scheduleMessagesReprocessorUseCase = container.resolve(
    ScheduleMessagesReprocessorUseCase
  );
  const { t, tokenJwtData } = request;
  const { schedule_id: scheduleId } = request.params;

  try {
    const response =
      await scheduleMessagesReprocessorUseCase.reprocessFailedMessages(
        t,
        scheduleId,
        tokenJwtData.account_id
      );

    return sendResponse(reply, {
      message: t('schedule_reprocess_failed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
