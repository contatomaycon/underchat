import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateAiAgentConfigUseCase } from '@core/useCases/worker/UpdateAiAgentConfig.useCase';
import {
  UpdateAiAgentConfigRequest,
  UpdateAiAgentConfigParams,
} from '@core/schema/worker/updateAiAgentConfig/request.schema';

export const updateAiAgentConfig = async (
  request: FastifyRequest<{
    Params: UpdateAiAgentConfigParams;
    Body: UpdateAiAgentConfigRequest;
  }>,
  reply: FastifyReply
) => {
  const updateAiAgentConfigUseCase = container.resolve(
    UpdateAiAgentConfigUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await updateAiAgentConfigUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('ai_agent_config_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
