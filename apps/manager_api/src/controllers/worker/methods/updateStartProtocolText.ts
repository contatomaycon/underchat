import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateStartProtocolTextUseCase } from '@core/useCases/worker/UpdateStartProtocolText.useCase';
import {
  UpdateStartProtocolTextRequest,
  UpdateStartProtocolTextParams,
} from '@core/schema/worker/updateStartProtocolText/request.schema';

export const updateStartProtocolText = async (
  request: FastifyRequest<{
    Params: UpdateStartProtocolTextParams;
    Body: UpdateStartProtocolTextRequest;
  }>,
  reply: FastifyReply
) => {
  const updateStartProtocolTextUseCase = container.resolve(
    UpdateStartProtocolTextUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await updateStartProtocolTextUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('start_protocol_text_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
