import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
