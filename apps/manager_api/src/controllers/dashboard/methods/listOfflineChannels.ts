import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DashboardOfflineChannelsListerUseCase } from '@core/useCases/dashboard/DashboardOfflineChannelsLister.useCase';

export const listOfflineChannels = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const dashboardOfflineChannelsListerUseCase = container.resolve(
    DashboardOfflineChannelsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await dashboardOfflineChannelsListerUseCase.execute(
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('dashboard_offline_channels_loaded_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('dashboard_offline_channels_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
