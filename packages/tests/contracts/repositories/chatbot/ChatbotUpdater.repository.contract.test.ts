import 'reflect-metadata';
import { EChatbotType } from '@core/common/enums/EChatbotType';
import { ChatbotUpdaterRepository } from '@core/repositories/chatbot/ChatbotUpdater.repository';

function createRepository(returningRows: unknown[]) {
  const returning = jest.fn(async () => returningRows);
  const where = jest.fn(() => ({ returning }));
  const set = jest.fn(() => ({ where }));
  const dbRw = {
    update: jest.fn(() => ({ set })),
  };

  return {
    repository: new ChatbotUpdaterRepository(dbRw as never),
    set,
  };
}

describe('ChatbotUpdaterRepository', () => {
  it('returns null when update has no returning rows', async () => {
    const { repository } = createRepository([]);

    await expect(
      repository.updateChatbot('chatbot-1', { name: 'New' } as never)
    ).resolves.toBeNull();
  });

  it('updates chatbot and returns mapped response', async () => {
    const { repository, set } = createRepository([
      {
        chatbot_id: 'chatbot-1',
        name: 'New',
        updated_at: '2026-01-01',
      },
    ]);

    await expect(
      repository.updateChatbot('chatbot-1', {
        name: 'New',
        type: EChatbotType.output,
      } as never)
    ).resolves.toEqual({
      chatbot_id: 'chatbot-1',
      name: 'New',
      updated_at: '2026-01-01',
    });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New',
        type: EChatbotType.output,
        updated_at: expect.any(String),
      })
    );
  });
});
