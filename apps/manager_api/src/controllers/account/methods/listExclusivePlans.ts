import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ExclusivePlansListerUseCase } from '@core/useCases/planAccountExclusive/ExclusivePlansLister.useCase';
import { ListExclusivePlansRequest } from '@core/schema/planAccountExclusive/listExclusivePlans/request.schema';

export const listExclusivePlans = async (
  request: FastifyRequest<{
    Params: ListExclusivePlansRequest;
  }>,
  reply: FastifyReply
) => {
  const exclusivePlansListerUseCase = container.resolve(
    ExclusivePlansListerUseCase
  );
  const { t } = request;

  try {
    const response = await exclusivePlansListerUseCase.execute(
      t,
      request.params.account_id
    );

    return sendResponse(reply, {
      message: t('exclusive_plans_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
