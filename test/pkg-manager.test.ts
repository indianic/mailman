import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installGlobalCommand } from '../src/cli/pkg-manager.js';

test('installGlobalCommand builds the right global-install invocation per manager', () => {
  assert.deepEqual(installGlobalCommand('npm', '@indianic/mailman@1.2.3'), {
    cmd: 'npm',
    args: ['install', '-g', '@indianic/mailman@1.2.3'],
  });
  assert.deepEqual(installGlobalCommand('pnpm', '@indianic/mailman@1.2.3'), {
    cmd: 'pnpm',
    args: ['add', '-g', '@indianic/mailman@1.2.3'],
  });
  assert.deepEqual(installGlobalCommand('yarn', '@indianic/mailman@1.2.3'), {
    cmd: 'yarn',
    args: ['global', 'add', '@indianic/mailman@1.2.3'],
  });
});
