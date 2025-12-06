import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CrossSellAvailableListerUseCase } from '@core/useCases/plan/CrossSellAvailableLister.useCase';

export const listAvailableCrossSell = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const crossSellAvailableListerUseCase = container.resolve(
    CrossSellAvailableListerUseCase
  );
  const { t } = request;

  try {
    const response = await crossSellAvailableListerUseCase.execute();

    return sendResponse(reply, {
      message: t('cross_sell_available_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
