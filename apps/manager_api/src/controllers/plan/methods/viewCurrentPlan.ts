import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PlanCurrentViewerUseCase } from '@core/useCases/plan/PlanCurrentViewer.useCase';

export const viewCurrentPlan = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const planCurrentViewerUseCase = container.resolve(PlanCurrentViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await planCurrentViewerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('current_plan_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
