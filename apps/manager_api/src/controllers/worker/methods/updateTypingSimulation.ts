import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateTypingSimulationUseCase } from '@core/useCases/worker/UpdateTypingSimulation.useCase';
import {
  UpdateTypingSimulationParams,
  UpdateTypingSimulationRequest,
} from '@core/schema/worker/updateTypingSimulation/request.schema';

export const updateTypingSimulation = async (
  request: FastifyRequest<{
    Params: UpdateTypingSimulationParams;
    Body: UpdateTypingSimulationRequest;
  }>,
  reply: FastifyReply
) => {
  const updateTypingSimulationUseCase = container.resolve(
    UpdateTypingSimulationUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await updateTypingSimulationUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('typing_simulation_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
