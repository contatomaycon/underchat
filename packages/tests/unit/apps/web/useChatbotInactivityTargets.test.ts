import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

interface RefValue<T> {
  value: T;
}

interface InactivityTargets {
  channels: RefValue<Array<{ value: string; title: string }>>;
  chatbots: RefValue<Array<{ value: string; title: string; type: string }>>;
  selectedChannelId: RefValue<string | null>;
  selectedChatbotId: RefValue<string | null>;
  loadChannels: () => Promise<void>;
  restoreSelection: (
    workerId?: string | null,
    chatbotId?: string | null
  ) => Promise<void>;
}

interface ChatbotStoreMock {
  listChatbotChannels: jest.Mock;
  listChannelChatbots: jest.Mock;
}

function loadComposable(chatbotStore: ChatbotStoreMock): {
  useChatbotInactivityTargets: () => InactivityTargets;
} {
  const filename = path.resolve(
    process.cwd(),
    'apps/web/src/composables/useChatbotInactivityTargets.ts'
  );
  const source = fs.readFileSync(filename, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} as Record<string, unknown> };
  const createRef = <T>(value: T): RefValue<T> => ({ value });
  const moduleRequire = (moduleId: string): unknown => {
    const modules: Record<string, unknown> = {
      vue: {
        ref: createRef,
        shallowRef: createRef,
        readonly: <T>(value: T): T => value,
      },
      'vue-i18n': {
        useI18n: () => ({ t: (key: string): string => key }),
      },
      '@/@webcore/stores/chatbot': {
        useChatbotStore: () => chatbotStore,
      },
    };

    if (!(moduleId in modules)) {
      throw new Error(`Unexpected composable dependency: ${moduleId}`);
    }

    return modules[moduleId];
  };
  const evaluateModule = new Function(
    'require',
    'module',
    'exports',
    transpiled
  ) as (
    requireModule: (moduleId: string) => unknown,
    module: typeof loadedModule,
    exports: Record<string, unknown>
  ) => void;
  evaluateModule(moduleRequire, loadedModule, loadedModule.exports);

  return loadedModule.exports as unknown as {
    useChatbotInactivityTargets: () => InactivityTargets;
  };
}

describe('useChatbotInactivityTargets', () => {
  function makeStore(): ChatbotStoreMock {
    return {
      listChatbotChannels: jest.fn(async () => [
        { id: 'channel-available', name: 'Canal disponível', number: '5511' },
      ]),
      listChannelChatbots: jest.fn(async () => [
        {
          chatbot_id: 'chatbot-1',
          name: 'Inicial',
          type: 'input',
        },
      ]),
    };
  }

  it('clears a removed channel locally without requesting its chatbots', async () => {
    const chatbotStore = makeStore();
    const { useChatbotInactivityTargets } = loadComposable(chatbotStore);
    const targets = useChatbotInactivityTargets();
    await targets.loadChannels();

    await targets.restoreSelection('channel-removed', 'chatbot-1');

    expect(targets.selectedChannelId.value).toBeNull();
    expect(targets.selectedChatbotId.value).toBeNull();
    expect(targets.chatbots.value).toEqual([]);
    expect(chatbotStore.listChannelChatbots).not.toHaveBeenCalled();
  });

  it('restores the chatbot when its channel is still available', async () => {
    const chatbotStore = makeStore();
    const { useChatbotInactivityTargets } = loadComposable(chatbotStore);
    const targets = useChatbotInactivityTargets();
    await targets.loadChannels();

    await targets.restoreSelection('channel-available', 'chatbot-1');

    expect(chatbotStore.listChannelChatbots).toHaveBeenCalledWith(
      'channel-available'
    );
    expect(targets.selectedChannelId.value).toBe('channel-available');
    expect(targets.selectedChatbotId.value).toBe('chatbot-1');
    expect(targets.chatbots.value).toEqual([
      {
        value: 'chatbot-1',
        title: 'Inicial (chatbot_type_input)',
        type: 'input',
      },
    ]);
  });

  it('clears a chatbot that is no longer linked to an available channel', async () => {
    const chatbotStore = makeStore();
    const { useChatbotInactivityTargets } = loadComposable(chatbotStore);
    const targets = useChatbotInactivityTargets();
    await targets.loadChannels();

    await targets.restoreSelection('channel-available', 'chatbot-removed');

    expect(chatbotStore.listChannelChatbots).toHaveBeenCalledWith(
      'channel-available'
    );
    expect(targets.selectedChannelId.value).toBe('channel-available');
    expect(targets.selectedChatbotId.value).toBeNull();
  });
});
