import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { DownloadReportSatisfactionPdfRequest } from '@core/schema/reportSatisfaction/downloadReportSatisfactionPdf/request.schema';
import { ReportSatisfactionListerUseCase } from './ReportSatisfactionLister.useCase';
import { ReportSatisfactionPdfService } from '@core/services/reportSatisfactionPdf.service';

@injectable()
export class ReportSatisfactionPdfGeneratorUseCase {
  constructor(
    @inject(ReportSatisfactionListerUseCase)
    private readonly reportSatisfactionListerUseCase: ReportSatisfactionListerUseCase,
    @inject(ReportSatisfactionPdfService)
    private readonly reportSatisfactionPdfService: ReportSatisfactionPdfService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    query: DownloadReportSatisfactionPdfRequest
  ): Promise<Buffer> {
    const response = await this.reportSatisfactionListerUseCase.execute(
      accountId,
      query
    );

    return this.reportSatisfactionPdfService.generatePdf(
      t,
      response.summary,
      response.results,
      query.report_type,
      query.period,
      query.start_date,
      query.end_date
    );
  }
}
