<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  containsOfficialInteractiveEmoji,
  countOfficialInteractiveCharacters,
} from '@/utils/officialInteractiveLimits';

const props = withDefaults(
  defineProps<{
    label: string;
    limit: number;
    placeholder?: string;
    multiline?: boolean;
    rows?: number;
    forbidEmoji?: boolean;
    required?: boolean;
  }>(),
  {
    placeholder: '',
    multiline: false,
    rows: 2,
    forbidEmoji: false,
    required: false,
  }
);

const model = defineModel<string | null | undefined>({ default: '' });
const { t } = useI18n();

const inputValue = computed({
  get: () => model.value ?? '',
  set: (value: string) => {
    model.value = value;
  },
});

const currentLength = computed(() =>
  countOfficialInteractiveCharacters(inputValue.value)
);
const displayLabel = computed(() =>
  props.required ? `${props.label} *` : props.label
);
const counterValue = (value: unknown) =>
  countOfficialInteractiveCharacters(value);
const exceededBy = computed(() =>
  Math.max(0, currentLength.value - props.limit)
);
const hasForbiddenEmoji = computed(
  () => props.forbidEmoji && containsOfficialInteractiveEmoji(inputValue.value)
);
const isRequiredMissing = computed(
  () => props.required && !inputValue.value.trim()
);
const errorMessages = computed(() =>
  isRequiredMissing.value
    ? [t('chatbot_official_meta_required')]
    : hasForbiddenEmoji.value
      ? [t('chatbot_official_meta_emoji_not_allowed')]
      : exceededBy.value > 0
        ? [
            t('chatbot_official_meta_limit_exceeded', {
              excess: exceededBy.value,
              limit: props.limit,
            }),
          ]
        : []
);
const hint = computed(() =>
  t(
    props.forbidEmoji
      ? 'chatbot_official_meta_limit_no_emoji_hint'
      : 'chatbot_official_meta_limit_hint',
    { limit: props.limit }
  )
);
</script>

<template>
  <VTextarea
    v-if="multiline"
    v-model="inputValue"
    :label="displayLabel"
    :placeholder="placeholder"
    :counter="limit"
    :counter-value="counterValue"
    :rows="rows"
    :hint="hint"
    :error-messages="errorMessages"
    variant="outlined"
    density="compact"
    persistent-counter
    persistent-hint
  />
  <VTextField
    v-else
    v-model="inputValue"
    :label="displayLabel"
    :placeholder="placeholder"
    :counter="limit"
    :counter-value="counterValue"
    :hint="hint"
    :error-messages="errorMessages"
    variant="outlined"
    density="compact"
    persistent-counter
    persistent-hint
  />
</template>
