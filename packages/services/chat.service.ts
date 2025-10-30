import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { mensageMappings } from '@core/mappings/mensage.mappings';
import { IChat } from '@core/common/interfaces/IChat';
import { chatMappings } from '@core/mappings/chat.mappings';

@injectable()
export class ChatService {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  saveMessageChat = async (messageChat: IChatMessage): Promise<boolean> => {
    const mappings = mensageMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.message,
      mappings
    );

    if (!result || !messageChat) {
      return false;
    }

    return this.elasticDatabaseService.update(
      EElasticIndex.message,
      messageChat,
      messageChat.message_id
    );
  };

  saveChat = async (chat: IChat): Promise<boolean> => {
    const mappings = chatMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.chat,
      mappings
    );

    if (!result || !chat) {
      return false;
    }

    return this.elasticDatabaseService.update(
      EElasticIndex.chat,
      chat,
      chat.chat_id
    );
  };
}
