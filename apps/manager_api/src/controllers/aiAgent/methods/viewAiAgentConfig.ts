import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewAiAgentConfigUseCase } from '@core/useCases/aiAgent/ViewAiAgentConfig.useCase';

export const viewAiAgentConfig = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const viewAiAgentConfigUseCase = container.resolve(ViewAiAgentConfigUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await viewAiAgentConfigUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('worker_config_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
