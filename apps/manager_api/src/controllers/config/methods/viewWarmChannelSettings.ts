import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WarmChannelSettingsViewerUseCase } from '@core/useCases/config/WarmChannelSettingsViewer.useCase';

export const viewWarmChannelSettings = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const warmChannelSettingsViewerUseCase = container.resolve(
    WarmChannelSettingsViewerUseCase
  );
  const { t } = request;

  try {
    const response = await warmChannelSettingsViewerUseCase.execute();

    return sendResponse(reply, {
      message: t('warm_channel_settings_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
