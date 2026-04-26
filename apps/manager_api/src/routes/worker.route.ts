import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import WorkerController from '@/controllers/worker';
import { listWorkerSchema } from '@core/schema/worker/listWorker';
import { listWorkerServersSchema } from '@core/schema/worker/listWorkerServers';
import {
  workerCreatePermissions,
  workerDeletePermissions,
  workerEditPermissions,
  workerLogsConnectionPermissions,
  workerRecreatePermissions,
  workerViewPermissions,
  workerProfileStatusPermissions,
  workerProfileInfoPermissions,
  workerServersListPermissions,
} from '@/permissions';
import { createWorkerSchema } from '@core/schema/worker/createWorker';
import { editWorkerSchema } from '@core/schema/worker/editWorker';
import { viewWorkerSchema } from '@core/schema/worker/viewWorker';
import { deleteWorkerSchema } from '@core/schema/worker/deleteWorker';
import { statusConnectionWorkerSchema } from '@core/schema/worker/statusConnection';
import { workerConnectionLogsSchema } from '@core/schema/worker/workerConnectionLogs';
import { recreateWorkerSchema } from '@core/schema/worker/recreateWorker';
import { resetWorkerConnectionSchema } from '@core/schema/worker/resetWorkerConnection';
import { uploadProfileStatusSchema } from '@core/schema/worker/uploadProfileStatus';
import { listProfileStatusSchema } from '@core/schema/worker/listProfileStatus';
import { updateProfileStatusSchema } from '@core/schema/worker/updateProfileStatus';
import { deleteProfileStatusSchema } from '@core/schema/worker/deleteProfileStatus';
import { uploadProfileInfoSchema } from '@core/schema/worker/uploadProfileInfo';
import { viewProfileInfoSchema } from '@core/schema/worker/viewProfileInfo';
import { viewWorkerConfigSchema } from '@core/schema/worker/viewWorkerConfig';
import { updateWorkerConfigSchema } from '@core/schema/worker/updateWorkerConfig';
import { updateTransferProtocolTextSchema } from '@core/schema/worker/updateTransferProtocolText';
import { viewTransferProtocolTextSchema } from '@core/schema/worker/viewTransferProtocolText';
import { updateTransferProtocolSectorTextSchema } from '@core/schema/worker/updateTransferProtocolSectorText';
import { viewTransferProtocolSectorTextSchema } from '@core/schema/worker/viewTransferProtocolSectorText';
import { updateTransferProtocolSectorAndUserTextSchema } from '@core/schema/worker/updateTransferProtocolSectorAndUserText';
import { viewTransferProtocolSectorAndUserTextSchema } from '@core/schema/worker/viewTransferProtocolSectorAndUserText';
import { updateStartProtocolTextSchema } from '@core/schema/worker/updateStartProtocolText';
import { viewStartProtocolTextSchema } from '@core/schema/worker/viewStartProtocolText';
import { updateSimultaneousAttendanceSchema } from '@core/schema/worker/updateSimultaneousAttendance';
import { viewSimultaneousAttendanceSchema } from '@core/schema/worker/viewSimultaneousAttendance';
import { updateShowMessageOnCallSchema } from '@core/schema/worker/updateShowMessageOnCall';
import { viewShowMessageOnCallSchema } from '@core/schema/worker/viewShowMessageOnCall';
import { updateSendMessageOnFinishAttendanceSchema } from '@core/schema/worker/updateSendMessageOnFinishAttendance';
import { viewSendMessageOnFinishAttendanceSchema } from '@core/schema/worker/viewSendMessageOnFinishAttendance';
import { updateChatbotSchema } from '@core/schema/worker/updateChatbot';
import { viewChatbotSchema } from '@core/schema/worker/viewChatbot';
import { viewAiAgentConfigSchema } from '@core/schema/worker/viewAiAgentConfig';
import { updateAiAgentConfigSchema } from '@core/schema/worker/updateAiAgentConfig';
import { viewAttendanceHoursSchema } from '@core/schema/worker/viewAttendanceHours';
import { updateAttendanceHoursSchema } from '@core/schema/worker/updateAttendanceHours';
import { viewAttendanceInactivityAlertSchema } from '@core/schema/worker/viewAttendanceInactivityAlert';
import { updateAttendanceInactivityAlertSchema } from '@core/schema/worker/updateAttendanceInactivityAlert';
import { checkWorkerOpenConversationsSchema } from '@core/schema/worker/checkWorkerOpenConversations';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default function workerRoutes(server: FastifyInstance) {
  const workerController = container.resolve(WorkerController);

  server.post('/worker', {
    schema: createWorkerSchema,
    handler: workerController.createWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerCreatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/worker/:worker_id', {
    schema: recreateWorkerSchema,
    handler: workerController.recreateWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerRecreatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/worker/:worker_id/connection/reset', {
    schema: resetWorkerConnectionSchema,
    handler: workerController.resetWorkerConnection,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerRecreatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker', {
    schema: listWorkerSchema,
    handler: workerController.listWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/servers', {
    schema: listWorkerServersSchema,
    handler: workerController.listWorkerServers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerServersListPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id', {
    schema: viewWorkerSchema,
    handler: workerController.viewWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/worker/:worker_id/:name', {
    schema: editWorkerSchema,
    handler: workerController.updateWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/open-conversations', {
    schema: checkWorkerOpenConversationsSchema,
    handler: workerController.checkWorkerOpenConversations,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerDeletePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/worker/:worker_id', {
    schema: deleteWorkerSchema,
    handler: workerController.deleteWorker,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerDeletePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/worker/whatsapp/unofficial', {
    schema: statusConnectionWorkerSchema,
    handler: workerController.changeStatusConnection,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerCreatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/worker/:worker_id/profile/status', {
    schema: uploadProfileStatusSchema,
    handler: workerController.uploadProfileStatus,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerProfileStatusPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/profile/status', {
    schema: listProfileStatusSchema,
    handler: workerController.listProfileStatus,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerProfileStatusPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/worker/profile/status/:worker_profile_status_id', {
    schema: updateProfileStatusSchema,
    handler: workerController.updateProfileStatus,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerProfileStatusPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/worker/profile/status/:worker_profile_status_id', {
    schema: deleteProfileStatusSchema,
    handler: workerController.deleteProfileStatus,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerProfileStatusPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/logs/connection/:worker_id', {
    schema: workerConnectionLogsSchema,
    handler: workerController.workerConnectionLogs,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerLogsConnectionPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/worker/:worker_id/profile/info', {
    schema: uploadProfileInfoSchema,
    handler: workerController.uploadProfileInfo,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerProfileInfoPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/profile/info', {
    schema: viewProfileInfoSchema,
    handler: workerController.viewProfileInfo,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerProfileInfoPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/config', {
    schema: viewWorkerConfigSchema,
    handler: workerController.viewWorkerConfig,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/worker/:worker_id/config', {
    schema: updateWorkerConfigSchema,
    handler: workerController.updateWorkerConfig,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/config/transfer-protocol', {
    schema: viewTransferProtocolTextSchema,
    handler: workerController.viewTransferProtocolText,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/worker/:worker_id/config/transfer-protocol', {
    schema: updateTransferProtocolTextSchema,
    handler: workerController.updateTransferProtocolText,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/config/transfer-protocol-sector', {
    schema: viewTransferProtocolSectorTextSchema,
    handler: workerController.viewTransferProtocolSectorText,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/worker/:worker_id/config/transfer-protocol-sector', {
    schema: updateTransferProtocolSectorTextSchema,
    handler: workerController.updateTransferProtocolSectorText,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/config/transfer-protocol-sector-and-user', {
    schema: viewTransferProtocolSectorAndUserTextSchema,
    handler: workerController.viewTransferProtocolSectorAndUserText,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/worker/:worker_id/config/transfer-protocol-sector-and-user', {
    schema: updateTransferProtocolSectorAndUserTextSchema,
    handler: workerController.updateTransferProtocolSectorAndUserText,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/config/start-protocol', {
    schema: viewStartProtocolTextSchema,
    handler: workerController.viewStartProtocolText,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/worker/:worker_id/config/start-protocol', {
    schema: updateStartProtocolTextSchema,
    handler: workerController.updateStartProtocolText,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/config/simultaneous-attendance', {
    schema: viewSimultaneousAttendanceSchema,
    handler: workerController.viewSimultaneousAttendance,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/worker/:worker_id/config/simultaneous-attendance', {
    schema: updateSimultaneousAttendanceSchema,
    handler: workerController.updateSimultaneousAttendance,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/config/show-message-on-call', {
    schema: viewShowMessageOnCallSchema,
    handler: workerController.viewShowMessageOnCall,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/worker/:worker_id/config/show-message-on-call', {
    schema: updateShowMessageOnCallSchema,
    handler: workerController.updateShowMessageOnCall,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/config/send-message-on-finish-attendance', {
    schema: viewSendMessageOnFinishAttendanceSchema,
    handler: workerController.viewSendMessageOnFinishAttendance,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/worker/:worker_id/config/send-message-on-finish-attendance', {
    schema: updateSendMessageOnFinishAttendanceSchema,
    handler: workerController.updateSendMessageOnFinishAttendance,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/config/attendance-hours', {
    schema: viewAttendanceHoursSchema,
    handler: workerController.viewAttendanceHours,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/worker/:worker_id/config/attendance-hours', {
    schema: updateAttendanceHoursSchema,
    handler: workerController.updateAttendanceHours,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/config/attendance-inactivity-alert', {
    schema: viewAttendanceInactivityAlertSchema,
    handler: workerController.viewAttendanceInactivityAlert,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/worker/:worker_id/config/attendance-inactivity-alert', {
    schema: updateAttendanceInactivityAlertSchema,
    handler: workerController.updateAttendanceInactivityAlert,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/config/chatbot', {
    schema: viewChatbotSchema,
    handler: workerController.viewChatbot,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/worker/:worker_id/config/chatbot', {
    schema: updateChatbotSchema,
    handler: workerController.updateChatbot,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/worker/:worker_id/config/ai-agent', {
    schema: viewAiAgentConfigSchema,
    handler: workerController.viewAiAgentConfig,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/worker/:worker_id/config/ai-agent', {
    schema: updateAiAgentConfigSchema,
    handler: workerController.updateAiAgentConfig,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, workerEditPermissions),
      planGuard,
      planStatus,
    ],
  });
}
