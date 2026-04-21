import 'reflect-metadata';

const mockOnlyDigits = jest.fn();
const mockBuildCandidates = jest.fn();
const mockSetPaginationData = jest.fn();

jest.mock('@core/repositories/schedule/ScheduleLister.repository', () => ({
  ScheduleListerRepository: class {},
}));
jest.mock('@core/repositories/schedule/ScheduleCreator.repository', () => ({
  ScheduleCreatorRepository: class {},
}));
jest.mock(
  '@core/repositories/schedule/ScheduleViewerExists.repository',
  () => ({
    ScheduleViewerExistsRepository: class {},
  })
);
jest.mock('@core/repositories/schedule/ScheduleViewer.repository', () => ({
  ScheduleViewerRepository: class {},
}));
jest.mock('@core/repositories/schedule/ScheduleDeleter.repository', () => ({
  ScheduleDeleterRepository: class {},
}));
jest.mock('@core/repositories/schedule/ScheduleUpdater.repository', () => ({
  ScheduleUpdaterRepository: class {},
}));
jest.mock(
  '@core/repositories/schedule/ScheduleWorkersLister.repository',
  () => ({
    ScheduleWorkersListerRepository: class {},
  })
);
jest.mock(
  '@core/repositories/schedule/ScheduleChatbotsLister.repository',
  () => ({
    ScheduleChatbotsListerRepository: class {},
  })
);
jest.mock(
  '@core/repositories/schedule/ScheduleContactsLister.repository',
  () => ({
    ScheduleContactsListerRepository: class {},
  })
);
jest.mock(
  '@core/repositories/schedule/ScheduleContactGroupsLister.repository',
  () => ({
    ScheduleContactGroupsListerRepository: class {},
  })
);
jest.mock(
  '@core/repositories/schedule/ScheduleMessagesLister.repository',
  () => ({
    ScheduleMessagesListerRepository: class {},
  })
);
jest.mock('@core/repositories/schedule/ScheduleControl.repository', () => ({
  ScheduleControlRepository: class {},
}));
jest.mock('@core/services/encrypt.service', () => ({
  EncryptService: class {},
}));

jest.mock('@core/common/functions/onlyDigits', () => ({
  onlyDigits: (...args: unknown[]) => mockOnlyDigits(...args),
}));

jest.mock('@core/common/functions/buildCandidatesBR', () => ({
  buildCandidates: (...args: unknown[]) => mockBuildCandidates(...args),
}));

jest.mock('@core/common/functions/createPaginationData', () => ({
  setPaginationData: (...args: unknown[]) => mockSetPaginationData(...args),
}));

import { ScheduleService } from '@core/services/schedule.service';

describe('ScheduleService', () => {
  const makeService = () => {
    const scheduleListerRepository = {
      listSchedules: jest.fn<Promise<any[]>, any[]>(async () => []),
      listScheduleTotal: jest.fn(async () => 0),
    };

    const scheduleCreatorRepository = {
      createSchedule: jest.fn(async () => 'sch-1'),
    };

    const scheduleViewerExistsRepository = {
      existsScheduleById: jest.fn(async () => true),
    };

    const scheduleViewerRepository = {
      viewScheduleById: jest.fn(async () => ({ schedule_id: 'sch-1' })),
    };

    const scheduleDeleterRepository = {
      deleteScheduleById: jest.fn(async () => true),
    };

    const scheduleUpdaterRepository = {
      updateScheduleById: jest.fn(async () => true),
    };

    const scheduleWorkersListerRepository = {
      listScheduleWorkers: jest.fn(async () => [{ worker_id: 'w-1' }]),
    };

    const scheduleChatbotsListerRepository = {
      listScheduleChatbots: jest.fn(async () => [{ chatbot_id: 'cb-1' }]),
      existsByChatbotIdAndAccount: jest.fn(async () => true),
    };

    const scheduleContactsListerRepository = {
      listScheduleContacts: jest.fn(async () => [{ contact_id: 'c-1' }]),
      listScheduleContactsTotal: jest.fn(async () => 1),
    };

    const scheduleContactGroupsListerRepository = {
      listScheduleContactGroups: jest.fn(async () => [
        { contact_group_id: 'cg-1' },
      ]),
    };

    const scheduleMessagesListerRepository = {
      countFailedMessagesByScheduleIds: jest.fn(async () => ({})),
      listScheduleMessages: jest.fn(async () => [
        [{ schedule_message_id: 'm-1' }],
        1,
      ]),
    };

    const scheduleControlRepository = {
      findByIdAndAccount: jest.fn(async () => ({ schedule_id: 'sch-1' })),
      getScheduleStatusById: jest.fn(async () => 'active'),
      startScheduleNow: jest.fn(async () => true),
      pauseSchedule: jest.fn(async () => true),
      cancelSchedule: jest.fn(async () => true),
    };

    const encryptService = {
      encrypt: jest.fn((value: string) => `enc:${value}`),
    };

    const service = new ScheduleService(
      scheduleListerRepository as never,
      scheduleCreatorRepository as never,
      scheduleViewerExistsRepository as never,
      scheduleViewerRepository as never,
      scheduleDeleterRepository as never,
      scheduleUpdaterRepository as never,
      scheduleWorkersListerRepository as never,
      scheduleChatbotsListerRepository as never,
      scheduleContactsListerRepository as never,
      scheduleContactGroupsListerRepository as never,
      scheduleMessagesListerRepository as never,
      scheduleControlRepository as never,
      encryptService as never
    );

    return {
      service,
      scheduleListerRepository,
      scheduleCreatorRepository,
      scheduleViewerExistsRepository,
      scheduleViewerRepository,
      scheduleDeleterRepository,
      scheduleUpdaterRepository,
      scheduleWorkersListerRepository,
      scheduleChatbotsListerRepository,
      scheduleContactsListerRepository,
      scheduleContactGroupsListerRepository,
      scheduleMessagesListerRepository,
      scheduleControlRepository,
      encryptService,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockOnlyDigits.mockReset();
    mockBuildCandidates.mockReset();
    mockSetPaginationData.mockReset();
  });

  it('listSchedules returns early when no results and enriches with failed counts otherwise', async () => {
    const {
      service,
      scheduleListerRepository,
      scheduleMessagesListerRepository,
    } = makeService();

    scheduleListerRepository.listSchedules.mockResolvedValueOnce([]);
    scheduleListerRepository.listScheduleTotal.mockResolvedValueOnce(0);

    await expect(
      service.listSchedules(10, 1, { search: 'x' } as never, 'acc-1')
    ).resolves.toEqual([[], 0]);
    expect(
      scheduleMessagesListerRepository.countFailedMessagesByScheduleIds
    ).not.toHaveBeenCalled();

    scheduleListerRepository.listSchedules.mockResolvedValueOnce([
      { schedule_id: 'sch-1', name: 'One' },
      { schedule_id: 'sch-2', name: 'Two' },
    ]);
    scheduleListerRepository.listScheduleTotal.mockResolvedValueOnce(2);
    scheduleMessagesListerRepository.countFailedMessagesByScheduleIds.mockResolvedValueOnce(
      {
        'sch-1': 3,
      }
    );

    await expect(
      service.listSchedules(10, 1, { search: 'x' } as never, 'acc-1')
    ).resolves.toEqual([
      [
        {
          schedule_id: 'sch-1',
          name: 'One',
          failed_messages_count: 3,
          has_failed_messages: true,
        },
        {
          schedule_id: 'sch-2',
          name: 'Two',
          failed_messages_count: 0,
          has_failed_messages: false,
        },
      ],
      2,
    ]);

    expect(
      scheduleMessagesListerRepository.countFailedMessagesByScheduleIds
    ).toHaveBeenCalledWith(['sch-1', 'sch-2'], 'acc-1');
  });

  it('delegates create/view/update/delete/control/worker/chatbot/group methods', async () => {
    const {
      service,
      scheduleCreatorRepository,
      scheduleViewerExistsRepository,
      scheduleViewerRepository,
      scheduleDeleterRepository,
      scheduleUpdaterRepository,
      scheduleWorkersListerRepository,
      scheduleChatbotsListerRepository,
      scheduleContactGroupsListerRepository,
      scheduleControlRepository,
    } = makeService();

    await expect(
      service.createSchedule({ account_id: 'acc-1', worker_id: 'w-1' } as never)
    ).resolves.toBe('sch-1');
    expect(scheduleCreatorRepository.createSchedule).toHaveBeenCalled();

    await expect(service.existsScheduleById('sch-1')).resolves.toBe(true);
    await expect(service.viewScheduleById('sch-1')).resolves.toEqual({
      schedule_id: 'sch-1',
    });
    await expect(service.deleteScheduleById('sch-1')).resolves.toBe(true);
    await expect(
      service.updateScheduleById('sch-1', { send_to: 'all' } as never)
    ).resolves.toBe(true);

    await expect(
      service.findScheduleControlById('sch-1', 'acc-1')
    ).resolves.toEqual({ schedule_id: 'sch-1' });
    await expect(service.getScheduleStatusById('sch-1')).resolves.toBe(
      'active'
    );
    await expect(service.startScheduleNow('sch-1')).resolves.toBe(true);
    await expect(service.pauseSchedule('sch-1')).resolves.toBe(true);
    await expect(service.cancelSchedule('sch-1')).resolves.toBe(true);

    await expect(service.listScheduleWorkers('acc-1')).resolves.toEqual([
      { worker_id: 'w-1' },
    ]);
    await expect(service.listScheduleChatbots('acc-1')).resolves.toEqual([
      { chatbot_id: 'cb-1' },
    ]);
    await expect(service.existsChatbotInAccount('cb-1', 'acc-1')).resolves.toBe(
      true
    );
    await expect(service.listScheduleContactGroups('acc-1')).resolves.toEqual([
      { contact_group_id: 'cg-1' },
    ]);

    expect(
      scheduleViewerExistsRepository.existsScheduleById
    ).toHaveBeenCalledWith('sch-1');
    expect(scheduleViewerRepository.viewScheduleById).toHaveBeenCalledWith(
      'sch-1'
    );
    expect(scheduleDeleterRepository.deleteScheduleById).toHaveBeenCalledWith(
      'sch-1'
    );
    expect(scheduleUpdaterRepository.updateScheduleById).toHaveBeenCalledWith(
      'sch-1',
      { send_to: 'all' }
    );
    expect(
      scheduleWorkersListerRepository.listScheduleWorkers
    ).toHaveBeenCalledWith('acc-1');
    expect(
      scheduleChatbotsListerRepository.listScheduleChatbots
    ).toHaveBeenCalledWith('acc-1');
    expect(
      scheduleContactGroupsListerRepository.listScheduleContactGroups
    ).toHaveBeenCalledWith('acc-1');
    expect(scheduleControlRepository.findByIdAndAccount).toHaveBeenCalledWith(
      'sch-1',
      'acc-1'
    );
  });

  it('listScheduleContacts encrypts search according to digits length', async () => {
    const { service, scheduleContactsListerRepository, encryptService } =
      makeService();

    mockOnlyDigits.mockReturnValueOnce('12345');
    mockBuildCandidates.mockReturnValueOnce(['55119999', '55118888']);

    await expect(
      service.listScheduleContacts(
        20,
        2,
        { search: '+55 11 9999' } as never,
        'acc-1'
      )
    ).resolves.toEqual([[{ contact_id: 'c-1' }], 1]);

    expect(encryptService.encrypt).toHaveBeenCalledWith('55119999');
    expect(encryptService.encrypt).toHaveBeenCalledWith('55118888');
    expect(encryptService.encrypt).toHaveBeenCalledWith('+55 11 9999');
    expect(
      scheduleContactsListerRepository.listScheduleContacts
    ).toHaveBeenCalledWith(
      20,
      2,
      { search: '+55 11 9999' },
      'acc-1',
      'enc:+55 11 9999',
      ['enc:55119999', 'enc:55118888']
    );

    mockOnlyDigits.mockReturnValueOnce('12');
    await expect(
      service.listScheduleContacts(10, 1, { search: 'ab' } as never, 'acc-1')
    ).resolves.toEqual([[{ contact_id: 'c-1' }], 1]);

    expect(
      scheduleContactsListerRepository.listScheduleContacts
    ).toHaveBeenLastCalledWith(
      10,
      1,
      { search: 'ab' },
      'acc-1',
      'enc:ab',
      null
    );

    await expect(
      service.listScheduleContacts(10, 1, {} as never, 'acc-1')
    ).resolves.toEqual([[{ contact_id: 'c-1' }], 1]);
    expect(
      scheduleContactsListerRepository.listScheduleContacts
    ).toHaveBeenLastCalledWith(10, 1, {}, 'acc-1', null, null);
  });

  it('listScheduleMessages uses defaults and custom pagination params', async () => {
    const { service, scheduleMessagesListerRepository } = makeService();

    mockSetPaginationData.mockReturnValue({
      current_page: 1,
      total_pages: 1,
      per_page: 50,
      count: 1,
      total: 1,
    });

    await expect(
      service.listScheduleMessages({ schedule_id: 'sch-1' } as never, 'acc-1')
    ).resolves.toEqual({
      results: [{ schedule_message_id: 'm-1' }],
      pagings: {
        current_page: 1,
        total_pages: 1,
        per_page: 50,
        count: 1,
        total: 1,
      },
    });

    expect(
      scheduleMessagesListerRepository.listScheduleMessages
    ).toHaveBeenCalledWith('sch-1', 'acc-1', 1, 50);

    scheduleMessagesListerRepository.listScheduleMessages.mockResolvedValueOnce(
      [[{ schedule_message_id: 'm-2' }, { schedule_message_id: 'm-3' }], 10]
    );
    mockSetPaginationData.mockReturnValueOnce({
      current_page: 3,
      total_pages: 2,
      per_page: 5,
      count: 2,
      total: 10,
    });

    await expect(
      service.listScheduleMessages(
        {
          schedule_id: 'sch-1',
          current_page: 3,
          per_page: 5,
        } as never,
        'acc-1'
      )
    ).resolves.toEqual({
      results: [{ schedule_message_id: 'm-2' }, { schedule_message_id: 'm-3' }],
      pagings: {
        current_page: 3,
        total_pages: 2,
        per_page: 5,
        count: 2,
        total: 10,
      },
    });

    expect(mockSetPaginationData).toHaveBeenCalledWith(2, 10, 5, 3);
  });
});
