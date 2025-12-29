import { getActivePinia } from 'pinia';

export const clearAllStorages = (): void => {
  localStorage.clear();
  sessionStorage.clear();
};

export const resetAllPiniaStores = (): void => {
  const pinia = getActivePinia();

  if (!pinia) {
    return;
  }

  const piniaInternal = pinia as any;

  if (!piniaInternal._s) {
    return;
  }

  piniaInternal._s.forEach((store: any) => {
    const isSetupStore = store._isSetupStore === true;
    if (isSetupStore) return;

    if (typeof store.$reset === 'function') {
      try {
        store.$reset();
      } catch (error: any) {
        const isSetupStoreError =
          error?.message?.includes('setup syntax') ||
          error?.message?.includes('does not implement $reset');

        if (!isSetupStoreError) {
          console.warn(`Erro ao resetar a store "${store.$id}":`, error);
        }
      }
    }
  });
};

export const clearAllData = (): void => {
  clearAllStorages();
  resetAllPiniaStores();
};
