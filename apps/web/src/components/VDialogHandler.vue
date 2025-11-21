<script lang="ts" setup>
import { computed } from 'vue';

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const title = props.title;
const message = props.message;
const confirmText = props.confirmText ?? t('confirm');
const cancelText = props.cancelText ?? t('cancel');

function onConfirm() {
  emit('confirm');
  emit('update:modelValue', false);
}

function onCancel() {
  emit('cancel');
  emit('update:modelValue', false);
}
</script>

<template>
  <VDialog v-model="isVisible" persistent class="v-dialog-sm">
    <DialogCloseBtn @click="onCancel" />

    <VCard :title="title">
      <VCardText>{{ message }}</VCardText>

      <VCardText class="d-flex justify-end gap-3 flex-wrap">
        <VBtn color="secondary" variant="tonal" @click="onCancel">
          {{ cancelText }}
        </VBtn>
        <VBtn @click="onConfirm">
          {{ confirmText }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
