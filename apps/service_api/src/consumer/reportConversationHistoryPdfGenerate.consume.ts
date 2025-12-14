import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { ReportConversationHistoryPdfGenerateConsume } from '@core/consumer/reportConversationHistory/ReportConversationHistoryPdfGenerate.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const reportConversationHistoryPdfGenerateConsume = container.resolve(
      ReportConversationHistoryPdfGenerateConsume
    );

    reportConversationHistoryPdfGenerateConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await reportConversationHistoryPdfGenerateConsume.close();
    });
  },
  { name: 'report-conversation-history-pdf-generate-consume' }
);
