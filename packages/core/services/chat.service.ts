import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { chatMappings } from '@core/mappings/chat.mappings';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { v4 as uuidv4 } from 'uuid';

@injectable()
export class ChatService {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  saveChat = async () => {
    const mappings = chatMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.wpp_connection,
      mappings
    );

    /* if (!result || !wppLog) {
      return false;
    }

    return this.elasticDatabaseService.bulkUpdate(
      EElasticIndex.install_server,
      documents,
      () => uuidv4()
    ); */
  };
}
