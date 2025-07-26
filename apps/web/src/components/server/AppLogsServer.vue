<script lang="ts" setup>
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  serverId: number | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const serverId = toRef(props, 'serverId');
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VCard :title="$t('console_installation')">
      <VCardText>
        <div
          ref="listContainer"
          class="app-bar-search-list py-0"
          style="max-height: 60vh; overflow-y: auto"
        >
          <VList v-show="items.length" density="compact">
            <template v-for="item in items" :key="item">
              <slot :item="item">
                <VListItem>
                  <VListItemTitle class="wrap-text">
                    <strong>{{ item.date }}:</strong>
                    {{ item.command }}
                  </VListItemTitle>
                  <VListItemSubtitle class="wrap-text">
                    {{ item.output }}
                  </VListItemSubtitle>
                </VListItem>
              </slot>
            </template>
          </VList>
        </div>
      </VCardText>

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn variant="tonal" color="secondary" @click="isVisible = false">
          {{ $t('close') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped>
.wrap-text {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
