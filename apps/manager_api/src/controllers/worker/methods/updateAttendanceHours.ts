import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateAttendanceHoursUseCase } from '@core/useCases/worker/UpdateAttendanceHours.useCase';
import {
  UpdateAttendanceHoursParams,
  UpdateAttendanceHoursRequest,
} from '@core/schema/worker/updateAttendanceHours/request.schema';

export const updateAttendanceHours = async (
  request: FastifyRequest<{
    Params: UpdateAttendanceHoursParams;
    Body: UpdateAttendanceHoursRequest;
  }>,
  reply: FastifyReply
) => {
  const updateAttendanceHoursUseCase = container.resolve(
    UpdateAttendanceHoursUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await updateAttendanceHoursUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('attendance_hours_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
