<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  OutboundWebhookEventDefinition,
  OutboundWebhookEventGroup,
} from '@/types/outboundWebhooks';

interface Props {
  groups: readonly OutboundWebhookEventGroup[];
  selectedEvents: readonly string[];
  disabled?: boolean;
}

interface Emits {
  'update:selectedEvents': [eventTypes: string[]];
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
});
const emit = defineEmits<Emits>();
const { t, te } = useI18n();

const selectedSet = computed(() => new Set(props.selectedEvents));
const selectableEventTypes = computed(() =>
  props.groups.flatMap((group) =>
    group.events.filter((event) => event.selectable).map((event) => event.type)
  )
);

const groupLabel = (group: OutboundWebhookEventGroup): string => {
  if (te(group.labelKey)) return t(group.labelKey);
  return group.label ?? group.key;
};

const groupHint = (group: OutboundWebhookEventGroup): string => {
  const key = `outbound_webhook_event_group_${group.key}_hint`;
  return te(key) ? t(key) : t('outbound_webhook_event_group_other_hint');
};

const eventDescription = (event: OutboundWebhookEventDefinition): string => {
  if (te(event.descriptionKey)) return t(event.descriptionKey);
  return event.description ?? event.type;
};

const selectableEvents = (
  group: OutboundWebhookEventGroup
): OutboundWebhookEventDefinition[] =>
  group.events.filter((event) => event.selectable);

const selectedCount = (group: OutboundWebhookEventGroup): number =>
  selectableEvents(group).filter((event) => selectedSet.value.has(event.type))
    .length;

const isGroupSelected = (group: OutboundWebhookEventGroup): boolean => {
  const events = selectableEvents(group);
  return events.length > 0 && selectedCount(group) === events.length;
};

const isGroupIndeterminate = (group: OutboundWebhookEventGroup): boolean => {
  const count = selectedCount(group);
  return count > 0 && count < selectableEvents(group).length;
};

const emitSelection = (selection: Set<string>) => {
  emit(
    'update:selectedEvents',
    selectableEventTypes.value.filter((type) => selection.has(type))
  );
};

const toggleEvent = (
  event: OutboundWebhookEventDefinition,
  selected: boolean
) => {
  if (props.disabled || !event.selectable) return;
  const next = new Set(selectedSet.value);
  if (selected) next.add(event.type);
  else next.delete(event.type);
  emitSelection(next);
};

const toggleGroup = (group: OutboundWebhookEventGroup, selected: boolean) => {
  if (props.disabled) return;
  const next = new Set(selectedSet.value);
  selectableEvents(group).forEach((event) => {
    if (selected) next.add(event.type);
    else next.delete(event.type);
  });
  emitSelection(next);
};
</script>

<template>
  <div class="event-selector">
    <section v-for="group in props.groups" :key="group.key" class="event-group">
      <header class="event-group__header">
        <div>
          <div class="event-group__title-row">
            <h4 class="event-group__title">
              {{ groupLabel(group) }}
            </h4>
            <VChip size="x-small" variant="tonal" color="secondary">
              {{ selectedCount(group) }}/{{ selectableEvents(group).length }}
            </VChip>
          </div>
          <p class="event-group__hint">
            {{ groupHint(group) }}
          </p>
        </div>

        <VCheckboxBtn
          v-if="selectableEvents(group).length"
          :model-value="isGroupSelected(group)"
          :indeterminate="isGroupIndeterminate(group)"
          :disabled="props.disabled"
          :aria-label="
            $t('outbound_webhook_select_group', { group: groupLabel(group) })
          "
          @update:model-value="toggleGroup(group, Boolean($event))"
        />
      </header>

      <div class="event-group__events">
        <div
          v-for="event in group.events"
          :key="event.type"
          class="event-option"
          :class="{ 'event-option--control': !event.selectable }"
        >
          <div class="event-option__copy">
            <div class="event-option__name-row">
              <code class="event-option__name">{{ event.type }}</code>
              <VChip
                v-if="event.fallback"
                size="x-small"
                variant="tonal"
                color="warning"
              >
                {{ $t('outbound_webhook_fallback_event') }}
              </VChip>
              <VChip
                v-if="!event.selectable"
                size="x-small"
                variant="tonal"
                prepend-icon="tabler-lock"
              >
                {{ $t('outbound_webhook_control_event') }}
              </VChip>
            </div>
            <p class="event-option__description">
              {{ eventDescription(event) }}
            </p>
          </div>

          <VSwitch
            :model-value="selectedSet.has(event.type)"
            :disabled="props.disabled || !event.selectable"
            :aria-label="
              $t('outbound_webhook_toggle_event', { event: event.type })
            "
            color="primary"
            density="compact"
            hide-details
            @update:model-value="toggleEvent(event, Boolean($event))"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.event-selector {
  display: grid;
  gap: 0.85rem;
}

.event-group {
  overflow: hidden;
  border: 1px solid rgb(var(--v-theme-on-surface), 0.1);
  border-radius: 13px;
  background: rgb(var(--v-theme-surface));
}

.event-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-block: 0.8rem;
  padding-inline: 1rem;
  border-block-end: 1px solid rgb(var(--v-theme-on-surface), 0.075);
  background: rgb(var(--v-theme-on-surface), 0.025);
}

.event-group__title-row,
.event-option__name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.event-group__title {
  margin: 0;
  color: rgb(var(--v-theme-on-surface), 0.88);
  font-size: 0.82rem;
  font-weight: 750;
  letter-spacing: 0.015em;
}

.event-group__hint {
  margin-block: 0.18rem 0;
  margin-inline: 0;
  color: rgb(var(--v-theme-on-surface), 0.52);
  font-size: 0.72rem;
  line-height: 1.45;
}

.event-group__events {
  display: grid;
}

.event-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-block: 0.75rem;
  padding-inline: 1rem;
}

.event-option + .event-option {
  border-block-start: 1px solid rgb(var(--v-theme-on-surface), 0.065);
}

.event-option--control {
  background: rgb(var(--v-theme-on-surface), 0.018);
}

.event-option__copy {
  min-inline-size: 0;
}

.event-option__name {
  color: rgb(var(--v-theme-primary));
  font-size: 0.75rem;
  font-weight: 650;
}

.event-option__description {
  margin-block: 0.28rem 0;
  margin-inline: 0;
  color: rgb(var(--v-theme-on-surface), 0.57);
  font-size: 0.73rem;
  line-height: 1.48;
}

@media (max-width: 599px) {
  .event-group__header,
  .event-option {
    padding-inline: 0.8rem;
  }
}
</style>
