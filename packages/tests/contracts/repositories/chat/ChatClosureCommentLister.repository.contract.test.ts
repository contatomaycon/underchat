import 'reflect-metadata';
import { ChatClosureCommentListerRepository } from '@core/repositories/chat/ChatClosureCommentLister.repository';

function createChain(result: Array<{ comment: string; closed_at: string }>) {
  const orderBy = jest.fn(async () => result);
  const where = jest.fn(() => ({ orderBy }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('ChatClosureCommentListerRepository', () => {
  it('returns mapped comments ordered query result', async () => {
    const chain = createChain([
      { comment: 'a', closed_at: '2026-01-01' },
      { comment: 'b', closed_at: '2026-01-02' },
    ]);
    const dbRo = { select: chain.select };
    const repository = new ChatClosureCommentListerRepository(dbRo as never);

    await expect(repository.listByChatId('acc-1', 'chat-1')).resolves.toEqual([
      { comment: 'a', closed_at: '2026-01-01' },
      { comment: 'b', closed_at: '2026-01-02' },
    ]);
  });

  it('returns empty array when there are no comments', async () => {
    const chain = createChain([]);
    const dbRo = { select: chain.select };
    const repository = new ChatClosureCommentListerRepository(dbRo as never);

    await expect(repository.listByChatId('acc-1', 'chat-1')).resolves.toEqual(
      []
    );
  });
});
