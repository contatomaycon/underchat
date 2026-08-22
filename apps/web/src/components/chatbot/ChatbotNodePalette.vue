<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import {
  useChatbotNodePalette,
  type ChatbotNodePaletteBounds,
} from '@/composables/useChatbotNodePalette';
import type {
  ChatbotNodePaletteCategory,
  ChatbotNodePaletteCategoryId,
  ChatbotNodePaletteItem,
} from '@/types/chatbotNodePalette';

interface ChatbotNodePaletteProps {
  items: ChatbotNodePaletteItem[];
  categories: ChatbotNodePaletteCategory[];
  containerElement: HTMLElement | null;
  storageKey: string;
  isMobile?: boolean;
}

interface PanelDragState {
  pointerId: number;
  startX: number;
  startY: number;
  positionX: number;
  positionY: number;
  captureTarget: HTMLElement;
}

interface CategoryRailDragState {
  pointerId: number;
  startX: number;
  startScrollLeft: number;
  hasMoved: boolean;
  captureTarget: HTMLElement;
}

const PALETTE_WIDTH = 400;
const PALETTE_FALLBACK_HEIGHT = 548;
const CLICK_SUPPRESSION_MS = 220;
const CATEGORY_DRAG_THRESHOLD_PX = 4;
const CATEGORY_CLICK_SUPPRESSION_MS = 180;

const props = withDefaults(defineProps<ChatbotNodePaletteProps>(), {
  isMobile: false,
});

const emit = defineEmits<{
  create: [itemId: string];
  dragStart: [itemId: string, event: DragEvent];
  dragEnd: [];
}>();

const { t, locale } = useI18n();
const paletteRef = useTemplateRef<HTMLElement>('paletteRef');
const categoryRailRef = useTemplateRef<HTMLElement>('categoryRailRef');
const searchQuery = shallowRef('');
const activeCategoryId = shallowRef<ChatbotNodePaletteCategoryId | 'all'>(
  'all'
);
const panelDragState = shallowRef<PanelDragState | null>(null);
const categoryRailDragState = shallowRef<CategoryRailDragState | null>(null);
const draggedItemId = shallowRef<string | null>(null);
const suppressClickForItemId = shallowRef<string | null>(null);
const suppressClickUntil = shallowRef(0);
const suppressCategoryClickUntil = shallowRef(0);
const canScrollCategoriesBackward = shallowRef(false);
const canScrollCategoriesForward = shallowRef(false);

const { position, isMinimized, minimize, restore, setPosition, resetPosition } =
  useChatbotNodePalette({
    storageKey: props.storageKey,
  });

const normalizedSearchQuery = computed(() =>
  searchQuery.value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
);

const visibleItems = computed(() => {
  const query = normalizedSearchQuery.value;

  return props.items.filter((item) => {
    const matchesCategory =
      activeCategoryId.value === 'all' ||
      item.category === activeCategoryId.value;
    const matchesSearch =
      !query ||
      item.label
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .includes(query);

    return matchesCategory && matchesSearch;
  });
});

const palettePositionStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
}));

const compactTriggerStyle = computed(() =>
  props.isMobile
    ? undefined
    : {
        ...palettePositionStyle.value,
      }
);

const categoryLabel = (category: ChatbotNodePaletteCategory) => {
  const key = `chatbot_palette_${category.id}`;
  const translated = String(t(key));

  return translated === key ? category.label : translated;
};

const getPaletteBounds = (
  fallbackWidth = PALETTE_WIDTH,
  fallbackHeight = PALETTE_FALLBACK_HEIGHT
): ChatbotNodePaletteBounds | undefined => {
  const containerRect = props.containerElement?.getBoundingClientRect();
  if (!containerRect) {
    return undefined;
  }

  const panelRect = paletteRef.value?.getBoundingClientRect();

  return {
    containerWidth: containerRect.width,
    containerHeight: containerRect.height,
    panelWidth: panelRect?.width || fallbackWidth,
    panelHeight: panelRect?.height || fallbackHeight,
  };
};

const clampToContainer = () => {
  if (props.isMobile) {
    return;
  }

  const bounds = getPaletteBounds();
  if (bounds) {
    setPosition(position.value, bounds);
  }
};

const handleHeaderPointerDown = (event: PointerEvent) => {
  if (props.isMobile || event.button !== 0) {
    return;
  }

  const captureTarget = event.currentTarget as HTMLElement;
  captureTarget.setPointerCapture(event.pointerId);
  panelDragState.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    positionX: position.value.x,
    positionY: position.value.y,
    captureTarget,
  };
};

const handlePanelPointerMove = (event: PointerEvent) => {
  const dragState = panelDragState.value;
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  const bounds = getPaletteBounds();
  setPosition(
    {
      x: dragState.positionX + event.clientX - dragState.startX,
      y: dragState.positionY + event.clientY - dragState.startY,
    },
    bounds
  );
};

const finishHeaderDrag = (event?: PointerEvent) => {
  const dragState = panelDragState.value;
  if (!dragState || (event && event.pointerId !== dragState.pointerId)) {
    return;
  }

  if (dragState.captureTarget.hasPointerCapture(dragState.pointerId)) {
    dragState.captureTarget.releasePointerCapture(dragState.pointerId);
  }

  panelDragState.value = null;
};

const handleResetPosition = () => {
  resetPosition(getPaletteBounds());
};

const handleRestore = async () => {
  restore();
  await nextTick();
  clampToContainer();
};

const handleCardClick = (itemId: string) => {
  const shouldSuppress =
    suppressClickForItemId.value === itemId &&
    Date.now() <= suppressClickUntil.value;

  if (shouldSuppress) {
    return;
  }

  emit('create', itemId);
};

const handleCardDragStart = (event: DragEvent, itemId: string) => {
  draggedItemId.value = itemId;
  suppressClickForItemId.value = itemId;
  suppressClickUntil.value = Date.now() + CLICK_SUPPRESSION_MS;

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.dropEffect = 'move';
    event.dataTransfer.setData('text/plain', itemId);
    event.dataTransfer.setData('application/x-underchat-chatbot-node', itemId);
  }

  emit('dragStart', itemId, event);
};

const handleCardDragEnd = () => {
  draggedItemId.value = null;
  suppressClickUntil.value = Date.now() + CLICK_SUPPRESSION_MS;
  emit('dragEnd');
};

const updateCategoryScrollState = () => {
  const rail = categoryRailRef.value;
  if (!rail) {
    canScrollCategoriesBackward.value = false;
    canScrollCategoriesForward.value = false;
    return;
  }

  const maximumScrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
  const tolerance = 1;

  canScrollCategoriesBackward.value = rail.scrollLeft > tolerance;
  canScrollCategoriesForward.value =
    rail.scrollLeft < maximumScrollLeft - tolerance;
};

const categoryScrollBehavior = (): ScrollBehavior =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';

const scrollCategories = (direction: -1 | 1) => {
  const rail = categoryRailRef.value;
  if (!rail) {
    return;
  }

  rail.scrollBy({
    left: direction * Math.max(132, Math.round(rail.clientWidth * 0.72)),
    behavior: categoryScrollBehavior(),
  });
};

const handleCategoryRailPointerDown = (event: PointerEvent) => {
  if (event.button !== 0 && event.pointerType === 'mouse') {
    return;
  }

  // A category remains a normal button: capturing its pointer on the rail can
  // prevent the browser from dispatching the final click to that button.
  if (
    event.target instanceof Element &&
    event.target.closest('.chatbot-node-palette__category')
  ) {
    return;
  }

  const captureTarget = event.currentTarget as HTMLElement;
  captureTarget.setPointerCapture(event.pointerId);
  categoryRailDragState.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startScrollLeft: captureTarget.scrollLeft,
    hasMoved: false,
    captureTarget,
  };
};

const handleCategoryRailPointerMove = (event: PointerEvent) => {
  const dragState = categoryRailDragState.value;
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  const deltaX = dragState.startX - event.clientX;
  if (Math.abs(deltaX) > CATEGORY_DRAG_THRESHOLD_PX) {
    dragState.hasMoved = true;
    dragState.captureTarget.scrollLeft = dragState.startScrollLeft + deltaX;
    updateCategoryScrollState();
    event.preventDefault();
  }
};

const finishCategoryRailDrag = (event?: PointerEvent) => {
  const dragState = categoryRailDragState.value;
  if (!dragState || (event && event.pointerId !== dragState.pointerId)) {
    return;
  }

  if (dragState.captureTarget.hasPointerCapture(dragState.pointerId)) {
    dragState.captureTarget.releasePointerCapture(dragState.pointerId);
  }

  if (dragState.hasMoved) {
    suppressCategoryClickUntil.value =
      Date.now() + CATEGORY_CLICK_SUPPRESSION_MS;
  }

  categoryRailDragState.value = null;
};

const handleCategoryRailWheel = (event: WheelEvent) => {
  const rail = categoryRailRef.value;
  if (!rail) {
    return;
  }

  const deltaX = event.shiftKey ? event.deltaY : event.deltaX;
  if (!deltaX) {
    return;
  }

  const maximumScrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
  const nextScrollLeft = Math.min(
    maximumScrollLeft,
    Math.max(0, rail.scrollLeft + deltaX)
  );

  if (nextScrollLeft === rail.scrollLeft) {
    return;
  }

  rail.scrollLeft = nextScrollLeft;
  updateCategoryScrollState();
  event.preventDefault();
};

const handleCategoryRailKeydown = (event: KeyboardEvent) => {
  const rail = categoryRailRef.value;
  if (!rail) {
    return;
  }

  if (event.key === 'Home') {
    rail.scrollTo({ left: 0, behavior: categoryScrollBehavior() });
    event.preventDefault();
    return;
  }

  if (event.key === 'End') {
    rail.scrollTo({
      left: rail.scrollWidth - rail.clientWidth,
      behavior: categoryScrollBehavior(),
    });
    event.preventDefault();
    return;
  }

  if (event.key === 'ArrowLeft') {
    scrollCategories(-1);
    event.preventDefault();
    return;
  }

  if (event.key === 'ArrowRight') {
    scrollCategories(1);
    event.preventDefault();
  }
};

const handleCategorySelection = (
  categoryId: ChatbotNodePaletteCategoryId | 'all'
) => {
  if (Date.now() <= suppressCategoryClickUntil.value) {
    return;
  }

  activeCategoryId.value = categoryId;
};

let resizeObserver: ResizeObserver | undefined;
let categoryRailResizeObserver: ResizeObserver | undefined;

const observeContainer = (container: HTMLElement | null) => {
  resizeObserver?.disconnect();
  resizeObserver = undefined;

  if (!container || typeof ResizeObserver === 'undefined') {
    return;
  }

  resizeObserver = new ResizeObserver(() => {
    clampToContainer();
  });
  resizeObserver.observe(container);
};

const observeCategoryRail = () => {
  categoryRailResizeObserver?.disconnect();
  categoryRailResizeObserver = undefined;

  const rail = categoryRailRef.value;
  if (!rail || typeof ResizeObserver === 'undefined') {
    return;
  }

  categoryRailResizeObserver = new ResizeObserver(updateCategoryScrollState);
  categoryRailResizeObserver.observe(rail);
};

watch(
  () => props.containerElement,
  (container) => {
    observeContainer(container);
    nextTick(clampToContainer);
  },
  { immediate: true }
);

watch(
  () => [props.isMobile, isMinimized.value],
  () => {
    nextTick(() => {
      clampToContainer();
      observeCategoryRail();
      updateCategoryScrollState();
    });
  }
);

watch(
  [() => props.categories, locale],
  () => {
    nextTick(updateCategoryScrollState);
  },
  { deep: true }
);

onMounted(() => {
  nextTick(() => {
    clampToContainer();
    observeCategoryRail();
    updateCategoryScrollState();
  });
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  categoryRailResizeObserver?.disconnect();
});
</script>

<template>
  <div class="chatbot-node-palette">
    <Transition name="chatbot-palette-surface">
      <div
        v-if="!isMinimized"
        class="chatbot-node-palette__layer"
        :class="{ 'chatbot-node-palette__layer--mobile': props.isMobile }"
      >
        <div
          v-if="props.isMobile"
          class="chatbot-node-palette__backdrop"
          aria-hidden="true"
        />

        <section
          ref="paletteRef"
          class="chatbot-node-palette__surface"
          :class="{
            'chatbot-node-palette__surface--mobile': props.isMobile,
            'is-dragging-panel': panelDragState !== null,
          }"
          :style="props.isMobile ? undefined : palettePositionStyle"
          data-testid="chatbot-node-palette"
          :aria-label="t('chatbot_palette_title')"
          @pointermove="handlePanelPointerMove"
          @pointerup="finishHeaderDrag"
          @pointercancel="finishHeaderDrag"
        >
          <header class="chatbot-node-palette__header">
            <button
              v-if="!props.isMobile"
              type="button"
              class="chatbot-node-palette__drag-handle"
              :aria-label="t('chatbot_palette_title')"
              :title="t('chatbot_palette_title')"
              data-testid="chatbot-node-palette-drag-handle"
              @pointerdown.stop.prevent="handleHeaderPointerDown"
            >
              <VIcon icon="tabler-grip-vertical" size="19" aria-hidden="true" />
            </button>

            <div class="chatbot-node-palette__heading">
              <div class="chatbot-node-palette__eyebrow">
                <VIcon icon="tabler-components" size="15" aria-hidden="true" />
                <span>{{ t('chatbot_palette_title') }}</span>
              </div>
              <p class="chatbot-node-palette__hint">
                {{ t('chatbot_palette_hint') }}
              </p>
            </div>

            <div class="chatbot-node-palette__header-actions">
              <button
                v-if="!props.isMobile"
                type="button"
                class="chatbot-node-palette__icon-button"
                :aria-label="t('chatbot_palette_reset_position')"
                :title="t('chatbot_palette_reset_position')"
                data-testid="chatbot-node-palette-reset"
                @click="handleResetPosition"
              >
                <VIcon
                  icon="tabler-focus-centered"
                  size="18"
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                class="chatbot-node-palette__icon-button"
                :aria-label="t('chatbot_palette_minimize')"
                :title="t('chatbot_palette_minimize')"
                data-testid="chatbot-node-palette-minimize"
                @click="minimize"
              >
                <VIcon icon="tabler-minus" size="18" aria-hidden="true" />
              </button>
            </div>
          </header>

          <div class="chatbot-node-palette__content">
            <label class="chatbot-node-palette__search">
              <VIcon icon="tabler-search" size="18" aria-hidden="true" />
              <input
                v-model="searchQuery"
                type="search"
                class="chatbot-node-palette__search-input"
                :placeholder="t('chatbot_palette_search')"
                :aria-label="t('chatbot_palette_search')"
                data-testid="chatbot-node-palette-search"
              />
            </label>

            <div
              class="chatbot-node-palette__categories-shell"
              :class="{
                'has-scroll-backward': canScrollCategoriesBackward,
                'has-scroll-forward': canScrollCategoriesForward,
              }"
            >
              <button
                v-if="canScrollCategoriesBackward"
                type="button"
                class="chatbot-node-palette__category-scroll-control chatbot-node-palette__category-scroll-control--backward"
                :aria-label="`${t('previous')}: ${t('chatbot_palette_title')}`"
                aria-controls="chatbot-node-palette-categories"
                data-testid="chatbot-node-palette-scroll-backward"
                @click="scrollCategories(-1)"
              >
                <VIcon
                  icon="tabler-chevron-left"
                  size="17"
                  aria-hidden="true"
                />
              </button>

              <nav
                id="chatbot-node-palette-categories"
                ref="categoryRailRef"
                class="chatbot-node-palette__categories"
                :class="{
                  'is-dragging-categories': categoryRailDragState?.hasMoved,
                }"
                :aria-label="t('chatbot_palette_title')"
                @scroll.passive="updateCategoryScrollState"
                @wheel="handleCategoryRailWheel"
                @pointerdown="handleCategoryRailPointerDown"
                @pointermove="handleCategoryRailPointerMove"
                @pointerup="finishCategoryRailDrag"
                @pointercancel="finishCategoryRailDrag"
                @keydown="handleCategoryRailKeydown"
              >
                <button
                  type="button"
                  class="chatbot-node-palette__category"
                  :class="{ 'is-active': activeCategoryId === 'all' }"
                  :aria-pressed="activeCategoryId === 'all'"
                  data-testid="chatbot-node-palette-category-all"
                  @click="handleCategorySelection('all')"
                >
                  {{ t('chatbot_palette_all') }}
                </button>
                <button
                  v-for="category in props.categories"
                  :key="category.id"
                  type="button"
                  class="chatbot-node-palette__category"
                  :class="{ 'is-active': activeCategoryId === category.id }"
                  :aria-pressed="activeCategoryId === category.id"
                  :data-testid="`chatbot-node-palette-category-${category.id}`"
                  @click="handleCategorySelection(category.id)"
                >
                  <VIcon :icon="category.icon" size="15" aria-hidden="true" />
                  <span>{{ categoryLabel(category) }}</span>
                </button>
              </nav>

              <button
                v-if="canScrollCategoriesForward"
                type="button"
                class="chatbot-node-palette__category-scroll-control chatbot-node-palette__category-scroll-control--forward"
                :aria-label="`${t('next')}: ${t('chatbot_palette_title')}`"
                aria-controls="chatbot-node-palette-categories"
                data-testid="chatbot-node-palette-scroll-forward"
                @click="scrollCategories(1)"
              >
                <VIcon
                  icon="tabler-chevron-right"
                  size="17"
                  aria-hidden="true"
                />
              </button>
            </div>

            <div
              v-if="visibleItems.length"
              class="chatbot-node-palette__grid"
              role="list"
            >
              <div
                v-for="item in visibleItems"
                :key="item.id"
                class="chatbot-node-palette__grid-item"
                role="listitem"
              >
                <button
                  type="button"
                  class="chatbot-node-palette__node-card"
                  :class="[
                    `is-tone-${item.tone}`,
                    { 'is-dragging-card': draggedItemId === item.id },
                  ]"
                  draggable="true"
                  :data-testid="`chatbot-node-palette-card-${item.id}`"
                  :title="item.label"
                  @click="handleCardClick(item.id)"
                  @dragstart="handleCardDragStart($event, item.id)"
                  @dragend="handleCardDragEnd"
                >
                  <span
                    class="chatbot-node-palette__node-icon"
                    aria-hidden="true"
                  >
                    <VIcon :icon="item.icon" size="19" />
                  </span>
                  <span class="chatbot-node-palette__node-label">{{
                    item.label
                  }}</span>
                  <VIcon
                    icon="tabler-grip-vertical"
                    size="17"
                    class="chatbot-node-palette__node-grip"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>

            <div
              v-else
              class="chatbot-node-palette__empty"
              data-testid="chatbot-node-palette-empty"
              role="status"
            >
              <VIcon icon="tabler-search-off" size="22" aria-hidden="true" />
              <span>{{ t('chatbot_palette_no_results') }}</span>
            </div>
          </div>
        </section>
      </div>
    </Transition>

    <Transition name="chatbot-palette-trigger">
      <div
        v-if="isMinimized"
        class="chatbot-node-palette__layer chatbot-node-palette__layer--trigger"
        :class="{ 'chatbot-node-palette__layer--mobile': props.isMobile }"
      >
        <button
          type="button"
          class="chatbot-node-palette__restore-button"
          :class="{
            'chatbot-node-palette__restore-button--mobile': props.isMobile,
          }"
          :style="compactTriggerStyle"
          data-testid="chatbot-node-palette-restore"
          @click="handleRestore"
        >
          <span class="chatbot-node-palette__restore-icon" aria-hidden="true">
            <VIcon icon="tabler-plus" size="18" />
          </span>
          <span>{{ t('chatbot_palette_restore') }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.chatbot-node-palette {
  --palette-surface: rgba(var(--v-theme-surface), 0.96);
  --palette-ink: rgb(var(--v-theme-on-surface));
  --palette-muted: rgba(var(--v-theme-on-surface), 0.58);
  --palette-line: rgba(var(--v-theme-on-surface), 0.1);
  --palette-shadow:
    0 22px 48px rgba(29, 38, 58, 0.16), 0 3px 10px rgba(29, 38, 58, 0.08);
  position: absolute;
  z-index: 18;
  inset: 0;
  pointer-events: none;
}

.chatbot-node-palette__layer {
  position: absolute;
  z-index: 1;
  inset: 0;
  pointer-events: none;
}

.chatbot-node-palette__layer--trigger {
  z-index: 2;
}

.chatbot-node-palette__surface {
  position: absolute;
  display: flex;
  overflow: hidden;
  flex-direction: column;
  width: min(400px, calc(100% - 24px));
  max-height: min(610px, calc(100% - 24px));
  border: 1px solid var(--palette-line);
  border-radius: 18px;
  background: var(--palette-surface);
  box-shadow: var(--palette-shadow);
  color: var(--palette-ink);
  isolation: isolate;
  pointer-events: auto;
  backdrop-filter: blur(18px) saturate(1.08);
}

.chatbot-node-palette__surface::before {
  position: absolute;
  z-index: -1;
  inline-size: 170px;
  block-size: 170px;
  border-radius: 50%;
  background: rgba(var(--v-theme-primary), 0.09);
  content: '';
  filter: blur(1px);
  inset: -85px -70px auto auto;
  pointer-events: none;
}

.chatbot-node-palette__surface--mobile {
  inset: auto 12px 12px;
  width: auto;
  max-height: min(620px, calc(100% - 24px));
  border-radius: 22px;
}

.chatbot-node-palette__surface.is-dragging-panel {
  cursor: grabbing;
  user-select: none;
}

.chatbot-node-palette__backdrop {
  position: absolute;
  z-index: 0;
  background: rgba(20, 27, 45, 0.18);
  inset: 0;
  pointer-events: auto;
  backdrop-filter: blur(2px);
}

.chatbot-node-palette__header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 16px 15px 13px;
  border-block-end: 1px solid var(--palette-line);
}

.chatbot-node-palette__drag-handle,
.chatbot-node-palette__icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--palette-muted);
  cursor: pointer;
}

.chatbot-node-palette__drag-handle {
  width: 28px;
  height: 32px;
  margin: -3px 0 -3px -6px;
  cursor: grab;
  touch-action: none;
}

.chatbot-node-palette__drag-handle:focus-visible,
.chatbot-node-palette__icon-button:focus-visible,
.chatbot-node-palette__category-scroll-control:focus-visible,
.chatbot-node-palette__category:focus-visible,
.chatbot-node-palette__node-card:focus-visible,
.chatbot-node-palette__restore-button:focus-visible,
.chatbot-node-palette__search:focus-within {
  outline: 3px solid rgba(var(--v-theme-primary), 0.28);
  outline-offset: 2px;
}

.chatbot-node-palette__drag-handle:active {
  cursor: grabbing;
}

.chatbot-node-palette__icon-button {
  width: 31px;
  height: 31px;
}

.chatbot-node-palette__icon-button:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgb(var(--v-theme-primary));
}

.chatbot-node-palette__heading {
  min-width: 0;
  flex: 1;
}

.chatbot-node-palette__eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.78rem;
  font-weight: 750;
  letter-spacing: 0.045em;
  line-height: 1.2;
  text-transform: uppercase;
}

.chatbot-node-palette__hint {
  margin: 4px 0 0;
  color: var(--palette-muted);
  font-size: 0.77rem;
  line-height: 1.35;
}

.chatbot-node-palette__header-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
  margin: -2px -4px 0 0;
}

.chatbot-node-palette__content {
  display: flex;
  overflow: hidden auto;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 13px;
  min-height: 0;
  padding: 13px 14px 15px;
  scrollbar-color: rgba(var(--v-theme-on-surface), 0.22) transparent;
  scrollbar-width: thin;
}

.chatbot-node-palette__content::-webkit-scrollbar {
  width: 7px;
}

.chatbot-node-palette__content::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.22);
  background-clip: padding-box;
}

.chatbot-node-palette__search {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 11px;
  border: 1px solid var(--palette-line);
  border-radius: 11px;
  background: rgba(var(--v-theme-on-surface), 0.025);
  color: var(--palette-muted);
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    box-shadow 160ms ease;
}

.chatbot-node-palette__search:hover,
.chatbot-node-palette__search:focus-within {
  border-color: rgba(var(--v-theme-primary), 0.36);
  background: rgba(var(--v-theme-primary), 0.035);
}

.chatbot-node-palette__search-input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--palette-ink);
  font: inherit;
  font-size: 0.82rem;
}

.chatbot-node-palette__search-input::placeholder {
  color: var(--palette-muted);
  opacity: 1;
}

.chatbot-node-palette__categories-shell {
  position: relative;
  min-width: 0;
  margin: 0 -1px;
  isolation: isolate;
}

.chatbot-node-palette__categories-shell::before,
.chatbot-node-palette__categories-shell::after {
  position: absolute;
  z-index: 2;
  top: 0;
  bottom: 2px;
  width: 38px;
  content: '';
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms ease;
}

.chatbot-node-palette__categories-shell::before {
  left: 0;
  background: linear-gradient(90deg, var(--palette-surface) 35%, transparent);
}

.chatbot-node-palette__categories-shell::after {
  right: 0;
  background: linear-gradient(270deg, var(--palette-surface) 35%, transparent);
}

.chatbot-node-palette__categories-shell.has-scroll-backward::before,
.chatbot-node-palette__categories-shell.has-scroll-forward::after {
  opacity: 1;
}

.chatbot-node-palette__categories {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 0 1px 3px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-behavior: smooth;
  scroll-padding-inline: 34px;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
  touch-action: pan-y;
  user-select: none;
  -webkit-overflow-scrolling: touch;
}

.chatbot-node-palette__categories-shell.has-scroll-backward
  .chatbot-node-palette__categories {
  padding-inline-start: 34px;
}

.chatbot-node-palette__categories-shell.has-scroll-forward
  .chatbot-node-palette__categories {
  padding-inline-end: 34px;
}

.chatbot-node-palette__categories::-webkit-scrollbar {
  display: none;
}

.chatbot-node-palette__categories.is-dragging-categories {
  cursor: grabbing;
  scroll-snap-type: none;
}

.chatbot-node-palette__category-scroll-control {
  position: absolute;
  z-index: 3;
  top: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 27px;
  height: 27px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 50%;
  background: var(--palette-surface);
  box-shadow: 0 3px 9px rgba(29, 38, 58, 0.14);
  color: var(--palette-muted);
  cursor: pointer;
  transform: translateY(-50%);
  transition:
    color 150ms ease,
    border-color 150ms ease,
    box-shadow 150ms ease,
    transform 150ms ease;
}

.chatbot-node-palette__category-scroll-control--backward {
  left: 2px;
}

.chatbot-node-palette__category-scroll-control--forward {
  right: 2px;
}

.chatbot-node-palette__category-scroll-control:hover {
  border-color: rgba(var(--v-theme-primary), 0.32);
  box-shadow: 0 5px 12px rgba(var(--v-theme-primary), 0.18);
  color: rgb(var(--v-theme-primary));
  transform: translateY(-50%) scale(1.06);
}

.chatbot-node-palette__category {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 5px;
  min-height: 29px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.045);
  color: var(--palette-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.7rem;
  font-weight: 650;
  line-height: 1;
  scroll-snap-align: start;
  white-space: nowrap;
  transition:
    transform 150ms ease,
    border-color 150ms ease,
    background-color 150ms ease,
    color 150ms ease;
}

.chatbot-node-palette__category:hover {
  border-color: rgba(var(--v-theme-primary), 0.2);
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}

.chatbot-node-palette__category.is-active {
  border-color: rgba(var(--v-theme-primary), 0.25);
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  box-shadow: 0 5px 12px rgba(var(--v-theme-primary), 0.2);
}

.chatbot-node-palette__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
}

.chatbot-node-palette__grid-item {
  min-width: 0;
}

.chatbot-node-palette__node-card {
  --node-tone: var(--v-theme-primary);
  display: grid;
  align-items: center;
  grid-template-columns: auto minmax(0, 1fr) auto;
  width: 100%;
  min-height: 57px;
  gap: 8px;
  padding: 8px;
  border: 1px solid rgba(var(--node-tone), 0.14);
  border-radius: 12px;
  background: linear-gradient(
    135deg,
    rgba(var(--node-tone), 0.075),
    rgba(var(--node-tone), 0.025)
  );
  color: var(--palette-ink);
  cursor: grab;
  font: inherit;
  text-align: start;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    background-color 160ms ease,
    box-shadow 160ms ease;
}

.chatbot-node-palette__node-card:hover {
  border-color: rgba(var(--node-tone), 0.35);
  background: linear-gradient(
    135deg,
    rgba(var(--node-tone), 0.13),
    rgba(var(--node-tone), 0.04)
  );
  box-shadow: 0 8px 17px rgba(var(--node-tone), 0.12);
  transform: translateY(-2px);
}

.chatbot-node-palette__node-card:active {
  cursor: grabbing;
  transform: translateY(0) scale(0.98);
}

.chatbot-node-palette__node-card.is-dragging-card {
  opacity: 0.56;
}

.chatbot-node-palette__node-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 31px;
  height: 31px;
  border-radius: 9px;
  background: rgba(var(--node-tone), 0.15);
  color: rgb(var(--node-tone));
}

.chatbot-node-palette__node-label {
  display: -webkit-box;
  overflow: hidden;
  color: var(--palette-ink);
  font-size: 0.73rem;
  font-weight: 700;
  line-height: 1.22;
  -webkit-box-orient: vertical;
  line-clamp: 2;
  -webkit-line-clamp: 2;
}

.chatbot-node-palette__node-grip {
  color: rgba(var(--node-tone), 0.52);
}

.chatbot-node-palette__node-card.is-tone-secondary {
  --node-tone: var(--v-theme-secondary);
}

.chatbot-node-palette__node-card.is-tone-success {
  --node-tone: var(--v-theme-success);
}

.chatbot-node-palette__node-card.is-tone-info {
  --node-tone: var(--v-theme-info);
}

.chatbot-node-palette__node-card.is-tone-warning {
  --node-tone: var(--v-theme-warning);
}

.chatbot-node-palette__node-card.is-tone-error {
  --node-tone: var(--v-theme-error);
}

.chatbot-node-palette__node-card.is-tone-randomMessage {
  --node-tone: var(--v-theme-randomMessage);
}

.chatbot-node-palette__node-card.is-tone-distribution {
  --node-tone: var(--v-theme-distribution);
}

.chatbot-node-palette__node-card.is-tone-tertiary {
  --node-tone: var(--v-theme-tertiary);
}

.chatbot-node-palette__node-card.is-tone-annotation {
  --node-tone: var(--v-theme-annotation);
}

.chatbot-node-palette__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 132px;
  gap: 9px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.18);
  border-radius: 13px;
  background: rgba(var(--v-theme-on-surface), 0.025);
  color: var(--palette-muted);
  font-size: 0.78rem;
  text-align: center;
}

.chatbot-node-palette__restore-button {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 13px 0 7px;
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  border-radius: 13px;
  background: var(--palette-surface);
  box-shadow: 0 10px 25px rgba(29, 38, 58, 0.16);
  color: var(--palette-ink);
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 750;
  pointer-events: auto;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.chatbot-node-palette__restore-button:hover {
  border-color: rgba(var(--v-theme-primary), 0.42);
  box-shadow: 0 13px 30px rgba(var(--v-theme-primary), 0.18);
  transform: translateY(-2px);
}

.chatbot-node-palette__restore-button--mobile {
  right: 14px;
  bottom: 14px;
  left: auto;
  top: auto;
}

.chatbot-node-palette__restore-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 29px;
  height: 29px;
  border-radius: 9px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.chatbot-palette-surface-enter-active,
.chatbot-palette-surface-leave-active,
.chatbot-palette-trigger-enter-active,
.chatbot-palette-trigger-leave-active {
  transition:
    opacity 180ms ease,
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.chatbot-palette-surface-enter-from,
.chatbot-palette-surface-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.975);
}

.chatbot-palette-trigger-enter-from,
.chatbot-palette-trigger-leave-to {
  opacity: 0;
  transform: translateY(7px) scale(0.94);
}

@media (max-width: 540px) {
  .chatbot-node-palette__surface--mobile {
    inset-inline: 8px;
    bottom: 8px;
    max-height: calc(100% - 16px);
    border-radius: 18px;
  }

  .chatbot-node-palette__header {
    padding: 14px 13px 11px;
  }

  .chatbot-node-palette__content {
    padding: 11px 12px 13px;
  }

  .chatbot-node-palette__restore-button--mobile {
    right: 10px;
    bottom: 10px;
  }
}
</style>
