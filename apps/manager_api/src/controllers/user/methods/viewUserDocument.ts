import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewUserDocumentRequest } from '@core/schema/user/viewUserDocument/request.schema';
import { UserDocumentViewerUseCase } from '@core/useCases/user/UserDocumentViewer.useCase';

export const viewUserDocument = async (
  request: FastifyRequest<{
    Params: ViewUserDocumentRequest;
  }>,
  reply: FastifyReply
) => {
  const userDocumentViewerUseCase = container.resolve(
    UserDocumentViewerUseCase
  );
  const { t } = request;

  try {
    const response = await userDocumentViewerUseCase.execute(
      t,
      request.params.user_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_document_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('user_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
