import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdatePlanAccountParamsRequest,
  UpdatePlanAccountRequest,
} from '@core/schema/planAccount/updatePlanAccount/request.schema';
import { PlanAccountUpdaterUseCase } from '@core/useCases/planAccount/PlanAccountUpdater.useCase';

export const updatePlanAccount = async (
  request: FastifyRequest<{
    Params: UpdatePlanAccountParamsRequest;
    Body: UpdatePlanAccountRequest;
  }>,
  reply: FastifyReply
) => {
  const planAccountUpdaterUseCase = container.resolve(
    PlanAccountUpdaterUseCase
  );
  const { t } = request;

  try {
    const response = await planAccountUpdaterUseCase.execute(
      t,
      request.params.account_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('plan_account_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('plan_account_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
