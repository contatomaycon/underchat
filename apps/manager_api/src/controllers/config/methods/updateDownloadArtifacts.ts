import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { UpdateDownloadArtifactsRequest } from '@core/schema/config/downloadArtifacts/request.schema';
import { DownloadArtifactsUpdaterUseCase } from '@core/useCases/config/DownloadArtifactsUpdater.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const updateDownloadArtifacts = async (
  request: FastifyRequest<{ Body: UpdateDownloadArtifactsRequest }>,
  reply: FastifyReply
) => {
  const { t } = request;

  try {
    const downloadArtifactsUpdaterUseCase = container.resolve(
      DownloadArtifactsUpdaterUseCase
    );
    const response = await downloadArtifactsUpdaterUseCase.execute(
      t,
      request.body
    );

    return sendResponse(reply, {
      message: t('download_artifacts_update_successfully'),
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
