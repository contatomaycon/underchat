import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { canOperateOnOtherAccounts } from '@core/common/functions/hasFullAccess';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateAttendanceHoursRequest,
  UpdateAttendanceHoursRequestParams,
} from '@core/schema/user/updateAttendanceHours/request.schema';
import { UserAttendanceHoursUpdaterUseCase } from '@core/useCases/user/UserAttendanceHoursUpdater.useCase';

export const updateAttendanceHours = async (
  request: FastifyRequest<{
    Params: UpdateAttendanceHoursRequestParams;
    Body: UpdateAttendanceHoursRequest;
  }>,
  reply: FastifyReply
) => {
  const userAttendanceHoursUpdaterUseCase = container.resolve(
    UserAttendanceHoursUpdaterUseCase
  );
  const { t, tokenJwtData } = request;
  const canOperateOnOthers = canOperateOnOtherAccounts(tokenJwtData.actions);

  try {
    const response = await userAttendanceHoursUpdaterUseCase.execute(
      t,
      request.params.user_id,
      tokenJwtData.account_id,
      canOperateOnOthers,
      request.body
    );

    return sendResponse(reply, {
      message: t('user_attendance_hours_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
