import 'reflect-metadata';
import { EChatbotType } from '@core/common/enums/EChatbotType';
import { ScheduleChatbotsListerRepository } from '@core/repositories/schedule/ScheduleChatbotsLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ScheduleChatbotsListerRepository', () => {
  it('listScheduleChatbots returns empty list when query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ScheduleChatbotsListerRepository(db as never);

    await expect(repository.listScheduleChatbots('acc-1')).resolves.toEqual([]);
  });

  it('listScheduleChatbots maps rows and keeps nullable type', async () => {
    const { db } = createSelectDbMock([
      {
        chatbot_id: 'cb-1',
        name: 'Scheduler',
        type: EChatbotType.schedule,
      },
      {
        chatbot_id: 'cb-2',
        name: 'Fallback',
        type: null,
      },
    ]);
    const repository = new ScheduleChatbotsListerRepository(db as never);

    await expect(repository.listScheduleChatbots('acc-1')).resolves.toEqual([
      {
        chatbot_id: 'cb-1',
        name: 'Scheduler',
        type: EChatbotType.schedule,
      },
      {
        chatbot_id: 'cb-2',
        name: 'Fallback',
        type: null,
      },
    ]);
  });

  it('existsByChatbotIdAndAccount returns false when no rows found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ScheduleChatbotsListerRepository(db as never);

    await expect(
      repository.existsByChatbotIdAndAccount('cb-1', 'acc-1')
    ).resolves.toBe(false);
  });

  it('existsByChatbotIdAndAccount returns true when row exists', async () => {
    const { db } = createSelectDbMock([{ chatbot_id: 'cb-1' }]);
    const repository = new ScheduleChatbotsListerRepository(db as never);

    await expect(
      repository.existsByChatbotIdAndAccount('cb-1', 'acc-1')
    ).resolves.toBe(true);
  });
});
