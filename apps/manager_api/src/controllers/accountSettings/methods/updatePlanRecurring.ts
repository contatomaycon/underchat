import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
