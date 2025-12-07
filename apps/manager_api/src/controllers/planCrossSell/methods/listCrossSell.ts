import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListCrossSellRequest } from '@core/schema/planCrossSell/listCrossSell/request.schema';
import { CrossSellListerUseCase } from '@core/useCases/planCrossSell/CrossSellLister.useCase';

export const listCrossSell = async (
  request: FastifyRequest<{
    Querystring: ListCrossSellRequest;
  }>,
  reply: FastifyReply
) => {
  const crossSellListerUseCase = container.resolve(CrossSellListerUseCase);
  const { t } = request;

  try {
    const response = await crossSellListerUseCase.execute(t, request.query);

    if (response) {
      return sendResponse(reply, {
        message: t('cross_sell_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('cross_sell_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    console.error(error);

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
