import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ContactExporterUseCase } from '@core/useCases/contact/ContactExporter.useCase';

export const exportContact = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const contactExporterUseCase = container.resolve(ContactExporterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await contactExporterUseCase.execute(
      t,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('contact_export_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
