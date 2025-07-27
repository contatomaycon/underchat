import { injectable } from 'tsyringe';
import { createWorker } from './methods/createWorker';
import { listWorker } from './methods/listWorker';
import { updateWorker } from './methods/updateWorker';

@injectable()
class WorkerController {
  public createWorker = createWorker;
  public listWorker = listWorker;
  public updateWorker = updateWorker;
}

export default WorkerController;
