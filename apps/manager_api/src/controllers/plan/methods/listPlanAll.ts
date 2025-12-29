import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PlanAllListerUseCase } from '@core/useCases/plan/PlanAllLister.useCase';

export const listPlanAll = async (
  request: FastifyRequest<{}>,
  reply: FastifyReply
) => {
  const planAllListerUseCase = container.resolve(PlanAllListerUseCase);
  const { t } = request;

  try {
    const response = await planAllListerUseCase.execute();

    if (response) {
      return sendResponse(reply, {
        message: t('plan_list_all_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('plan_list_all_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
