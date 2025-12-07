import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
    console.error(error);

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
