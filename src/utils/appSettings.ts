import {
  CustomImageApiConfig,
  CustomLlmApiConfig,
  CustomStyleVisionApiConfig,
  CustomTtsApiConfig,
  CustomVideoApiConfig,
  ProjectSettings,
  VideoProject
} from '../types';

const APP_SETTINGS_KEY = 'ai_video_app_settings';

export interface AppSecretSettings {
  customImageApi?: CustomImageApiConfig;
  customLlmApi?: CustomLlmApiConfig;
  customTtsApi?: CustomTtsApiConfig;
  customVideoApi?: CustomVideoApiConfig;
  customStyleVisionApi?: CustomStyleVisionApiConfig;
}

function hasKey(api?: { apiKey?: string } | null): boolean {
  return Boolean(api?.apiKey && String(api.apiKey).trim());
}

export function loadAppSettings(): AppSecretSettings {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as AppSecretSettings;
  } catch {
    return {};
  }
}

export function persistAppSettings(settings: AppSecretSettings): boolean {
  try {
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch (err) {
    console.warn('[App Settings] Failed to persist API settings:', err);
    return false;
  }
}

export function persistAppSettingsFromProject(project: VideoProject): boolean {
  const settings = project.settings || ({} as ProjectSettings);
  const next: AppSecretSettings = {
    customImageApi: settings.customImageApi,
    customLlmApi: settings.customLlmApi,
    customTtsApi: settings.customTtsApi,
    customVideoApi: settings.customVideoApi,
    customStyleVisionApi: settings.customStyleVisionApi
  };
  const existing = loadAppSettings();
  return persistAppSettings({
    customImageApi: next.customImageApi || existing.customImageApi,
    customLlmApi: next.customLlmApi || existing.customLlmApi,
    customTtsApi: next.customTtsApi || existing.customTtsApi,
    customVideoApi: next.customVideoApi || existing.customVideoApi,
    customStyleVisionApi: next.customStyleVisionApi || existing.customStyleVisionApi
  });
}

export function captureAppSettingsIfEmpty(project: VideoProject): void {
  const existing = loadAppSettings();
  if (
    hasKey(existing.customImageApi)
    || hasKey(existing.customLlmApi)
    || hasKey(existing.customTtsApi)
    || hasKey(existing.customVideoApi)
    || hasKey(existing.customStyleVisionApi)
    || existing.customImageApi
    || existing.customLlmApi
    || existing.customTtsApi
  ) {
    return;
  }
  persistAppSettingsFromProject(project);
}

export function stripProjectSecrets(project: VideoProject): VideoProject {
  const settings = project.settings || ({} as ProjectSettings);
  return {
    ...project,
    settings: {
      ...settings,
      customImageApi: undefined,
      customLlmApi: undefined,
      customTtsApi: undefined,
      customVideoApi: undefined,
      customStyleVisionApi: undefined
    }
  };
}

export function mergeAppSettings(project: VideoProject): VideoProject {
  const app = loadAppSettings();
  const settings = project.settings || ({} as ProjectSettings);
  return {
    ...project,
    settings: {
      ...settings,
      customImageApi: app.customImageApi || settings.customImageApi,
      customLlmApi: app.customLlmApi || settings.customLlmApi,
      customTtsApi: app.customTtsApi || settings.customTtsApi,
      customVideoApi: app.customVideoApi || settings.customVideoApi,
      customStyleVisionApi: app.customStyleVisionApi || settings.customStyleVisionApi
    }
  };
}
