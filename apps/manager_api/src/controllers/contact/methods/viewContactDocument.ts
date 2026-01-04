import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ContactDocumentViewerUseCase } from '@core/useCases/contact/ContactDocumentViewer.useCase';
import { ViewContactDocumentParams } from '@core/schema/contact/viewContactDocument/request.schema';

export const viewContactDocument = async (
  request: FastifyRequest<{
    Params: ViewContactDocumentParams;
  }>,
  reply: FastifyReply
) => {
  const contactDocumentViewerUseCase = container.resolve(
    ContactDocumentViewerUseCase
  );
  const { t } = request;

  try {
    const response = await contactDocumentViewerUseCase.execute(
      t,
      request.params.contact_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_document_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('contact_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
