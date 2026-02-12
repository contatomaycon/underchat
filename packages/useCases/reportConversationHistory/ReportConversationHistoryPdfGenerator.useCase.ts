import { injectable, inject } from 'tsyringe';
import { ReportConversationHistoryPdfUpserterRepository } from '@core/repositories/reportConversationHistory/ReportConversationHistoryPdfUpserter.repository';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { GenerateReportConversationHistoryPdfResponse } from '@core/schema/reportConversationHistory/generateReportConversationHistoryPdf/response.schema';

@injectable()
export class ReportConversationHistoryPdfGeneratorUseCase {
  constructor(
    @inject(ReportConversationHistoryPdfUpserterRepository)
    private readonly pdfUpserterRepository: ReportConversationHistoryPdfUpserterRepository,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  async execute(
    accountId: string,
    chatId: string,
    language: string
  ): Promise<GenerateReportConversationHistoryPdfResponse> {
    const pdfRecord = await this.pdfUpserterRepository.upsertPdf(
      accountId,
      chatId
    );

    const payload = {
      account_id: accountId,
      chat_id: chatId,
      pdf_record_id: pdfRecord.id,
      requested_at: new Date().toISOString(),
      old_url_pdf: pdfRecord.oldUrlPdf,
      language,
    };

    const topic =
      this.kafkaServiceQueueService.reportConversationHistoryPdfGenerate();

    await this.streamProducerService.send(topic, payload);

    return {
      pdf_id: pdfRecord.id,
      status: pdfRecord.status,
    };
  }
}
