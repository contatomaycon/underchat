import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
      tokenJwtData.account_id,
      tokenJwtData.is_administrator
    );

    return sendResponse(reply, {
      message: t('contact_export_successfully'),
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
