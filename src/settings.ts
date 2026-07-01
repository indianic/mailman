import { getSettingsPath } from './config/paths.js';
import { readJsonFile, updateJsonFile } from './config/store.js';
import { SettingsFileSchema, DEFAULT_SETTINGS_FILE, type SettingsFile } from './config/schema.js';

export function getSettings(): Promise<SettingsFile> {
  return readJsonFile(getSettingsPath(), SettingsFileSchema, DEFAULT_SETTINGS_FILE);
}

export function updateSettings(mutator: (current: SettingsFile) => SettingsFile): Promise<SettingsFile> {
  return updateJsonFile(getSettingsPath(), SettingsFileSchema, DEFAULT_SETTINGS_FILE, mutator);
}
