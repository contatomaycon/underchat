<script lang="ts" setup>
import { onMessage } from '@/@webcore/centrifugo';
import { ECentrifugoChannel } from '@core/common/enums/ECentrifugoChannel';
import { formatDateTimeSeconds } from '@core/common/functions/formatDateTimeSeconds';
import { IServerSshCentrifugo } from '@core/common/interfaces/IServerSshCentrifugo';

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  serverId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const serverId = toRef(props, 'serverId');

const items = ref<{ command: string; output: string; date: string }[]>([
  {
    command: t('installation_pending'),
    output: t('installation_pending'),
    date: formatDateTimeSeconds(new Date()),
  },
]);

const listContainer = ref<HTMLElement | null>(null);
const isLoading = ref(true);

const scrollToBottom = () => {
  nextTick(() => {
    if (listContainer.value) {
      listContainer.value.scrollTop = listContainer.value.scrollHeight;
    }
  });
};

watch(isVisible, (visible) => {
  if (visible) {
    items.value = [];
    isLoading.value = true;

    scrollToBottom();
  }
});

onMounted(() => {
  onMessage(ECentrifugoChannel.server_ssh, (data: IServerSshCentrifugo) => {
    if (data.server_id !== serverId.value) return;

    isLoading.value = false;
    items.value.push({
      command: data.command,
      output: data.output,
      date: formatDateTimeSeconds(data.date),
    });

    if (items.value.length > 200) {
      items.value.splice(0, items.value.length - 200);
    }

    scrollToBottom();
  });
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="isLoading">
      <VOverlay :model-value="isLoading" class="align-center justify-center">
        <VProgressCircular indeterminate size="32" />
      </VOverlay>
    </template>

    <VCard :title="$t('console_installation')">
      <VCardText>
        <div
          ref="listContainer"
          class="app-bar-search-list py-0"
          style="max-height: 60vh; overflow-y: auto"
        >
          <VList density="compact" v-show="items.length">
            <template v-for="item in items" :key="item.date + item.command">
              <VListItem>
                <VListItemTitle class="wrap-text">
                  <strong>{{ item.date }}:</strong> {{ item.command }}
                </VListItemTitle>
                <VListItemSubtitle class="wrap-text">
                  {{ item.output }}
                </VListItemSubtitle>
              </VListItem>
            </template>
          </VList>
        </div>
      </VCardText>

      <VCardText class="d-flex justify-end gap-3">
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
