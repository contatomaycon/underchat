import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WarmChannelSettingsUpdaterUseCase } from '@core/useCases/config/WarmChannelSettingsUpdater.useCase';
import { UpdateWarmChannelSettingsRequest } from '@core/schema/config/updateWarmChannelSettings/request.schema';

export const updateWarmChannelSettings = async (
  request: FastifyRequest<{
    Body: UpdateWarmChannelSettingsRequest;
  }>,
  reply: FastifyReply
) => {
  const warmChannelSettingsUpdaterUseCase = container.resolve(
    WarmChannelSettingsUpdaterUseCase
  );
  const { t } = request;

  try {
    const response = await warmChannelSettingsUpdaterUseCase.execute(
      request.body
    );

    return sendResponse(reply, {
      message: t('warm_channel_settings_update_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
