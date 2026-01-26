import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { IntegrationViewerUseCase } from '@core/useCases/integration/IntegrationViewer.useCase';

export const viewIntegration = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const integrationViewerUseCase = container.resolve(IntegrationViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await integrationViewerUseCase.execute(
      t,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('integration_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
