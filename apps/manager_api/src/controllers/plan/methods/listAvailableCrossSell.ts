import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CrossSellAvailableListerUseCase } from '@core/useCases/plan/CrossSellAvailableLister.useCase';
import { ListAvailableCrossSellRequest } from '@core/schema/plan/listAvailableCrossSell/request.schema';

export const listAvailableCrossSell = async (
  request: FastifyRequest<{ Querystring: ListAvailableCrossSellRequest }>,
  reply: FastifyReply
) => {
  const crossSellAvailableListerUseCase = container.resolve(
    CrossSellAvailableListerUseCase
  );
  const { t } = request;

  try {
    const response = await crossSellAvailableListerUseCase.execute(
      request.tokenJwtData.account_id,
      request.query
    );

    return sendResponse(reply, {
      message: t('cross_sell_available_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
