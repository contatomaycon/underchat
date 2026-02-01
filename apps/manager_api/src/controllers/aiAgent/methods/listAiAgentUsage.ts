import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListAiAgentUsageRequestParams } from '@core/schema/aiAgent/listAiAgentUsage/request.schema';
import { AiAgentUsageListerUseCase } from '@core/useCases/aiAgent/AiAgentUsageLister.useCase';

export const listAiAgentUsage = async (
  request: FastifyRequest<{
    Params: ListAiAgentUsageRequestParams;
    Querystring: { current_page?: number; per_page?: number };
  }>,
  reply: FastifyReply
) => {
  const aiAgentUsageListerUseCase = container.resolve(
    AiAgentUsageListerUseCase
  );
  const { t, tokenJwtData } = request;
  const currentPage = request.query.current_page ?? 1;
  const perPage = request.query.per_page ?? 10;

  try {
    const response = await aiAgentUsageListerUseCase.execute(
      t,
      request.params.ai_agent_id,
      tokenJwtData.account_id,
      currentPage,
      perPage
    );

    return sendResponse(reply, {
      message: t('ai_agent_usage_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
