import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ReportConversationHistoryPdfGenerateConsume } from '@core/consumer/reportConversationHistory/ReportConversationHistoryPdfGenerate.consume';

export function startReportConversationHistoryPdfGenerateConsume(
  server: FastifyInstance
): ReportConversationHistoryPdfGenerateConsume {
  const reportConversationHistoryPdfGenerateConsume = container.resolve(
    ReportConversationHistoryPdfGenerateConsume
  );

  reportConversationHistoryPdfGenerateConsume
    .execute()
    .catch((error: unknown) => {
      server.log.error(
        { err: error },
        'Error starting report conversation history pdf generate consume'
      );
    });

  return reportConversationHistoryPdfGenerateConsume;
}
