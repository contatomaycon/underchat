import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CrossSellAccountDeleterUseCase } from '@core/useCases/planCrossSell/CrossSellAccountDeleter.useCase';

export const deleteCrossSellAccount = async (
  request: FastifyRequest<{
    Params: { plan_cross_sell_account_id: string };
  }>,
  reply: FastifyReply
) => {
  const crossSellAccountDeleterUseCase = container.resolve(
    CrossSellAccountDeleterUseCase
  );
  const { t } = request;

  try {
    await crossSellAccountDeleterUseCase.execute(
      t,
      request.params.plan_cross_sell_account_id
    );

    return sendResponse(reply, {
      message: t('cross_sell_account_deleted_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: null,
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
