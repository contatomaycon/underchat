import { EServerBuildJobStatus } from '@core/common/enums/EServerBuildJobStatus';
import { ICancelServerBuildResult } from '@core/common/interfaces/ICancelServerBuildResult';
import { ICreateServerBuildJobResult } from '@core/common/interfaces/ICreateServerBuildJobResult';
import { IDeleteServerBuildResult } from '@core/common/interfaces/IDeleteServerBuildResult';
import { IHarborBuildVersionByType } from '@core/common/interfaces/IHarborBuildVersionByType';
import { IMarkServerBuildItemSuccessInput } from '@core/common/interfaces/IMarkServerBuildItemSuccessInput';
import { IServerBuildDefaultImages } from '@core/common/interfaces/IServerBuildDefaultImages';
import { IServerBuildJobWithItems } from '@core/common/interfaces/IServerBuildJobWithItems';
import { ServerBuildRepository } from '@core/repositories/server/ServerBuild.repository';
import { ServerBuildDefaultResponse } from '@core/schema/server/setServerBuildDefault/response.schema';
import { ServerBuildViewResponse } from '@core/schema/server/viewServerBuild/response.schema';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ServerBuildService {
  constructor(
    @inject(ServerBuildRepository)
    private readonly serverBuildRepository: ServerBuildRepository
  ) {}

  private generateVersion(): string {
    const date = new Date();
    const yyyy = String(date.getUTCFullYear());
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const min = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');

    return `v${yyyy}${mm}${dd}${hh}${min}${ss}${ms}`;
  }

  listBuilds = async (): Promise<ServerBuildViewResponse> => {
    return this.serverBuildRepository.listBuilds();
  };

  createBuildJob = async (
    requestedBy: string,
    buildTypes: EServerBuildType[],
    version?: string
  ): Promise<ICreateServerBuildJobResult> => {
    const buildVersion = version ?? this.generateVersion();
    return this.serverBuildRepository.createBuildJob(
      requestedBy,
      buildVersion,
      buildTypes,
      Boolean(version)
    );
  };

  getBuildJobById = async (
    serverBuildJobId: string
  ): Promise<IServerBuildJobWithItems | null> => {
    return this.serverBuildRepository.getBuildJobById(serverBuildJobId);
  };

  requestCancelForActiveJob =
    async (): Promise<ICancelServerBuildResult | null> => {
      return this.serverBuildRepository.requestCancelForActiveJob();
    };

  rollbackCancelRequest = async (
    serverBuildJobId: string,
    previousStatus: EServerBuildJobStatus
  ): Promise<void> => {
    await this.serverBuildRepository.rollbackCancelRequest(
      serverBuildJobId,
      previousStatus
    );
  };

  markJobRunning = async (serverBuildJobId: string): Promise<boolean> => {
    return this.serverBuildRepository.markJobRunning(serverBuildJobId);
  };

  claimJobItemForExecution = async (
    serverBuildJobId: string,
    buildType: EServerBuildType
  ): Promise<string | null> => {
    return this.serverBuildRepository.claimJobItemForExecution(
      serverBuildJobId,
      buildType
    );
  };

  isCancelRequested = async (serverBuildJobId: string): Promise<boolean> => {
    return this.serverBuildRepository.isCancelRequested(serverBuildJobId);
  };

  cancelJobIfNotRunning = async (serverBuildJobId: string): Promise<void> => {
    await this.serverBuildRepository.cancelJobIfNotRunning(serverBuildJobId);
  };

  markJobItemRunning = async (
    serverBuildJobId: string,
    buildType: EServerBuildType
  ): Promise<void> => {
    await this.serverBuildRepository.markJobItemRunning(
      serverBuildJobId,
      buildType
    );
  };

  touchRunningJobItem = async (
    serverBuildJobId: string,
    buildType: EServerBuildType
  ): Promise<void> => {
    await this.serverBuildRepository.touchRunningJobItem(
      serverBuildJobId,
      buildType
    );
  };

  failStaleRunningItems = async (
    staleTimeoutMs: number,
    errorMessage: string
  ): Promise<string[]> => {
    return this.serverBuildRepository.failStaleRunningItems(
      staleTimeoutMs,
      errorMessage
    );
  };

  markJobItemFailed = async (
    serverBuildJobId: string,
    buildType: EServerBuildType,
    errorMessage: string
  ): Promise<void> => {
    await this.serverBuildRepository.markJobItemFailed(
      serverBuildJobId,
      buildType,
      errorMessage
    );
  };

  markJobItemCanceled = async (
    serverBuildJobId: string,
    buildType: EServerBuildType,
    errorMessage: string | null = null
  ): Promise<void> => {
    await this.serverBuildRepository.markJobItemCanceled(
      serverBuildJobId,
      buildType,
      errorMessage
    );
  };

  markJobItemSuccessAndPersistVersion = async (
    input: IMarkServerBuildItemSuccessInput
  ): Promise<void> => {
    await this.serverBuildRepository.markJobItemSuccessAndPersistVersion(input);
  };

  retryFailedJobItem = async (
    serverBuildJobId: string,
    buildType: EServerBuildType
  ): Promise<string | null> => {
    return this.serverBuildRepository.retryFailedJobItem(
      serverBuildJobId,
      buildType
    );
  };

  syncJobStatusFromItems = async (
    serverBuildJobId: string
  ): Promise<EServerBuildJobStatus | null> => {
    return this.serverBuildRepository.syncJobStatusFromItems(serverBuildJobId);
  };

  markJobFailed = async (
    serverBuildJobId: string,
    errorMessage: string
  ): Promise<void> => {
    await this.serverBuildRepository.markJobFailed(
      serverBuildJobId,
      errorMessage
    );
  };

  markJobCompleted = async (serverBuildJobId: string): Promise<void> => {
    await this.serverBuildRepository.markJobCompleted(serverBuildJobId);
  };

  markJobCanceled = async (
    serverBuildJobId: string,
    errorMessage: string | null = null
  ): Promise<void> => {
    await this.serverBuildRepository.markJobCanceled(
      serverBuildJobId,
      errorMessage
    );
  };

  hasActiveBuildJob = async (): Promise<boolean> => {
    return this.serverBuildRepository.hasActiveBuildJob();
  };

  setDefaultVersion = async (
    serverBuildVersionId: string
  ): Promise<ServerBuildDefaultResponse | null> => {
    return this.serverBuildRepository.setDefaultVersion(serverBuildVersionId);
  };

  getBuildJobSummaryById = async (
    serverBuildJobId: string
  ): Promise<{
    server_build_job_id: string;
    version: string;
    status: EServerBuildJobStatus;
  } | null> => {
    return this.serverBuildRepository.getBuildJobSummaryById(serverBuildJobId);
  };

  isBuildVersionDefault = async (version: string): Promise<boolean> => {
    return this.serverBuildRepository.isBuildVersionDefault(version);
  };

  hardDeleteBuildByVersion = async (
    version: string
  ): Promise<IDeleteServerBuildResult> => {
    return this.serverBuildRepository.hardDeleteBuildByVersion(version);
  };

  pairBuildVersionFromHarbor = async (
    input: IHarborBuildVersionByType
  ): Promise<{
    imported: boolean;
    created_jobs: number;
    created_versions: number;
  }> => {
    return this.serverBuildRepository.pairBuildVersionFromHarbor(input);
  };

  getDefaultImages = async (): Promise<IServerBuildDefaultImages | null> => {
    return this.serverBuildRepository.getDefaultImages();
  };
}
