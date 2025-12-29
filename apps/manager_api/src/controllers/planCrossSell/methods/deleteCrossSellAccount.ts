import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
