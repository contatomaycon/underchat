import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateCrossSellAccountRequest } from '@core/schema/planCrossSell/createCrossSellAccount/request.schema';
import { CrossSellAccountCreatorUseCase } from '@core/useCases/planCrossSell/CrossSellAccountCreator.useCase';

export const createCrossSellAccount = async (
  request: FastifyRequest<{
    Body: CreateCrossSellAccountRequest;
  }>,
  reply: FastifyReply
) => {
  const crossSellAccountCreatorUseCase = container.resolve(
    CrossSellAccountCreatorUseCase
  );
  const { t } = request;

  try {
    const response = await crossSellAccountCreatorUseCase.execute(
      t,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('cross_sell_account_created_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: null,
      });
    }

    return sendResponse(reply, {
      message: t('cross_sell_account_creation_failed'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
