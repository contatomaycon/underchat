import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewTransferProtocolTextUseCase } from '@core/useCases/worker/ViewTransferProtocolText.useCase';
import { ViewTransferProtocolTextParams } from '@core/schema/worker/viewTransferProtocolText/request.schema';

export const viewTransferProtocolText = async (
  request: FastifyRequest<{
    Params: ViewTransferProtocolTextParams;
  }>,
  reply: FastifyReply
) => {
  const viewTransferProtocolTextUseCase = container.resolve(
    ViewTransferProtocolTextUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await viewTransferProtocolTextUseCase.execute(
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
