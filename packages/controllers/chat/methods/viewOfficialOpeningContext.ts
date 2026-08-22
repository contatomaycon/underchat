import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { OfficialOpeningContextRequest } from '@core/schema/chat/officialOpeningContext/request.schema';
import { OfficialOpeningContextViewerUseCase } from '@core/useCases/chat/OfficialOpeningContextViewer.useCase';
import { handleChatMutationControllerError } from './handleChatMutationControllerError';

export const viewOfficialOpeningContext = async (
  request: FastifyRequest<{
    Querystring: OfficialOpeningContextRequest;
  }>,
  reply: FastifyReply
) => {
  const officialOpeningContextViewerUseCase = container.resolve(
    OfficialOpeningContextViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await officialOpeningContextViewerUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.query,
      tokenJwtData.channels
    );

    return sendResponse(reply, {
      message: t('official_opening_context_loaded_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleChatMutationControllerError(error, reply, t, {
      sanitizeUnexpected: true,
    });
  }
};
