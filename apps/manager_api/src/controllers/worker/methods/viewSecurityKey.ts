import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewSecurityKeyUseCase } from '@core/useCases/worker/ViewSecurityKey.useCase';
import { ViewSecurityKeyParams } from '@core/schema/worker/viewSecurityKey/request.schema';

export const viewSecurityKey = async (
  request: FastifyRequest<{
    Params: ViewSecurityKeyParams;
  }>,
  reply: FastifyReply
) => {
  const viewSecurityKeyUseCase = container.resolve(ViewSecurityKeyUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await viewSecurityKeyUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('security_key_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
