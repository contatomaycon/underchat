import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { DownloadArtifactsViewerUseCase } from '@core/useCases/config/DownloadArtifactsViewer.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const listDownloadArtifacts = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const { t } = request;

  try {
    const downloadArtifactsViewerUseCase = container.resolve(
      DownloadArtifactsViewerUseCase
    );
    const response = await downloadArtifactsViewerUseCase.execute();

    return sendResponse(reply, {
      message: t('download_artifacts_view_successfully'),
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
