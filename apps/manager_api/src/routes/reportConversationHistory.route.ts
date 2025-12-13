import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { reportConversationHistoryViewPermissions } from '@/permissions/reportConversationHistory.permissions';
import ReportConversationHistoryController from '@/controllers/reportConversationHistory';
import { listReportConversationHistorySchema } from '@core/schema/reportConversationHistory/listReportConversationHistory';
import { listReportConversationHistoryMessagesSchema } from '@core/schema/reportConversationHistory/listReportConversationHistoryMessages';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default function reportConversationHistoryRoutes(
  server: FastifyInstance
) {
  const reportConversationHistoryController = container.resolve(
    ReportConversationHistoryController
  );

  server.get('/report-conversation-history', {
    schema: listReportConversationHistorySchema,
    handler: reportConversationHistoryController.listReportConversationHistory,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(
          request,
          reply,
          reportConversationHistoryViewPermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.get('/report-conversation-history/:chat_id/messages', {
    schema: listReportConversationHistoryMessagesSchema,
    handler:
      reportConversationHistoryController.listReportConversationHistoryMessages,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(
          request,
          reply,
          reportConversationHistoryViewPermissions
        ),
      planGuard,
      planStatus,
    ],
  });
}
