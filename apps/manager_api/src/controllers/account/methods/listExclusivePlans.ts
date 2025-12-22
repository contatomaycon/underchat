import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
    console.error(error);

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
