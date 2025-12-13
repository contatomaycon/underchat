<script setup lang="ts">
import { computed, onMounted, ref, nextTick, watch } from 'vue';
import VueApexCharts from 'vue3-apexcharts';

interface Props {
  title: string;
  color?: string;
  icon: string;
  stats: string;
  height: number;
  series: unknown[];
  chartOptions: unknown;
}

const props = withDefaults(defineProps<Props>(), {
  color: 'primary',
});

const isMounted = ref(false);
const chartKey = ref(0);

const hasValidChartData = computed(() => {
  return (
    props.series &&
    Array.isArray(props.series) &&
    props.series.length > 0 &&
    props.series[0] &&
    typeof props.series[0] === 'object' &&
    'data' in props.series[0] &&
    Array.isArray(props.series[0].data) &&
    props.series[0].data.length > 0
  );
});

const shouldRenderChart = computed(() => {
  return isMounted.value && hasValidChartData.value;
});

onMounted(async () => {
  await nextTick();
  isMounted.value = true;
});

watch(
  () => [props.series, props.chartOptions],
  () => {
    if (isMounted.value && hasValidChartData.value) {
      chartKey.value += 1;
    }
  },
  { deep: true }
);
</script>

<template>
  <VCard>
    <VCardText class="d-flex flex-column pb-0">
      <VAvatar
        v-if="props.icon"
        size="42"
        variant="tonal"
        :color="props.color"
        rounded
        class="mb-2"
      >
        <VIcon :icon="props.icon" size="26" />
      </VAvatar>

      <h5 class="text-h5">
        {{ props.stats }}
      </h5>
      <div class="text-sm">
        {{ props.title }}
      </div>
    </VCardText>

    <div v-if="shouldRenderChart" :key="chartKey">
      <VueApexCharts
        :series="props.series"
        :options="props.chartOptions"
        :height="props.height"
      />
    </div>
  </VCard>
</template>
