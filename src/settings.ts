import { getSettingsPath } from './config/paths.js';
import { readJsonFile } from './config/store.js';
import { SettingsFileSchema, DEFAULT_SETTINGS_FILE, type SettingsFile } from './config/schema.js';

export async function getSettings(): Promise<SettingsFile> {
  return readJsonFile(getSettingsPath(), SettingsFileSchema, DEFAULT_SETTINGS_FILE);
}
