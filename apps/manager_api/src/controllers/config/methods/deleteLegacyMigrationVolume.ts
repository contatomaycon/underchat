import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { SessionStorageMigrationParams } from '@core/schema/config/sessionStorageMigration/request.schema';
import { SessionStorageMigrationService } from '@core/services/sessionStorageMigration.service';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const deleteLegacyMigrationVolume = async (
  request: FastifyRequest<{ Params: SessionStorageMigrationParams }>,
  reply: FastifyReply
) => {
  const service = container.resolve(SessionStorageMigrationService);
  const { t } = request;
  try {
    const migration = await service.deleteLegacyVolume(
      request.params.channel_id,
      request.params.migration_id
    );
    return sendResponse(reply, {
      message: t('session_storage_migration_volume_deleted'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: migration,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
