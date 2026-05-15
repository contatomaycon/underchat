<script setup lang="ts">
const { t } = useI18n();

type UserSectorItem = {
  sector_id: string;
  name: string;
  color: string;
};

const props = defineProps<{
  modelValue: boolean;
  userName: string | null;
  sectors: UserSectorItem[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const modalTitle = computed(() => {
  if (!props.userName) {
    return t('sector');
  }

  return `${t('sector')} - ${props.userName}`;
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="620">
    <DialogCloseBtn @click="isVisible = false" />

    <VCard :title="modalTitle">
      <VCardText>
        <div v-if="sectors.length" class="d-flex flex-wrap gap-2">
          <VChip
            v-for="sector in sectors"
            :key="sector.sector_id"
            :style="{
              backgroundColor: sector.color,
              color: 'white',
            }"
          >
            {{ sector.name }}
          </VChip>
        </div>

        <VAlert v-else type="info" variant="tonal" density="compact">
          {{ $t('no_data_available') }}
        </VAlert>
      </VCardText>

      <VCardText class="d-flex justify-end">
        <VBtn variant="tonal" color="secondary" @click="isVisible = false">
          {{ $t('close') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
