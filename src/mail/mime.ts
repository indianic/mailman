import { lookup } from 'mime-types';

export function guessMimeType(filePath: string): string {
  return lookup(filePath) || 'application/octet-stream';
}
