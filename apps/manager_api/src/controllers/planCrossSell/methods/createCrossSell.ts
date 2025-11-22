import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateCrossSellRequest } from '@core/schema/planCrossSell/createCrossSell/request.schema';
import { CrossSellCreatorUseCase } from '@core/useCases/planCrossSell/CrossSellCreator.useCase';

export const createCrossSell = async (
  request: FastifyRequest<{
    Body: CreateCrossSellRequest;
  }>,
  reply: FastifyReply
) => {
  const crossSellCreatorUseCase = container.resolve(CrossSellCreatorUseCase);
  const { t } = request;

  try {
    const response = await crossSellCreatorUseCase.execute(t, request.body);

    if (response) {
      return sendResponse(reply, {
        message: t('cross_sell_created_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: null,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('cross_sell_creation_failed'),
      httpStatusCode: EHTTPStatusCode.bad_request,
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
