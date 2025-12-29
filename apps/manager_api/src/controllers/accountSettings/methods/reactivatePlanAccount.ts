import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PlanAccountReactivatorUseCase } from '@core/useCases/accountSettings/PlanAccountReactivator.useCase';

export const reactivatePlanAccount = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const planAccountReactivatorUseCase = container.resolve(
    PlanAccountReactivatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const message = await planAccountReactivatorUseCase.execute(
      t,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message,
      httpStatusCode: EHTTPStatusCode.ok,
      data: { message },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
