import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChannelsStatisticsUseCase } from '@core/useCases/config/ChannelsStatistics.useCase';

export const channelsStatistics = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const channelsStatisticsUseCase = container.resolve(
    ChannelsStatisticsUseCase
  );
  const { t } = request;

  try {
    const response = await channelsStatisticsUseCase.execute();

    return sendResponse(reply, {
      message: t('channels_statistics_success'),
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
