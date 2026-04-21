import 'reflect-metadata';
import { ChatbotDeleterRepository } from '@core/repositories/chatbot/ChatbotDeleter.repository';

function createUpdateStep() {
  const execute = jest.fn(async () => ({ rowCount: 1 }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));

  return { set };
}

function createDeleteStep(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));

  return { where };
}

describe('ChatbotDeleterRepository', () => {
  it('clears chatbot from schedules and worker configs', async () => {
    const scheduleUpdate = createUpdateStep();
    const workerUpdate = createUpdateStep();
    const dbRw = {
      update: jest
        .fn()
        .mockReturnValueOnce({ set: scheduleUpdate.set })
        .mockReturnValueOnce({ set: workerUpdate.set }),
      delete: jest.fn(),
    };
    const repository = new ChatbotDeleterRepository(dbRw as never);

    await repository.clearChatbotFromSchedules('chatbot-1');
    await repository.clearChatbotFromWorkerConfigs('chatbot-1');

    expect(dbRw.update).toHaveBeenCalledTimes(2);
    expect(scheduleUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        chatbot_id: null,
        updated_at: expect.any(String),
      })
    );
    expect(workerUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        chatbot_id: null,
        updated_at: expect.any(String),
      })
    );
  });

  it('returns delete status by row count', async () => {
    const deleteOk = createDeleteStep(1);
    const deleteNoRow = createDeleteStep(0);
    const repositoryOk = new ChatbotDeleterRepository({
      update: jest.fn(),
      delete: jest.fn(() => ({ where: deleteOk.where })),
    } as never);
    const repositoryNoRow = new ChatbotDeleterRepository({
      update: jest.fn(),
      delete: jest.fn(() => ({ where: deleteNoRow.where })),
    } as never);

    await expect(repositoryOk.deleteChatbotById('chatbot-1')).resolves.toBe(
      true
    );
    await expect(repositoryNoRow.deleteChatbotById('chatbot-1')).resolves.toBe(
      false
    );
  });
});
