import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewTransferProtocolSectorTextUseCase } from '@core/useCases/worker/ViewTransferProtocolSectorText.useCase';
import { ViewTransferProtocolSectorTextParams } from '@core/schema/worker/viewTransferProtocolSectorText/request.schema';

export const viewTransferProtocolSectorText = async (
  request: FastifyRequest<{
    Params: ViewTransferProtocolSectorTextParams;
  }>,
  reply: FastifyReply
) => {
  const viewTransferProtocolSectorTextUseCase = container.resolve(
    ViewTransferProtocolSectorTextUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await viewTransferProtocolSectorTextUseCase.execute(
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
