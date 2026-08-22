import { EVoiceIaType } from '@core/common/enums/EVoiceIaType';
import type { CreateVoiceIaRequest } from '@core/schema/voiceIa/createVoiceIa/request.schema';
import type { UpdateVoiceIaRequest } from '@core/schema/voiceIa/updateVoiceIa/request.schema';

const VOICE_IA_DEFAULT_MODELS: Readonly<Record<EVoiceIaType, string>> = {
  [EVoiceIaType.eleven_labs]: 'eleven_multilingual_v2',
  [EVoiceIaType.gpt]: 'tts-1',
  [EVoiceIaType.gemini]: 'gemini-3.1-flash-tts-preview',
};

interface CurrentVoiceIaConfiguration {
  voice_ia_type: string;
  model_id: string;
}

interface PrepareVoiceIaUpdateInput {
  current: CurrentVoiceIaConfiguration;
  input: UpdateVoiceIaRequest;
}

export const resolveVoiceIaType = (
  value: string | null | undefined
): EVoiceIaType => {
  if (!value) {
    return EVoiceIaType.eleven_labs;
  }

  if (Object.values(EVoiceIaType).includes(value as EVoiceIaType)) {
    return value as EVoiceIaType;
  }

  throw new Error(`Tipo de Voice IA não suportado: ${value}`);
};

export const getVoiceIaDefaultModel = (provider: EVoiceIaType): string =>
  VOICE_IA_DEFAULT_MODELS[provider];

export const normalizeVoiceIaModel = (
  provider: EVoiceIaType,
  model: string | null | undefined
): string => {
  let normalized = model?.trim() ?? '';

  if (provider === EVoiceIaType.gemini) {
    normalized = normalized.replace(/^(?:models\s*\/\s*)+/i, '').trim();
  }

  return normalized;
};

export const isVoiceIaModelCompatible = (
  provider: EVoiceIaType,
  model: string
): boolean => {
  if (provider === EVoiceIaType.eleven_labs) {
    return /^eleven_[a-z0-9._-]+$/i.test(model);
  }

  if (provider === EVoiceIaType.gpt) {
    return /^(?:tts-[a-z0-9._-]+|gpt-[a-z0-9._-]*tts[a-z0-9._-]*)$/i.test(
      model
    );
  }

  return /^gemini-[a-z0-9._-]*tts[a-z0-9._-]*$/i.test(model);
};

export const resolveVoiceIaModel = (
  provider: EVoiceIaType,
  model: string | null | undefined
): string => {
  const normalizedModel = normalizeVoiceIaModel(provider, model);

  return normalizedModel && isVoiceIaModelCompatible(provider, normalizedModel)
    ? normalizedModel
    : getVoiceIaDefaultModel(provider);
};

export const prepareVoiceIaCreateConfiguration = (
  input: CreateVoiceIaRequest
): CreateVoiceIaRequest => {
  const provider = resolveVoiceIaType(input.voice_ia_type);

  return {
    ...input,
    voice_ia_type: provider,
    model_id: resolveVoiceIaModel(provider, input.model_id),
  };
};

export const prepareVoiceIaUpdateConfiguration = ({
  current,
  input,
}: PrepareVoiceIaUpdateInput): UpdateVoiceIaRequest => {
  const currentProvider = resolveVoiceIaType(current.voice_ia_type);
  const requestedProvider =
    input.voice_ia_type === null || input.voice_ia_type === undefined
      ? currentProvider
      : resolveVoiceIaType(input.voice_ia_type);
  const providerChanged = requestedProvider !== currentProvider;
  const hasRequestedModel =
    input.model_id !== null && input.model_id !== undefined;

  if (providerChanged) {
    return {
      ...input,
      voice_ia_type: requestedProvider,
      model_id: hasRequestedModel
        ? resolveVoiceIaModel(requestedProvider, input.model_id)
        : getVoiceIaDefaultModel(requestedProvider),
    };
  }

  const normalizedCurrentModel = normalizeVoiceIaModel(
    currentProvider,
    current.model_id
  );
  const belongsToDifferentProvider = Object.values(EVoiceIaType).some(
    (provider) =>
      provider !== currentProvider &&
      isVoiceIaModelCompatible(provider, normalizedCurrentModel)
  );
  const currentNormalizedModel =
    !normalizedCurrentModel || belongsToDifferentProvider
      ? getVoiceIaDefaultModel(currentProvider)
      : normalizedCurrentModel;

  if (hasRequestedModel) {
    return {
      ...input,
      model_id: resolveVoiceIaModel(currentProvider, input.model_id),
    };
  }

  if (currentNormalizedModel !== current.model_id) {
    return {
      ...input,
      model_id: currentNormalizedModel,
    };
  }

  return input;
};
