import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewContactGroupRequest } from '@core/schema/contactGroup/viewContactGroup/request.schema';
import { ContactGroupViewerUseCase } from '@core/useCases/contactGroup/ContactGroupViewer.useCase';

export const viewContactGroup = async (
  request: FastifyRequest<{
    Params: ViewContactGroupRequest;
  }>,
  reply: FastifyReply
) => {
  const contactGroupViewerUseCase = container.resolve(
    ContactGroupViewerUseCase
  );
  const { t } = request;

  try {
    const response = await contactGroupViewerUseCase.execute(
      t,
      request.params.contact_group_id,
      request.tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_group_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('contact_group_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
