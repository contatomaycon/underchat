import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
