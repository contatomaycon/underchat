import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewTypingSimulationUseCase } from '@core/useCases/worker/ViewTypingSimulation.useCase';
import { ViewTypingSimulationParams } from '@core/schema/worker/viewTypingSimulation/request.schema';

export const viewTypingSimulation = async (
  request: FastifyRequest<{
    Params: ViewTypingSimulationParams;
  }>,
  reply: FastifyReply
) => {
  const viewTypingSimulationUseCase = container.resolve(
    ViewTypingSimulationUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await viewTypingSimulationUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('typing_simulation_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
