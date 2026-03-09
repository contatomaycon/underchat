import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DashboardChannelsStatusListerUseCase } from '@core/useCases/dashboard/DashboardChannelsStatusLister.useCase';

export const listChannelsStatus = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const dashboardChannelsStatusListerUseCase = container.resolve(
    DashboardChannelsStatusListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await dashboardChannelsStatusListerUseCase.execute(
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('channels_status_loaded_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('channels_status_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
