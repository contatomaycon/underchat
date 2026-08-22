import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ReportConversationHistoryPdfGenerateConsume } from '@core/consumer/reportConversationHistory/ReportConversationHistoryPdfGenerate.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startReportConversationHistoryPdfGenerateConsume(
  server: FastifyInstance
): ReportConversationHistoryPdfGenerateConsume {
  const reportConversationHistoryPdfGenerateConsume = container.resolve(
    ReportConversationHistoryPdfGenerateConsume
  );

  return launchServiceApiConsumerStartup(
    reportConversationHistoryPdfGenerateConsume,
    () => reportConversationHistoryPdfGenerateConsume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting report conversation history pdf generate consume'
      )
  );
}
