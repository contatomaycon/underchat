import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateLabelTemplateRequest } from '@core/schema/labelTemplate/createLabelTemplate/request.schema';
import { LabelTemplateCreatorUseCase } from '@core/useCases/labelTemplate/LabelTemplateCreator.useCase';

export const createLabelTemplate = async (
  request: FastifyRequest<{
    Body: CreateLabelTemplateRequest;
  }>,
  reply: FastifyReply
) => {
  const labelTemplateCreatorUseCase = container.resolve(
    LabelTemplateCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await labelTemplateCreatorUseCase.execute(
      t,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('label_template_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('label_template_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
