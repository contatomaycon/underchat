import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteCrossSellRequest } from '@core/schema/planCrossSell/deleteCrossSell/request.schema';
import { CrossSellDeleterUseCase } from '@core/useCases/planCrossSell/CrossSellDeleter.useCase';

export const deleteCrossSell = async (
  request: FastifyRequest<{
    Params: DeleteCrossSellRequest;
  }>,
  reply: FastifyReply
) => {
  const crossSellDeleterUseCase = container.resolve(CrossSellDeleterUseCase);
  const { t } = request;

  try {
    const response = await crossSellDeleterUseCase.execute(
      t,
      request.params.plan_cross_sell_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('cross_sell_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('cross_sell_delete_failed'),
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
