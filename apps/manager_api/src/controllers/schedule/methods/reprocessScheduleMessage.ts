import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ScheduleMessagesReprocessorUseCase } from '@core/useCases/schedule/ScheduleMessagesReprocessor.useCase';
import { ReprocessScheduleMessageParamsRequest } from '@core/schema/schedule/reprocessScheduleMessage/request.schema';

export const reprocessScheduleMessage = async (
  request: FastifyRequest<{
    Params: ReprocessScheduleMessageParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const scheduleMessagesReprocessorUseCase = container.resolve(
    ScheduleMessagesReprocessorUseCase
  );
  const { t, tokenJwtData } = request;
  const { schedule_id: scheduleId, message_id: messageId } = request.params;

  try {
    await scheduleMessagesReprocessorUseCase.reprocessMessage(
      t,
      scheduleId,
      messageId,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('schedule_reprocess_message_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: null,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
