import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CrossSellAccountListerUseCase } from '@core/useCases/planCrossSell/CrossSellAccountLister.useCase';
import { ListCrossSellAccountRequest } from '@core/schema/planCrossSell/listCrossSellAccount/request.schema';

export const listCrossSellAccount = async (
  request: FastifyRequest<{
    Params: ListCrossSellAccountRequest;
  }>,
  reply: FastifyReply
) => {
  const crossSellAccountListerUseCase = container.resolve(
    CrossSellAccountListerUseCase
  );
  const { t } = request;

  try {
    const response = await crossSellAccountListerUseCase.execute(
      t,
      request.params.plan_cross_sell_id
    );

    return sendResponse(reply, {
      message: t('cross_sell_account_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
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
