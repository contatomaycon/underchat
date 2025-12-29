import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateTransferProtocolTextUseCase } from '@core/useCases/worker/UpdateTransferProtocolText.useCase';
import {
  UpdateTransferProtocolTextRequest,
  UpdateTransferProtocolTextParams,
} from '@core/schema/worker/updateTransferProtocolText/request.schema';

export const updateTransferProtocolText = async (
  request: FastifyRequest<{
    Params: UpdateTransferProtocolTextParams;
    Body: UpdateTransferProtocolTextRequest;
  }>,
  reply: FastifyReply
) => {
  const updateTransferProtocolTextUseCase = container.resolve(
    UpdateTransferProtocolTextUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await updateTransferProtocolTextUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('transfer_protocol_text_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
