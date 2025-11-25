import { injectable } from 'tsyringe';
import { createWorker } from './methods/createWorker';
import { listWorker } from './methods/listWorker';
import { updateWorker } from './methods/updateWorker';
import { viewWorker } from './methods/viewWorker';
import { deleteWorker } from './methods/deleteWorker';
import { changeStatusConnection } from './methods/changeStatusConnection';
import { workerConnectionLogs } from './methods/workerConnectionLogs';
import { recreateWorker } from './methods/recreateWorker';
import { uploadProfileStatus } from './methods/uploadProfileStatus';
import { listProfileStatus } from './methods/listProfileStatus';
import { updateProfileStatus } from './methods/updateProfileStatus';
import { deleteProfileStatus } from './methods/deleteProfileStatus';
import { uploadProfileInfo } from './methods/uploadProfileInfo';
import { viewProfileInfo } from './methods/viewProfileInfo';
import { viewWorkerConfig } from './methods/viewWorkerConfig';
import { updateWorkerConfig } from './methods/updateWorkerConfig';
import { updateTransferProtocolText } from './methods/updateTransferProtocolText';
import { viewTransferProtocolText } from './methods/viewTransferProtocolText';
import { updateStartProtocolText } from './methods/updateStartProtocolText';
import { viewStartProtocolText } from './methods/viewStartProtocolText';

@injectable()
class WorkerController {
  public createWorker = createWorker;
  public listWorker = listWorker;
  public updateWorker = updateWorker;
  public viewWorker = viewWorker;
  public deleteWorker = deleteWorker;
  public changeStatusConnection = changeStatusConnection;
  public workerConnectionLogs = workerConnectionLogs;
  public recreateWorker = recreateWorker;
  public uploadProfileStatus = uploadProfileStatus;
  public listProfileStatus = listProfileStatus;
  public updateProfileStatus = updateProfileStatus;
  public deleteProfileStatus = deleteProfileStatus;
  public uploadProfileInfo = uploadProfileInfo;
  public viewProfileInfo = viewProfileInfo;
  public viewWorkerConfig = viewWorkerConfig;
  public updateWorkerConfig = updateWorkerConfig;
  public updateTransferProtocolText = updateTransferProtocolText;
  public viewTransferProtocolText = viewTransferProtocolText;
  public updateStartProtocolText = updateStartProtocolText;
  public viewStartProtocolText = viewStartProtocolText;
}

export default WorkerController;
