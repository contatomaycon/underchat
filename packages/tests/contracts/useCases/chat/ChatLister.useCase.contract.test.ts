import 'reflect-metadata';
import { ChatListerUseCase } from '@core/useCases/chat/ChatLister.useCase';

describe('ChatListerUseCase elastic sort', () => {
  const makeUseCase = () =>
    new ChatListerUseCase({} as never, {} as never) as unknown as {
      buildElasticsearchSort(sortBy: string, sortOrder: string): unknown[];
    };

  it('sets unmapped_type for nested keyword sorts', () => {
    const useCase = makeUseCase();

    expect(useCase.buildElasticsearchSort('sector.name', 'asc')).toEqual([
      {
        'sector.name.keyword': {
          order: 'asc',
          unmapped_type: 'keyword',
          nested: {
            path: 'sector',
          },
        },
      },
    ]);
  });

  it('sets unmapped_type for nested summary date sort', () => {
    const useCase = makeUseCase();

    expect(
      useCase.buildElasticsearchSort('summary.last_message', 'desc')
    ).toEqual([
      {
        'summary.last_date': {
          order: 'desc',
          unmapped_type: 'date',
          nested: {
            path: 'summary',
          },
        },
      },
    ]);
  });
});
