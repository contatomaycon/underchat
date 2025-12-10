import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
    const message = await planAccountCancellerUseCase.execute(
      t,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message,
      httpStatusCode: EHTTPStatusCode.ok,
    });
  } catch (error) {
    console.error(error);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
