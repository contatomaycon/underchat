import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { SessionStorageMigrationChannelParams } from '@core/schema/config/sessionStorageMigration/request.schema';
import { SessionStorageMigrationService } from '@core/services/sessionStorageMigration.service';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const latestSessionStorageMigration = async (
  request: FastifyRequest<{ Params: SessionStorageMigrationChannelParams }>,
  reply: FastifyReply
) => {
  const service = container.resolve(SessionStorageMigrationService);
  const { t } = request;
  try {
    const migration = await service.latest(request.params.channel_id);
    return sendResponse(reply, {
      message: t('session_storage_migration_viewed'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: migration,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
