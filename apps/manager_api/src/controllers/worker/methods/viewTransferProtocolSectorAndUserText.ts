import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewTransferProtocolSectorAndUserTextUseCase } from '@core/useCases/worker/ViewTransferProtocolSectorAndUserText.useCase';
import { ViewTransferProtocolSectorAndUserTextParams } from '@core/schema/worker/viewTransferProtocolSectorAndUserText/request.schema';

export const viewTransferProtocolSectorAndUserText = async (
  request: FastifyRequest<{
    Params: ViewTransferProtocolSectorAndUserTextParams;
  }>,
  reply: FastifyReply
) => {
  const viewTransferProtocolSectorAndUserTextUseCase = container.resolve(
    ViewTransferProtocolSectorAndUserTextUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await viewTransferProtocolSectorAndUserTextUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('transfer_protocol_text_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
