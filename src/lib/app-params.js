const isNode = typeof window === 'undefined';
const windowObj = isNode ? { localStorage: new Map() } : window;
const storage = windowObj.localStorage;

const toSnakeCase = (str) => str.replace(/([A-Z])/g, '_$1').toLowerCase();

// Native (Capacitor) builds load the app from https://localhost.
// If Base44 URLs are not configured at build-time, API calls will mistakenly hit localhost.
// Provide a safe fallback for known app IDs.
const FALLBACK_BASE_URL_BY_APP_ID = {
  // POSync Bentako app
  '699c7f479ca751ca2d7425fe': 'https://bentako.base44.app'
};

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false } = {}) => {
  if (isNode) return defaultValue;

  const storageKey = `base44_${toSnakeCase(paramName)}`;
  const urlParams = new URLSearchParams(window.location.search);
  const searchParam = urlParams.get(paramName);

  if (removeFromUrl) {
    urlParams.delete(paramName);
    const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ''}${window.location.hash}`;
    window.history.replaceState({}, document.title, newUrl);
  }

  if (searchParam) {
    storage.setItem(storageKey, searchParam);
    return searchParam;
  }

  if (defaultValue) {
    storage.setItem(storageKey, defaultValue);
    return defaultValue;
  }

  const storedValue = storage.getItem(storageKey);
  if (storedValue) return storedValue;

  return null;
};

const getAppParams = () => {
  // AUTH RULE: do not use Base44 built-in auth tokens.
  // Clear any legacy Base44 tokens to prevent automatic /entities/User/me calls.
  try {
    storage.removeItem('base44_access_token');
    storage.removeItem('base44_refresh_token');
    storage.removeItem('token');
    storage.removeItem('refresh_token');
  } catch (_e) {}

  const appIdDefault = import.meta.env.VITE_BASE44_APP_ID;
  const appId = getAppParamValue('app_id', { defaultValue: appIdDefault });

  const envBaseUrl = import.meta.env.VITE_BASE44_APP_BASE_URL;
  const appBaseUrlDefault = envBaseUrl || (appId ? FALLBACK_BASE_URL_BY_APP_ID[String(appId)] : null);

  // app_base_url can be persisted in localStorage by Base44 query params.
  // If an old/native build stored localhost, it will break all API calls.
  // Force-reset localhost values to our default.
  const storageKeyAppBaseUrl = 'base44_app_base_url';
  const appBaseUrl = (() => {
    const v = getAppParamValue('app_base_url', { defaultValue: appBaseUrlDefault });
    if (typeof v === 'string' && v.includes('localhost') && appBaseUrlDefault) {
      try { storage.setItem(storageKeyAppBaseUrl, appBaseUrlDefault); } catch (_e) {}
      return appBaseUrlDefault;
    }
    return v;
  })();

  return {
    appId,
    token: getAppParamValue('access_token', { removeFromUrl: true }),
    fromUrl: getAppParamValue('from_url', { defaultValue: window.location.href }),
    functionsVersion: getAppParamValue('functions_version', { defaultValue: import.meta.env.VITE_BASE44_FUNCTIONS_VERSION }),
    appBaseUrl
  };
};

export const appParams = {
  ...getAppParams()
};
