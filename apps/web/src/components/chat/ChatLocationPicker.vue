<script lang="ts" setup>
import { ref, computed, watch, nextTick } from 'vue';
import { MglMap, MglMarker } from 'vue-maplibre-gl';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirm: [
    location: {
      latitude: number;
      longitude: number;
      name?: string | null;
      address?: string | null;
    },
  ];
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const locationPickerMode = ref<'current' | 'map' | 'manual'>('current');
const locationPickerLatitude = ref<number | null>(null);
const locationPickerLongitude = ref<number | null>(null);
const locationPickerName = ref<string>('');
const locationPickerAddress = ref<string>('');
const locationMapRef = ref<any>(null);
const locationInputLatitude = ref<string>('');
const locationInputLongitude = ref<string>('');

const mapStyle = computed(() => {
  return {
    version: 8,
    sources: {
      'osm-tiles': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [
      {
        id: 'osm-tiles-layer',
        type: 'raster',
        source: 'osm-tiles',
        minzoom: 0,
        maxzoom: 22,
      },
    ],
  };
});

const locationMapCenter = computed<[number, number]>(() => {
  if (
    locationPickerLatitude.value !== null &&
    locationPickerLongitude.value !== null
  ) {
    return [locationPickerLongitude.value, locationPickerLatitude.value];
  }
  return [0, 0];
});

const locationMarkerPosition = computed<[number, number]>(() => {
  if (
    locationPickerLatitude.value !== null &&
    locationPickerLongitude.value !== null
  ) {
    return [locationPickerLongitude.value, locationPickerLatitude.value];
  }
  return [0, 0];
});

const getCurrentLocation = (): Promise<GeolocationPosition> => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported'));
      return;
    }
    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    };
    navigator.geolocation.getCurrentPosition(resolve, reject, options); // NOSONAR: S5604 - Geolocalização é necessária para funcionalidade de envio de localização
  });
};

const useCurrentLocation = async () => {
  try {
    const position = await getCurrentLocation();
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    locationPickerLatitude.value = lat;
    locationPickerLongitude.value = lng;

    await nextTick();

    locationPickerMode.value = 'map';

    await nextTick();

    const updateMapCenter = () => {
      if (locationMapRef.value?.map) {
        const map = locationMapRef.value.map;
        map.setCenter([lng, lat]);
        return true;
      }
      return false;
    };

    if (updateMapCenter()) {
      return;
    }

    await nextTick();
    setTimeout(() => {
      if (updateMapCenter()) {
        return;
      }
      setTimeout(() => {
        updateMapCenter();
      }, 200);
    }, 100);
  } catch (error) {
    console.error('Error getting current location:', error);
  }
};

const onLocationMapClick = (event: any) => {
  if (!event?.lngLat) return;

  const lngLat = event.lngLat;
  locationPickerLatitude.value = lngLat.lat;
  locationPickerLongitude.value = lngLat.lng;
};

const useManualCoordinates = () => {
  const lat = Number.parseFloat(locationInputLatitude.value);
  const lng = Number.parseFloat(locationInputLongitude.value);

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return;
  }

  locationPickerLatitude.value = lat;
  locationPickerLongitude.value = lng;
  locationPickerMode.value = 'map';

  nextTick(() => {
    if (locationMapRef.value?.map) {
      const map = locationMapRef.value.map;
      const currentZoom = map.getZoom();
      map.setCenter([lng, lat]);
      map.setZoom(currentZoom);
    }
  });
};

const confirmLocation = async () => {
  if (!locationPickerLatitude.value || !locationPickerLongitude.value) {
    return;
  }

  emit('confirm', {
    latitude: locationPickerLatitude.value,
    longitude: locationPickerLongitude.value,
    name: locationPickerName.value || null,
    address: locationPickerAddress.value || null,
  });

  isOpen.value = false;
  locationPickerLatitude.value = null;
  locationPickerLongitude.value = null;
  locationPickerName.value = '';
  locationPickerAddress.value = '';
  locationInputLatitude.value = '';
  locationInputLongitude.value = '';
  locationPickerMode.value = 'current';
};

const getGeolocationCallbacks = () => {
  const onSuccess = (position: GeolocationPosition) => {
    locationPickerLatitude.value = position.coords.latitude;
    locationPickerLongitude.value = position.coords.longitude;
    if (locationMapRef.value?.map) {
      locationMapRef.value.map.setCenter([
        position.coords.longitude,
        position.coords.latitude,
      ]);
      locationMapRef.value.map.setZoom(15);
    }
  };

  const onError = () => {
    locationPickerLatitude.value = -15.459175;
    locationPickerLongitude.value = -47.602219;
    if (locationMapRef.value?.map) {
      locationMapRef.value.map.setCenter([-47.602219, -15.459175]);
      locationMapRef.value.map.setZoom(15);
    }
  };

  return { onSuccess, onError };
};

const onLocationMapLoad = () => {
  if (!locationMapRef.value?.map) return;

  const map = locationMapRef.value.map;
  map.resize();

  map.doubleClickZoom.disable();
  if (map.boxZoom) {
    map.boxZoom.disable();
  }

  map.on('click', (e: any) => {
    if (!e?.lngLat) return;

    const lngLat = e.lngLat;
    locationPickerLatitude.value = lngLat.lat;
    locationPickerLongitude.value = lngLat.lng;
  });

  if (locationPickerLatitude.value && locationPickerLongitude.value) {
    map.setCenter([
      locationPickerLongitude.value,
      locationPickerLatitude.value,
    ]);
    map.setZoom(15);
    return;
  }

  if (navigator.geolocation) {
    const { onSuccess, onError } = getGeolocationCallbacks();

    navigator.geolocation.getCurrentPosition(onSuccess, onError); // NOSONAR: S5604 - Geolocalização é necessária para funcionalidade de envio de localização
  }
};

watch(isOpen, async (isOpenValue) => {
  if (isOpenValue) {
    await nextTick();
    if (locationPickerMode.value === 'current') {
      await useCurrentLocation();
    }
  }
});

watch(
  () => [
    locationPickerMode.value,
    locationPickerLatitude.value,
    locationPickerLongitude.value,
  ],
  async ([mode, lat, lng]) => {
    if (
      mode === 'map' &&
      lat !== null &&
      lng !== null &&
      typeof lat === 'number' &&
      typeof lng === 'number'
    ) {
      await nextTick();
      setTimeout(() => {
        if (locationMapRef.value?.map) {
          const map = locationMapRef.value.map;
          const currentCenter = map.getCenter();
          const currentZoom = map.getZoom();
          const centerLng = Number(currentCenter.lng);
          const centerLat = Number(currentCenter.lat);
          const distance = Math.sqrt(
            Math.pow(centerLng - Number(lng), 2) +
              Math.pow(centerLat - Number(lat), 2)
          );
          if (distance > 0.001) {
            map.setCenter([Number(lng), Number(lat)]);
            map.setZoom(currentZoom);
          }
        }
      }, 100);
    }
  }
);
</script>

<template>
  <VDialog
    :model-value="isOpen"
    max-width="800"
    :scrollable="false"
    @update:model-value="isOpen = $event"
  >
    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between">
        <span>{{ t('location_label', 'Localização') }}</span>
        <VBtn icon variant="text" size="small" @click="isOpen = false">
          <VIcon>tabler-x</VIcon>
        </VBtn>
      </VCardTitle>
      <VCardText>
        <VTabs v-model="locationPickerMode" class="mb-4">
          <VTab value="current">
            <VIcon start>tabler-current-location</VIcon>
            Localização Atual
          </VTab>
          <VTab value="map">
            <VIcon start>tabler-map</VIcon>
            Escolher no Mapa
          </VTab>
          <VTab value="manual">
            <VIcon start>tabler-keyboard</VIcon>
            Digitar Coordenadas
          </VTab>
        </VTabs>

        <VWindow v-model="locationPickerMode">
          <VWindowItem value="current">
            <div class="d-flex flex-column align-center pa-4">
              <VIcon size="48" color="primary" class="mb-4">
                tabler-current-location
              </VIcon>
              <VBtn
                color="primary"
                @click="useCurrentLocation"
                :loading="
                  locationPickerMode === 'current' && !locationPickerLatitude
                "
              >
                Usar Localização Atual
              </VBtn>
              <p class="text-caption text-center mt-4">
                Clique no botão para obter sua localização atual
              </p>
            </div>
          </VWindowItem>

          <VWindowItem value="map">
            <div class="location-picker-map-container">
              <MglMap
                ref="locationMapRef"
                :map-style="mapStyle"
                :center="locationMapCenter"
                :zoom="15"
                width="100%"
                height="400px"
                @map:click="onLocationMapClick"
                @map:load="onLocationMapLoad"
              >
                <MglMarker
                  v-if="locationPickerLatitude && locationPickerLongitude"
                  :coordinates="locationMarkerPosition"
                  color="#ef4444"
                />
              </MglMap>
            </div>
            <VRow class="mt-4">
              <VCol cols="12">
                <AppTextField
                  v-model="locationPickerName"
                  label="Nome (opcional)"
                  placeholder="Ex: Minha Casa"
                />
              </VCol>
              <VCol cols="12">
                <AppTextField
                  v-model="locationPickerAddress"
                  label="Endereço (opcional)"
                  placeholder="Ex: Rua Exemplo, 123"
                />
              </VCol>
            </VRow>
          </VWindowItem>

          <VWindowItem value="manual">
            <VRow>
              <VCol cols="12" md="6">
                <AppTextField
                  v-model="locationInputLatitude"
                  label="Latitude"
                  placeholder="Ex: -15.459175"
                  type="number"
                  step="any"
                />
              </VCol>
              <VCol cols="12" md="6">
                <AppTextField
                  v-model="locationInputLongitude"
                  label="Longitude"
                  placeholder="Ex: -47.602219"
                  type="number"
                  step="any"
                />
              </VCol>
              <VCol cols="12">
                <VBtn
                  color="primary"
                  block
                  @click="useManualCoordinates"
                  :disabled="!locationInputLatitude || !locationInputLongitude"
                >
                  Aplicar Coordenadas
                </VBtn>
              </VCol>
            </VRow>
            <VRow
              v-if="locationPickerLatitude && locationPickerLongitude"
              class="mt-4"
            >
              <VCol cols="12">
                <AppTextField
                  v-model="locationPickerName"
                  label="Nome (opcional)"
                  placeholder="Ex: Minha Casa"
                />
              </VCol>
              <VCol cols="12">
                <AppTextField
                  v-model="locationPickerAddress"
                  label="Endereço (opcional)"
                  placeholder="Ex: Rua Exemplo, 123"
                />
              </VCol>
            </VRow>
          </VWindowItem>
        </VWindow>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn variant="tonal" color="secondary" @click="isOpen = false">
          {{ t('cancel', 'Cancelar') }}
        </VBtn>
        <VBtn
          color="primary"
          @click="confirmLocation"
          :disabled="!locationPickerLatitude || !locationPickerLongitude"
        >
          {{ t('send', 'Enviar Localização') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style lang="scss" scoped>
.location-picker-map-container {
  width: 100%;
  height: 400px;
  position: relative;
  border-radius: 8px;
  overflow: hidden;
}
</style>
