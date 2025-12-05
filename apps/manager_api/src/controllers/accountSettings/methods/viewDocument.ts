import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountSettingsDocumentViewerUseCase } from '@core/useCases/accountSettings/AccountSettingsDocumentViewer.useCase';

export const viewDocument = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const accountSettingsDocumentViewerUseCase = container.resolve(
    AccountSettingsDocumentViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountSettingsDocumentViewerUseCase.execute(
      t,
      tokenJwtData.user_id
    );

    return sendResponse(reply, {
      message: t('user_document_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
