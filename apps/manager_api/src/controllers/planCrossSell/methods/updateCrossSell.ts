import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateCrossSellRequest,
  UpdateCrossSellParamsRequest,
} from '@core/schema/planCrossSell/updateCrossSell/request.schema';
import { CrossSellUpdaterUseCase } from '@core/useCases/planCrossSell/CrossSellUpdater.useCase';

export const updateCrossSell = async (
  request: FastifyRequest<{
    Params: UpdateCrossSellParamsRequest;
    Body: UpdateCrossSellRequest;
  }>,
  reply: FastifyReply
) => {
  const crossSellUpdaterUseCase = container.resolve(CrossSellUpdaterUseCase);
  const { t } = request;

  try {
    const response = await crossSellUpdaterUseCase.execute(
      t,
      request.params.plan_cross_sell_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('cross_sell_updated_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('cross_sell_update_failed'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
