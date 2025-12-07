import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpgradeDiscountCalculatorUseCase } from '@core/useCases/plan/UpgradeDiscountCalculator.useCase';
import { CalculateUpgradeDiscountRequest } from '@core/schema/plan/calculateUpgradeDiscount/request.schema';

export const calculateUpgradeDiscount = async (
  request: FastifyRequest<{ Querystring: CalculateUpgradeDiscountRequest }>,
  reply: FastifyReply
) => {
  const upgradeDiscountCalculatorUseCase = container.resolve(
    UpgradeDiscountCalculatorUseCase
  );
  const { t, tokenJwtData } = request;
  const { plan_id, billing_period } = request.query;

  if (!plan_id) {
    return sendResponse(reply, {
      message: t('plan_id_required'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  }

  try {
    const response = await upgradeDiscountCalculatorUseCase.execute(
      tokenJwtData.account_id,
      plan_id,
      billing_period
    );

    return sendResponse(reply, {
      message: t('upgrade_discount_calculated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
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
