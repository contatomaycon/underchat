import { injectable } from 'tsyringe';
import { createWorker } from './methods/createWorker';
import { listWorker } from './methods/listWorker';

@injectable()
class WorkerController {
  public createWorker = createWorker;
  public listWorker = listWorker;
}

export default WorkerController;
