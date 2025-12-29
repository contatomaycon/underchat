import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { setPlanActiveHeader } from '@core/common/functions/setPlanActiveHeader';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PlanAccountCancellerUseCase } from '@core/useCases/accountSettings/PlanAccountCanceller.useCase';

export const cancelPlanAccount = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const planAccountCancellerUseCase = container.resolve(
    PlanAccountCancellerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const message = await planAccountCancellerUseCase.execute(t, tokenJwtData);

    setPlanActiveHeader(reply, tokenJwtData.plan_is_active === true);

    return sendResponse(reply, {
      message,
      httpStatusCode: EHTTPStatusCode.ok,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
