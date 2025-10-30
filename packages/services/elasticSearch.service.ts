import { Client } from '@elastic/elasticsearch';
import { inject, injectable } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';
import { ELogLevel } from '@core/common/enums/ELogLevel';

@injectable()
class ElasticSearchService {
  constructor(@inject('ElasticLogsClient') private readonly client: Client) {}

  createDynamicLogStream = async () => {
    return {
      write: async (message: string) => {
        const logObject = JSON.parse(message);

        await this.sendLog(logObject);
      },
    };
  };

  sendLog = async (message: any) => {
    const index = this.determineIndex(message.level);
    const logString = JSON.stringify(message);

    await this.client.index({
      index,
      id: uuidv4(),
      body: {
        level: message.level,
        time: message.time,
        pid: message.pid,
        hostname: message.hostname,
        requestId: message.requestId,
        log: logString,
      },
    });
  };

  private readonly determineIndex = (level: number): ELogLevel => {
    if (level === 60) {
      return ELogLevel.fatal;
    }

    if (level === 50) {
      return ELogLevel.error;
    }

    if (level === 40) {
      return ELogLevel.warn;
    }

    if (level === 30) {
      return ELogLevel.info;
    }

    if (level === 20) {
      return ELogLevel.debug;
    }

    if (level === 10) {
      return ELogLevel.trace;
    }

    return ELogLevel.other;
  };
}

export default ElasticSearchService;
