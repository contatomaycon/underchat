import { injectable } from 'tsyringe';
import { createWorker } from './methods/createWorker';
import { listWorker } from './methods/listWorker';
import { updateWorker } from './methods/updateWorker';
import { viewWorker } from './methods/viewWorker';
import { deleteWorker } from './methods/deleteWorker';
import { changeStatusConnection } from './methods/changeStatusConnection';
import { workerConnectionLogs } from './methods/workerConnectionLogs';
import { recreateWorker } from './methods/recreateWorker';
import { uploadProfileStatusPhotos } from './methods/uploadProfileStatusPhotos';
import { listProfileStatusPhotos } from './methods/listProfileStatusPhotos';
import { updateProfileStatusPhoto } from './methods/updateProfileStatusPhoto';
import { deleteProfileStatusPhoto } from './methods/deleteProfileStatusPhoto';

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
  public uploadProfileStatusPhotos = uploadProfileStatusPhotos;
  public listProfileStatusPhotos = listProfileStatusPhotos;
  public updateProfileStatusPhoto = updateProfileStatusPhoto;
  public deleteProfileStatusPhoto = deleteProfileStatusPhoto;
}

export default WorkerController;
