import { getActivePinia } from 'pinia';
import { clearWorkerCommandActionAttempts } from '../workerCommandActionAttempts';

export const clearAllStorages = (): void => {
  localStorage.clear();
  sessionStorage.clear();
};

export const clearAllCookies = (): void => {
  if (typeof document === 'undefined' || !document.cookie) {
    return;
  }

  const cookies = document.cookie.split(';');

  for (const cookieEntry of cookies) {
    const separatorIndex = cookieEntry.indexOf('=');
    const rawName =
      separatorIndex >= 0 ? cookieEntry.slice(0, separatorIndex) : cookieEntry;
    const cookieName = rawName.trim();

    if (!cookieName) {
      continue;
    }

    document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
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
    if (typeof store.shutdown === 'function') {
      try {
        store.shutdown();
      } catch {
        // ignore
      }
    }

    const isSetupStore = store._isSetupStore === true;
    if (isSetupStore) {
      if (typeof store.resetState === 'function') {
        try {
          store.resetState();
        } catch (error: any) {
          console.warn(
            `Erro ao resetar a setup store "${store.$id}" via resetState:`,
            error
          );
        }
      }

      return;
    }

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
  resetAllPiniaStores();
  clearWorkerCommandActionAttempts();
  clearAllStorages();
  clearAllCookies();
};
