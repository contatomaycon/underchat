import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { LabelTemplateAllListerUseCase } from '@core/useCases/labelTemplate/LabelTemplateAllLister.useCase';

export const listLabelTemplateAll = async (
  request: FastifyRequest<{}>,
  reply: FastifyReply
) => {
  const labelTemplateAllListUseCase = container.resolve(
    LabelTemplateAllListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await labelTemplateAllListUseCase.execute(
      t,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('label_template_all_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
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
