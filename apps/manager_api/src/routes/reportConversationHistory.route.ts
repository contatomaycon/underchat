import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { reportConversationHistoryViewPermissions } from '@/permissions/reportConversationHistory.permissions';
import { contactViewPhonePermissions } from '@/permissions/contact.permissions';
import ReportConversationHistoryController from '@/controllers/reportConversationHistory';
import { listReportConversationHistorySchema } from '@core/schema/reportConversationHistory/listReportConversationHistory';
import { listReportConversationHistoryMessagesSchema } from '@core/schema/reportConversationHistory/listReportConversationHistoryMessages';
import { listReportConversationHistorySectorsSchema } from '@core/schema/reportConversationHistory/listReportConversationHistorySectors';
import { listReportConversationHistoryUsersSchema } from '@core/schema/reportConversationHistory/listReportConversationHistoryUsers';
import { viewReportConversationHistoryContactSchema } from '@core/schema/reportConversationHistory/viewReportConversationHistoryContact';
import { viewReportConversationHistoryContactEmailSchema } from '@core/schema/reportConversationHistory/viewReportConversationHistoryContactEmail';
import { viewReportConversationHistoryContactPhoneSchema } from '@core/schema/reportConversationHistory/viewReportConversationHistoryContactPhone';
import { generateReportConversationHistoryPdfSchema } from '@core/schema/reportConversationHistory/generateReportConversationHistoryPdf';
import { viewReportConversationHistoryPdfSchema } from '@core/schema/reportConversationHistory/viewReportConversationHistoryPdf';
import { downloadReportConversationHistoryPdfSchema } from '@core/schema/reportConversationHistory/downloadReportConversationHistoryPdf';
import { deleteReportConversationHistoryPdfSchema } from '@core/schema/reportConversationHistory/deleteReportConversationHistoryPdf';
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

  server.get('/report-conversation-history/sectors', {
    schema: listReportConversationHistorySectorsSchema,
    handler:
      reportConversationHistoryController.listReportConversationHistorySectors,
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

  server.get('/report-conversation-history/users', {
    schema: listReportConversationHistoryUsersSchema,
    handler:
      reportConversationHistoryController.listReportConversationHistoryUsers,
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

  server.get('/report-conversation-history/contacts/:contact_id', {
    schema: viewReportConversationHistoryContactSchema,
    handler: reportConversationHistoryController.viewContact,
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

  server.get('/report-conversation-history/contacts/:contact_id/email', {
    schema: viewReportConversationHistoryContactEmailSchema,
    handler: reportConversationHistoryController.viewContactEmail,
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

  server.get('/report-conversation-history/contacts/:contact_id/phone', {
    schema: viewReportConversationHistoryContactPhoneSchema,
    handler: reportConversationHistoryController.viewContactPhone,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(
          request,
          reply,
          reportConversationHistoryViewPermissions
        ),
      (request, reply) =>
        server.authenticateJwt(request, reply, contactViewPhonePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/report-conversation-history/:chat_id/pdf', {
    schema: generateReportConversationHistoryPdfSchema,
    handler:
      reportConversationHistoryController.generateReportConversationHistoryPdf,
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

  server.get('/report-conversation-history/:chat_id/pdf', {
    schema: viewReportConversationHistoryPdfSchema,
    handler:
      reportConversationHistoryController.viewReportConversationHistoryPdf,
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

  server.get('/report-conversation-history/:chat_id/pdf/download', {
    schema: downloadReportConversationHistoryPdfSchema,
    handler:
      reportConversationHistoryController.downloadReportConversationHistoryPdf,
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

  server.delete('/report-conversation-history/:chat_id/pdf', {
    schema: deleteReportConversationHistoryPdfSchema,
    handler:
      reportConversationHistoryController.deleteReportConversationHistoryPdf,
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
