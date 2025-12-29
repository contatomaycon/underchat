import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateSimultaneousAttendanceUseCase } from '@core/useCases/worker/UpdateSimultaneousAttendance.useCase';
import {
  UpdateSimultaneousAttendanceRequest,
  UpdateSimultaneousAttendanceParams,
} from '@core/schema/worker/updateSimultaneousAttendance/request.schema';

export const updateSimultaneousAttendance = async (
  request: FastifyRequest<{
    Params: UpdateSimultaneousAttendanceParams;
    Body: UpdateSimultaneousAttendanceRequest;
  }>,
  reply: FastifyReply
) => {
  const updateSimultaneousAttendanceUseCase = container.resolve(
    UpdateSimultaneousAttendanceUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await updateSimultaneousAttendanceUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('simultaneous_attendance_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
