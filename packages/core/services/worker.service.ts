import { injectable } from 'tsyringe';
import Docker from 'dockerode';
import { TFunction } from 'i18next';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';

@injectable()
export class WorkerService {
  private docker: Docker;

  constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  public async existsWorkerById(workerId: string): Promise<boolean> {
    try {
      const container = this.docker.getContainer(workerId);
      await container.inspect();

      return true;
    } catch {
      return false;
    }
  }

  public async removeWorkerById(
    workerId: string,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    try {
      const container = this.docker.getContainer(workerId);

      await container.remove({ force: true });
    } catch {
      throw new Error(t('worker_removal_failed'));
    }
  }

  public async createWorker(
    t: TFunction<'translation', undefined>,
    imageName: EWorkerImage,
    containerName: string
  ): Promise<string> {
    const existsWorkerById = await this.existsWorkerById(containerName);

    if (existsWorkerById) {
      await this.removeWorkerById(containerName, t);
    }

    const container = await this.docker.createContainer({
      Image: imageName,
      name: containerName,
    });

    await container.start();

    return container.id;
  }
}
