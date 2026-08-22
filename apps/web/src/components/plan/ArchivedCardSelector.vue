<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ListUserCardResponse } from '@core/schema/plan/listUserCards/response.schema';

interface Props {
  cards: ListUserCardResponse[];
  loading?: boolean;
  restoringCardId?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  restoringCardId: null,
});

const emit = defineEmits<{
  reactivate: [cardId: string];
}>();

const { t } = useI18n();

const shouldRender = computed(() => props.loading || props.cards.length > 0);

const getMaskedCardNumber = (card: ListUserCardResponse): string => {
  return `**** ${card.last_number}`;
};
</script>

<template>
  <VCard v-if="shouldRender" variant="tonal" color="warning" class="mb-4">
    <VCardText>
      <div class="d-flex align-start gap-3 mb-3">
        <VIcon icon="tabler-history" size="24" />
        <div>
          <h6 class="text-subtitle-1 font-weight-medium">
            {{ t('archived_cards_title') }}
          </h6>
          <p class="text-body-2 text-medium-emphasis mb-0">
            {{ t('archived_cards_description') }}
          </p>
        </div>
      </div>

      <VSkeletonLoader v-if="loading" type="list-item-two-line" />

      <div v-else class="d-flex flex-column gap-2">
        <VCard
          v-for="card in cards"
          :key="card.user_card_id"
          variant="outlined"
        >
          <VCardText
            class="d-flex align-center justify-space-between gap-3 pa-3"
          >
            <div class="d-flex align-center gap-3">
              <VIcon icon="tabler-credit-card" size="24" />
              <div>
                <div class="text-body-2 font-weight-medium">
                  {{ getMaskedCardNumber(card) }}
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ card.holder_name }}
                  <template v-if="card.brand"> · {{ card.brand }} </template>
                </div>
              </div>
            </div>

            <VBtn
              color="primary"
              variant="tonal"
              size="small"
              :loading="restoringCardId === card.user_card_id"
              :disabled="!!restoringCardId"
              @click="emit('reactivate', card.user_card_id)"
            >
              {{ t('reactivate_and_use_card') }}
            </VBtn>
          </VCardText>
        </VCard>
      </div>
    </VCardText>
  </VCard>
</template>
