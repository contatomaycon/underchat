import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class AiEmbeddingEnvironment {
  public get apiKey(): string {
    const apiKey = process.env.AI_EMBEDDING_API_KEY;
    if (!apiKey) {
      throw new InvalidConfigurationError(
        'AI_EMBEDDING_API_KEY is not defined.'
      );
    }

    return apiKey;
  }

  public get baseUrl(): string {
    const baseUrl = process.env.AI_EMBEDDING_BASE_URL;
    if (!baseUrl) {
      throw new InvalidConfigurationError(
        'AI_EMBEDDING_BASE_URL is not defined.'
      );
    }

    return baseUrl;
  }

  public get model(): string {
    const model = process.env.AI_EMBEDDING_MODEL;
    if (!model) {
      throw new InvalidConfigurationError(
        'AI_EMBEDDING_MODEL is not defined.'
      );
    }

    return model;
  }

  public get chunkSize(): number {
    const chunkSize = process.env.EMBEDDING_CHUNK_SIZE;
    if (!chunkSize) {
      return 600;
    }

    const parsed = Number.parseInt(chunkSize, 10);
    if (Number.isNaN(parsed)) {
      return 600;
    }

    return parsed;
  }

  public get chunkOverlap(): number {
    const chunkOverlap = process.env.EMBEDDING_CHUNK_OVERLAP;
    if (!chunkOverlap) {
      return 100;
    }

    const parsed = Number.parseInt(chunkOverlap, 10);
    if (Number.isNaN(parsed)) {
      return 100;
    }

    return parsed;
  }
}
