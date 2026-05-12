import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateSecurityKeyUseCase } from '@core/useCases/worker/UpdateSecurityKey.useCase';
import {
  UpdateSecurityKeyParams,
  UpdateSecurityKeyRequest,
} from '@core/schema/worker/updateSecurityKey/request.schema';

export const updateSecurityKey = async (
  request: FastifyRequest<{
    Params: UpdateSecurityKeyParams;
    Body: UpdateSecurityKeyRequest;
  }>,
  reply: FastifyReply
) => {
  const updateSecurityKeyUseCase = container.resolve(UpdateSecurityKeyUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await updateSecurityKeyUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('security_key_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
