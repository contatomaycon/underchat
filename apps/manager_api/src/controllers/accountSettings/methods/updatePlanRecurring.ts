import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PlanRecurringUpdaterUseCase } from '@core/useCases/accountSettings/PlanRecurringUpdater.useCase';
import { UpdatePlanRecurringRequest } from '@core/schema/accountSettings/updatePlanRecurring/request.schema';

export const updatePlanRecurring = async (
  request: FastifyRequest<{ Body: UpdatePlanRecurringRequest }>,
  reply: FastifyReply
) => {
  const planRecurringUpdaterUseCase = container.resolve(
    PlanRecurringUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    await planRecurringUpdaterUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('plan_recurring_updated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
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
