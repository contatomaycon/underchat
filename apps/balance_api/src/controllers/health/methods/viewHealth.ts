import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { getWorkerContainerAdmissionStatus } from '@core/common/functions/workerContainerAdmission';
import { WorkerImageReconcilerService } from '@core/services/workerImageReconciler.service';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const viewHealth = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const { t } = request;
  const workerImages = container
    .resolve(WorkerImageReconcilerService)
    .getStatus();

  return sendResponse(reply, {
    httpStatusCode: EHTTPStatusCode.ok,
    message: t('health_check_success'),
    data: {
      worker_container_admission: getWorkerContainerAdmissionStatus(),
      worker_images: workerImages,
    },
  });
};
