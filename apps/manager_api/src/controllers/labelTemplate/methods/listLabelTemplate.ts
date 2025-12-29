import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListLabelTemplateRequest } from '@core/schema/labelTemplate/listLabelTemplate/request.schema';
import { LabelTemplateListerUseCase } from '@core/useCases/labelTemplate/LabelTemplateLister.useCase';

export const listLabelTemplate = async (
  request: FastifyRequest<{
    Querystring: ListLabelTemplateRequest;
  }>,
  reply: FastifyReply
) => {
  const labelTemplateListerUseCase = container.resolve(
    LabelTemplateListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await labelTemplateListerUseCase.execute(
      request.query,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('label_template_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('label_template_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
