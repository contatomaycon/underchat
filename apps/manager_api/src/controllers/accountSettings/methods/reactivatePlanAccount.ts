import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
