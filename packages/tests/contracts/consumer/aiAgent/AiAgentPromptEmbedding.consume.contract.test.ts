import 'reflect-metadata';

import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { AiAgentPromptEmbeddingConsume } from '@core/consumer/aiAgent/AiAgentPromptEmbedding.consume';
import type { IAiAgentPromptEmbeddingRequest } from '@core/common/interfaces/IAiAgentPromptEmbeddingRequest';
import type { IPromptDocumentExtractionResult } from '@core/services/promptDocumentExtractor.service';

const activeGptAgent = {
  status: EAiAgentStatus.active,
  ai_agent_type_id: EAiAgentType.gpt,
  api_key: 'test-key',
  base_url: 'https://api.openai.com/v1',
  openai_vector_store_id: 'vector-store-1',
};

const request: IAiAgentPromptEmbeddingRequest = {
  account_id: 'account-1',
  ai_agent_id: 'agent-1',
  ai_agent_prompt_id: 'prompt-1',
  ai_agent_type_id: EAiAgentType.gpt,
  value: 'https://cdn.example.com/knowledge.txt',
  source: 'update',
};

const extraction: IPromptDocumentExtractionResult = {
  text: 'Knowledge',
  contentType: 'text/plain',
  source: 'text',
  buffer: Buffer.from('Knowledge'),
};

const buildHarness = () => {
  const embeddingService = {
    processAndStoreEmbeddings: jest.fn(async () => 0),
    withEmbeddingGenerationLock: jest.fn(
      async (
        _accountId: string,
        _aiAgentId: string,
        task: (context: { assertActive: () => void }) => Promise<void>
      ) => task({ assertActive: jest.fn() })
    ),
  };
  const openAIAssistantService = {
    cleanupPendingOpenAIFiles: jest.fn(async () => undefined),
    ensureVectorStore: jest.fn(async () => 'vector-store-1'),
    uploadFileToOpenAI: jest.fn(async () => 'file-new'),
    addFileToVectorStoreWithRecovery: jest.fn(async () => 'vector-store-1'),
    registerPendingOpenAIFileCleanup: jest.fn(async () => undefined),
    cleanupOpenAIFile: jest.fn(async () => undefined),
  };
  const aiAgentService = {
    viewAiAgent: jest.fn(),
    viewAiAgentPrompt: jest.fn(),
    updateAiAgentPromptOpenAIFileId: jest.fn(async () => true),
  };
  const promptDocumentExtractorService = {
    extractTextFromUrl: jest.fn(async () => extraction),
  };
  const consumer = new AiAgentPromptEmbeddingConsume(
    {} as never,
    {} as never,
    embeddingService as never,
    openAIAssistantService as never,
    aiAgentService as never,
    promptDocumentExtractorService as never,
    {} as never
  );
  const internal = consumer as unknown as {
    processEmbedding(data: IAiAgentPromptEmbeddingRequest): Promise<void>;
    processOpenAIFileUpload(
      data: IAiAgentPromptEmbeddingRequest,
      document: IPromptDocumentExtractionResult
    ): Promise<void>;
  };

  return {
    internal,
    embeddingService,
    openAIAssistantService,
    aiAgentService,
    promptDocumentExtractorService,
  };
};

describe('AiAgentPromptEmbeddingConsume OpenAI file fencing', () => {
  it('commits an empty generation and removes the previous GPT file', async () => {
    const harness = buildHarness();
    harness.promptDocumentExtractorService.extractTextFromUrl.mockResolvedValue(
      {
        ...extraction,
        text: '   ',
        buffer: Buffer.alloc(0),
      }
    );
    harness.aiAgentService.viewAiAgent.mockResolvedValue(activeGptAgent);
    harness.aiAgentService.viewAiAgentPrompt.mockResolvedValue({
      status: EAiAgentStatus.active,
      value: request.value,
      openai_file_id: 'file-old',
    });

    await expect(
      harness.internal.processEmbedding(request)
    ).resolves.toBeUndefined();

    expect(
      harness.embeddingService.processAndStoreEmbeddings
    ).toHaveBeenCalledWith(
      'account-1',
      'agent-1',
      'prompt-1',
      '',
      request.value
    );
    expect(
      harness.openAIAssistantService.registerPendingOpenAIFileCleanup
    ).toHaveBeenCalledWith(
      'account-1',
      'agent-1',
      'prompt-1',
      'vector-store-1',
      'file-old'
    );
    expect(
      harness.aiAgentService.updateAiAgentPromptOpenAIFileId
    ).toHaveBeenCalledWith('prompt-1', 'account-1', null);
    expect(
      harness.openAIAssistantService.uploadFileToOpenAI
    ).not.toHaveBeenCalled();
  });

  it('removes a newly uploaded file when the prompt source changed before activation', async () => {
    const harness = buildHarness();
    harness.aiAgentService.viewAiAgent.mockResolvedValue(activeGptAgent);
    harness.aiAgentService.viewAiAgentPrompt
      .mockResolvedValueOnce({
        status: EAiAgentStatus.active,
        value: request.value,
        openai_file_id: 'file-old',
      })
      .mockResolvedValueOnce({
        status: EAiAgentStatus.active,
        value: 'https://cdn.example.com/new-knowledge.txt',
        openai_file_id: 'file-old',
      });

    await expect(
      harness.internal.processOpenAIFileUpload(request, extraction)
    ).resolves.toBeUndefined();

    expect(
      harness.aiAgentService.updateAiAgentPromptOpenAIFileId
    ).not.toHaveBeenCalled();
    expect(
      harness.openAIAssistantService.cleanupOpenAIFile
    ).toHaveBeenCalledWith(
      'test-key',
      'https://api.openai.com/v1',
      null,
      'file-new'
    );
  });

  it('atomically activates the new file and cleans the previous file', async () => {
    const harness = buildHarness();
    harness.aiAgentService.viewAiAgent.mockResolvedValue(activeGptAgent);
    harness.aiAgentService.viewAiAgentPrompt.mockResolvedValue({
      status: EAiAgentStatus.active,
      value: request.value,
      openai_file_id: 'file-old',
    });

    await expect(
      harness.internal.processOpenAIFileUpload(request, extraction)
    ).resolves.toBeUndefined();

    expect(
      harness.aiAgentService.updateAiAgentPromptOpenAIFileId
    ).toHaveBeenCalledWith('prompt-1', 'account-1', 'file-new');
    expect(
      harness.openAIAssistantService.registerPendingOpenAIFileCleanup
    ).toHaveBeenCalledWith(
      'account-1',
      'agent-1',
      'prompt-1',
      'vector-store-1',
      'file-old'
    );
  });

  it('fences activation with the vector store returned by recovery', async () => {
    const harness = buildHarness();
    harness.openAIAssistantService.addFileToVectorStoreWithRecovery.mockResolvedValue(
      'vector-store-recovered'
    );
    harness.aiAgentService.viewAiAgent
      .mockResolvedValueOnce(activeGptAgent)
      .mockResolvedValue({
        ...activeGptAgent,
        openai_vector_store_id: 'vector-store-recovered',
      });
    harness.aiAgentService.viewAiAgentPrompt.mockResolvedValue({
      status: EAiAgentStatus.active,
      value: request.value,
      openai_file_id: 'file-old',
    });

    await expect(
      harness.internal.processOpenAIFileUpload(request, extraction)
    ).resolves.toBeUndefined();

    expect(
      harness.aiAgentService.updateAiAgentPromptOpenAIFileId
    ).toHaveBeenCalledWith('prompt-1', 'account-1', 'file-new');
    expect(
      harness.openAIAssistantService.registerPendingOpenAIFileCleanup
    ).toHaveBeenCalledWith(
      'account-1',
      'agent-1',
      'prompt-1',
      'vector-store-recovered',
      'file-old'
    );
  });
});
