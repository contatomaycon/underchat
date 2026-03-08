import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewAiAgentConfigUseCase } from '@core/useCases/worker/ViewAiAgentConfig.useCase';
import { ViewAiAgentConfigParams } from '@core/schema/worker/viewAiAgentConfig/request.schema';

export const viewAiAgentConfig = async (
  request: FastifyRequest<{
    Params: ViewAiAgentConfigParams;
  }>,
  reply: FastifyReply
) => {
  const viewAiAgentConfigUseCase = container.resolve(ViewAiAgentConfigUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await viewAiAgentConfigUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('ai_agent_config_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
