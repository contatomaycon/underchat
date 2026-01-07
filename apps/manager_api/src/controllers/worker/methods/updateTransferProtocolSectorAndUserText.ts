import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateTransferProtocolSectorAndUserTextUseCase } from '@core/useCases/worker/UpdateTransferProtocolSectorAndUserText.useCase';
import {
  UpdateTransferProtocolSectorAndUserTextRequest,
  UpdateTransferProtocolSectorAndUserTextParams,
} from '@core/schema/worker/updateTransferProtocolSectorAndUserText/request.schema';

export const updateTransferProtocolSectorAndUserText = async (
  request: FastifyRequest<{
    Params: UpdateTransferProtocolSectorAndUserTextParams;
    Body: UpdateTransferProtocolSectorAndUserTextRequest;
  }>,
  reply: FastifyReply
) => {
  const updateTransferProtocolSectorAndUserTextUseCase = container.resolve(
    UpdateTransferProtocolSectorAndUserTextUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response =
      await updateTransferProtocolSectorAndUserTextUseCase.execute(
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
