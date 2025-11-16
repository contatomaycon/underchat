<script lang="ts" setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Picker, EmojiIndex } from 'emoji-mart-vue-fast/src';
import data from 'emoji-mart-vue-fast/data/all.json';
import 'emoji-mart-vue-fast/css/emoji-mart.css';

const emojiIndex = new EmojiIndex(data);
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (
    e: 'select',
    poll: { question: string; options: string[]; allowMultiple: boolean }
  ): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

interface PollOption {
  id: string;
  text: string;
  emoji: string;
}

const question = ref('');
const options = ref<PollOption[]>([
  { id: '1', text: '', emoji: '' },
  { id: '2', text: '', emoji: '' },
]);
const allowMultiple = ref(true);
const draggedIndex = ref<number | null>(null);
const showEmojiPickerQuestion = ref<boolean>(false);
const showEmojiPickerOptions = ref<Record<string, boolean>>({});

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) {
      question.value = '';
      options.value = [
        { id: '1', text: '', emoji: '' },
        { id: '2', text: '', emoji: '' },
      ];
      allowMultiple.value = true;
      showEmojiPickerQuestion.value = false;
      showEmojiPickerOptions.value = { '1': false, '2': false };
    }
  }
);

const addOption = () => {
  if (options.value.length >= 12) {
    return;
  }
  const newId = Date.now().toString();
  options.value.push({
    id: newId,
    text: '',
    emoji: '',
  });
  showEmojiPickerOptions.value[newId] = false;
};

const removeOption = (index: number) => {
  if (options.value.length <= 2) {
    return;
  }
  options.value.splice(index, 1);
};

const onDragStart = (index: number) => {
  draggedIndex.value = index;
};

const onDragOver = (e: DragEvent) => {
  e.preventDefault();
};

const onDrop = (e: DragEvent, targetIndex: number) => {
  e.preventDefault();
  if (draggedIndex.value === null) {
    return;
  }

  const draggedItem = options.value[draggedIndex.value];
  options.value.splice(draggedIndex.value, 1);
  options.value.splice(targetIndex, 0, draggedItem);
  draggedIndex.value = null;
};

const onEmojiSelect = (optionId: string, emoji: any) => {
  const option = options.value.find((o) => o.id === optionId);
  if (option) {
    option.emoji = emoji.native || emoji.colons || '';
  }
  showEmojiPickerOptions.value[optionId] = false;
};

const canSend = computed(() => {
  return (
    question.value.trim().length > 0 &&
    options.value.filter((o) => o.text.trim().length > 0).length >= 2
  );
});

const handleSend = () => {
  if (!canSend.value) {
    return;
  }

  const validOptions = options.value
    .filter((o) => o.text.trim().length > 0)
    .map((o) => {
      const text = o.text.trim();
      const emoji = o.emoji ? `${o.emoji} ` : '';
      return `${emoji}${text}`;
    });

  emit('select', {
    question: question.value.trim(),
    options: validOptions,
    allowMultiple: allowMultiple.value,
  });
  isVisible.value = false;
};
</script>

<template>
  <VDialog v-model="isVisible" max-width="600" persistent>
    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between">
        <span>{{ t('create_poll', 'Criar enquete') }}</span>
        <VBtn icon variant="text" @click="isVisible = false">
          <VIcon>tabler-x</VIcon>
        </VBtn>
      </VCardTitle>

      <VCardText>
        <div class="mb-6">
          <VLabel class="mb-2 text-body-1 font-weight-medium">
            {{ t('question', 'Pergunta') }}
          </VLabel>
          <div class="d-flex align-center gap-2">
            <AppTextField
              v-model="question"
              :placeholder="t('ask_question', 'Faça uma pergunta')"
              hide-details
              variant="outlined"
              class="flex-grow-1"
            />
            <VMenu
              v-model="showEmojiPickerQuestion"
              location="top"
              :close-on-content-click="false"
            >
              <template #activator="{ props: menuProps }">
                <VBtn v-bind="menuProps" icon variant="text" size="small">
                  <VIcon>tabler-mood-smile</VIcon>
                </VBtn>
              </template>
              <div class="emoji-picker-wrap">
                <Picker
                  :data="emojiIndex"
                  :per-line="8"
                  :show-preview="false"
                  :show-search="true"
                  :show-skin-tones="false"
                  @select="
                    (e: any) => {
                      question += e.native || e.colons || '';
                      showEmojiPickerQuestion = false;
                    }
                  "
                />
              </div>
            </VMenu>
          </div>
        </div>

        <div>
          <VLabel class="mb-2 text-body-1 font-weight-medium">
            {{ t('options', 'Opções') }}
          </VLabel>
          <div class="d-flex flex-column gap-2">
            <div
              v-for="(option, index) in options"
              :key="option.id"
              class="d-flex align-center gap-2"
              draggable="true"
              @dragstart="onDragStart(index)"
              @dragover="onDragOver"
              @drop="onDrop($event, index)"
            >
              <VIcon class="cursor-move" color="disabled"
                >tabler-grip-vertical</VIcon
              >
              <AppTextField
                v-model="option.text"
                :placeholder="t('add_text', 'Adicionar texto')"
                hide-details
                variant="outlined"
                density="compact"
                class="flex-grow-1"
              />
              <VMenu
                v-model="showEmojiPickerOptions[option.id]"
                location="top"
                :close-on-content-click="false"
              >
                <template #activator="{ props: menuProps }">
                  <VBtn v-bind="menuProps" icon variant="text" size="small">
                    <VIcon>tabler-mood-smile</VIcon>
                  </VBtn>
                </template>
                <div class="emoji-picker-wrap">
                  <Picker
                    :data="emojiIndex"
                    :per-line="8"
                    :show-preview="false"
                    :show-search="true"
                    :show-skin-tones="false"
                    @select="(e: any) => onEmojiSelect(option.id, e)"
                  />
                </div>
              </VMenu>
              <VBtn
                v-if="options.length > 2"
                icon
                variant="text"
                size="small"
                color="error"
                @click="removeOption(index)"
              >
                <VIcon size="18">tabler-x</VIcon>
              </VBtn>
            </div>
          </div>

          <VBtn
            v-if="options.length < 12"
            variant="text"
            size="small"
            class="mt-2"
            @click="addOption"
          >
            <VIcon size="18" class="me-1">tabler-plus</VIcon>
            {{ t('add_option', 'Adicionar opção') }}
          </VBtn>
        </div>

        <div class="mt-6 d-flex align-center justify-space-between">
          <VLabel class="text-body-1">
            {{ t('allow_multiple_responses', 'Permitir várias respostas') }}
          </VLabel>
          <VSwitch v-model="allowMultiple" color="success" hide-details />
        </div>
      </VCardText>

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn variant="tonal" color="secondary" @click="isVisible = false">
          {{ t('cancel', 'Cancelar') }}
        </VBtn>
        <VBtn color="success" :disabled="!canSend" @click="handleSend">
          <VIcon class="me-1">tabler-send</VIcon>
          {{ t('send', 'Enviar') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style lang="scss" scoped>
.cursor-move {
  cursor: move;
}

.emoji-picker-wrap {
  background: rgb(var(--v-theme-surface));
  border-radius: 8px;
  padding: 8px;
}
</style>
