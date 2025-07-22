import { useTheme } from 'vuetify';
import { useConfigStore } from '@core/stores/config';

export const useGenerateImageVariant = (
  imgLight: string,
  imgDark: string,
  imgLightBordered?: string,
  imgDarkBordered?: string,
  bordered = false
) => {
  const configStore = useConfigStore();
  const { global } = useTheme();

  return computed(() => {
    if (global.name.value === 'light') {
      if (configStore.skin === 'bordered' && bordered) return imgLightBordered;
      else return imgLight;
    }
    if (global.name.value === 'dark') {
      if (configStore.skin === 'bordered' && bordered) return imgDarkBordered;
      else return imgDark;
    }

    return imgLight;
  });
};
