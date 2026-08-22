import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  EditLabelTemplateParamsRequest,
  UpdateLabelTemplateRequest,
} from '@core/schema/labelTemplate/editLabelTemplate/request.schema';
import { LabelTemplateUpdaterUseCase } from '@core/useCases/labelTemplate/LabelTemplateUpdater.useCase';

export const editLabelTemplate = async (
  request: FastifyRequest<{
    Params: EditLabelTemplateParamsRequest;
    Body: UpdateLabelTemplateRequest;
  }>,
  reply: FastifyReply
) => {
  const labelTemplateUpdaterUseCase = container.resolve(
    LabelTemplateUpdaterUseCase
  );
  const { t } = request;

  try {
    const response = await labelTemplateUpdaterUseCase.execute(
      t,
      request.params.label_template_id,
      request.body,
      request.tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('label_template_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('label_template_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
