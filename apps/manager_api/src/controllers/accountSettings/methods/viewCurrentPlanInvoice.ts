import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PlanCurrentInvoiceViewerUseCase } from '@core/useCases/plan/PlanCurrentInvoiceViewer.useCase';

export const viewCurrentPlanInvoice = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const planCurrentInvoiceViewerUseCase = container.resolve(
    PlanCurrentInvoiceViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await planCurrentInvoiceViewerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('current_plan_invoice_view_successfully'),
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
