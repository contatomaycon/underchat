import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import ConfigController from '@/controllers/config';
import { listNotificationsSchema } from '@core/schema/notifications/listNotifications';
import { updateNotificationsSchema } from '@core/schema/notifications/updateNotifications';
import { listWorkersSchema } from '@core/schema/notifications/listWorkers';
import { listSentNotificationsSchema } from '@core/schema/notifications/listSentNotifications';
import { listNfseSchema } from '@core/schema/config/listNfse';
import { updateNfseSchema } from '@core/schema/config/updateNfse';
import { updateNfseIntegrationSchema } from '@core/schema/config/updateNfseIntegration';
import { uploadNfseCertificateSchema } from '@core/schema/config/uploadNfseCertificate';
import { listChannelsSchema } from '@core/schema/config/listChannels';
import { listAccountsSchema } from '@core/schema/config/listAccounts';
import { listChannelServersSchema } from '@core/schema/config/listChannelServers';
import { recreateChannelSchema } from '@core/schema/config/recreateChannel';
import { deleteChannelSchema } from '@core/schema/config/deleteChannel';
import { recreateChannelsAllSchema } from '@core/schema/config/recreateChannelsAll';
import { channelsStatisticsSchema } from '@core/schema/config/channelsStatistics';
import { listCreditCardFeeSchema } from '@core/schema/config/listCreditCardFee';
import { updateCreditCardFeeSchema } from '@core/schema/config/updateCreditCardFee';
import { checkChannelOpenConversationsSchema } from '@core/schema/config/checkChannelOpenConversations';
import { listMethodPaymentsSchema } from '@core/schema/config/listMethodPayments';
import { updateMethodPaymentSchema } from '@core/schema/config/updateMethodPayment';
import { updateChannelSchema } from '@core/schema/config/updateChannel';
import { listS3BackupUploadsSchema } from '@core/schema/config/listS3BackupUploads';
import { reprocessS3BackupUploadSchema } from '@core/schema/config/reprocessS3BackupUpload';
import { listWarmChannelsSchema } from '@core/schema/config/listWarmChannels';
import { listWarmChannelServersSchema } from '@core/schema/config/listWarmChannelServers';
import { recreateWarmChannelsAllSchema } from '@core/schema/config/recreateWarmChannelsAll';
import { viewWarmChannelSettingsSchema } from '@core/schema/config/viewWarmChannelSettings';
import { updateWarmChannelSettingsSchema } from '@core/schema/config/updateWarmChannelSettings';
import { viewWhatsappEmbeddedConfigSchema } from '@core/schema/config/viewWhatsappEmbeddedConfig';
import { updateWhatsappEmbeddedConfigSchema } from '@core/schema/config/updateWhatsappEmbeddedConfig';
import {
  listDownloadArtifactsSchema,
  updateDownloadArtifactsSchema,
} from '@core/schema/config/downloadArtifacts';
import { configPermissions } from '@/permissions';
import {
  createSessionStorageMigrationSchema,
  deleteLegacyMigrationVolumeSchema,
  latestSessionStorageMigrationSchema,
} from '@core/schema/config/sessionStorageMigration';
import { configChannelConnectionHealthSchema } from '@core/schema/config/channelConnectionHealth';

export default async function configRoutes(server: FastifyInstance) {
  const configController = container.resolve(ConfigController);

  server.get('/config/notifications', {
    schema: listNotificationsSchema,
    handler: configController.listNotifications,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.patch('/config/notifications', {
    schema: updateNotificationsSchema,
    handler: configController.updateNotifications,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/notifications/workers', {
    schema: listWorkersSchema,
    handler: configController.listWorkers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/notifications/sent', {
    schema: listSentNotificationsSchema,
    handler: configController.listSentNotifications,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/nfse', {
    schema: listNfseSchema,
    handler: configController.listNfse,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.patch('/config/nfse', {
    schema: updateNfseSchema,
    handler: configController.updateNfse,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.patch('/config/nfse/integration', {
    schema: updateNfseIntegrationSchema,
    handler: configController.updateNfseIntegration,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.post('/config/nfse/certificate', {
    schema: uploadNfseCertificateSchema,
    handler: configController.uploadNfseCertificate,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/credit-card-fee', {
    schema: listCreditCardFeeSchema,
    handler: configController.listCreditCardFee,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.patch('/config/credit-card-fee', {
    schema: updateCreditCardFeeSchema,
    handler: configController.updateCreditCardFee,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/method-payments', {
    schema: listMethodPaymentsSchema,
    handler: configController.listMethodPayments,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.patch('/config/method-payment', {
    schema: updateMethodPaymentSchema,
    handler: configController.updateMethodPayment,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/whatsapp-embedded', {
    schema: viewWhatsappEmbeddedConfigSchema,
    handler: configController.viewWhatsappEmbeddedConfig,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.patch('/config/whatsapp-embedded', {
    schema: updateWhatsappEmbeddedConfigSchema,
    handler: configController.updateWhatsappEmbeddedConfig,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/download-artifacts', {
    schema: listDownloadArtifactsSchema,
    handler: configController.listDownloadArtifacts,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.patch('/config/download-artifacts', {
    schema: updateDownloadArtifactsSchema,
    handler: configController.updateDownloadArtifacts,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/warm-channels', {
    schema: listWarmChannelsSchema,
    handler: configController.listWarmChannels,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/warm-channels/servers', {
    schema: listWarmChannelServersSchema,
    handler: configController.listWarmChannelServers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/warm-channels/settings', {
    schema: viewWarmChannelSettingsSchema,
    handler: configController.viewWarmChannelSettings,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.patch('/config/warm-channels/settings', {
    schema: updateWarmChannelSettingsSchema,
    handler: configController.updateWarmChannelSettings,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.patch('/config/warm-channels/recreate-all', {
    schema: recreateWarmChannelsAllSchema,
    handler: configController.recreateWarmChannelsAll,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/channels', {
    schema: listChannelsSchema,
    handler: configController.listChannels,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/channels/:channel_id/health', {
    schema: configChannelConnectionHealthSchema,
    handler: configController.channelConnectionHealth,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/accounts', {
    schema: listAccountsSchema,
    handler: configController.listAccounts,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/channels/servers', {
    schema: listChannelServersSchema,
    handler: configController.listChannelServers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.patch('/config/channels/:channel_id/recreate', {
    schema: recreateChannelSchema,
    handler: configController.recreateChannel,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.post('/config/channels/:channel_id/session-storage-migrations', {
    schema: createSessionStorageMigrationSchema,
    handler: configController.createSessionStorageMigration,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/channels/:channel_id/session-storage-migrations/latest', {
    schema: latestSessionStorageMigrationSchema,
    handler: configController.latestSessionStorageMigration,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.delete(
    '/config/channels/:channel_id/session-storage-migrations/:migration_id/legacy-volume',
    {
      schema: deleteLegacyMigrationVolumeSchema,
      handler: configController.deleteLegacyMigrationVolume,
      preHandler: [
        (request, reply) =>
          server.authenticateJwt(request, reply, configPermissions),
      ],
    }
  );

  server.get('/config/channels/:channel_id/open-conversations', {
    schema: checkChannelOpenConversationsSchema,
    handler: configController.checkChannelOpenConversations,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.delete('/config/channels/:channel_id', {
    schema: deleteChannelSchema,
    handler: configController.deleteChannel,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.patch('/config/channels/recreate-all', {
    schema: recreateChannelsAllSchema,
    handler: configController.recreateChannelsAll,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.patch('/config/channels/:channel_id', {
    schema: updateChannelSchema,
    handler: configController.updateChannel,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/channels/statistics', {
    schema: channelsStatisticsSchema,
    handler: configController.channelsStatistics,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/s3-backups', {
    schema: listS3BackupUploadsSchema,
    handler: configController.listS3BackupUploads,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.patch('/config/s3-backups/:s3_backup_upload_id/reprocess', {
    schema: reprocessS3BackupUploadSchema,
    handler: configController.reprocessS3BackupUpload,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });
}
