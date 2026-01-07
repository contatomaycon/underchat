import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateTransferProtocolSectorTextUseCase } from '@core/useCases/worker/UpdateTransferProtocolSectorText.useCase';
import {
  UpdateTransferProtocolSectorTextRequest,
  UpdateTransferProtocolSectorTextParams,
} from '@core/schema/worker/updateTransferProtocolSectorText/request.schema';

export const updateTransferProtocolSectorText = async (
  request: FastifyRequest<{
    Params: UpdateTransferProtocolSectorTextParams;
    Body: UpdateTransferProtocolSectorTextRequest;
  }>,
  reply: FastifyReply
) => {
  const updateTransferProtocolSectorTextUseCase = container.resolve(
    UpdateTransferProtocolSectorTextUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await updateTransferProtocolSectorTextUseCase.execute(
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
