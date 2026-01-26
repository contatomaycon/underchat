import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { IntegrationInputChatbotsListerUseCase } from '@core/useCases/integration/IntegrationInputChatbotsLister.useCase';

export const listInputChatbots = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const integrationInputChatbotsListerUseCase = container.resolve(
    IntegrationInputChatbotsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const result = await integrationInputChatbotsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('input_chatbots_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: result,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
