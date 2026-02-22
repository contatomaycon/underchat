import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ScheduleActionUpdaterUseCase } from '@core/useCases/schedule/ScheduleActionUpdater.useCase';
import { EScheduleAction } from '@core/common/enums/EScheduleAction';
import { UpdateScheduleActionParamsRequest } from '@core/schema/schedule/updateScheduleAction/request.schema';

const actionMessageMap: Record<EScheduleAction, string> = {
  [EScheduleAction.start]: 'schedule_started_successfully',
  [EScheduleAction.pause]: 'schedule_paused_successfully',
  [EScheduleAction.cancel]: 'schedule_canceled_successfully',
};

export const updateScheduleAction = async (
  request: FastifyRequest<{
    Params: UpdateScheduleActionParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const scheduleActionUpdaterUseCase = container.resolve(
    ScheduleActionUpdaterUseCase
  );
  const { t, tokenJwtData } = request;
  const { schedule_id: scheduleId, action } = request.params;

  try {
    const response = await scheduleActionUpdaterUseCase.execute(
      t,
      scheduleId,
      action,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t(actionMessageMap[action]),
        httpStatusCode: EHTTPStatusCode.ok,
        data: null,
      });
    }

    return sendResponse(reply, {
      message: t('schedule_action_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
