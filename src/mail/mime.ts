import path from 'node:path';

// Minimal extension lookup for Phase 1's basic attachment support. Phase 2
// ("MIME-type inference for attachment headers") replaces this with a
// proper inference library once resolve-attachments.ts lands.
const EXTENSION_MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};

export function guessMimeType(filePath: string): string {
  return EXTENSION_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}
