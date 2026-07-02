import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRecipients } from '../src/notify.js';

test('summarizeRecipients: single recipient is shown verbatim', () => {
  assert.equal(summarizeRecipients(['a@b.com']), 'a@b.com');
});

test('summarizeRecipients: extra recipients collapse to "and N more"', () => {
  assert.equal(summarizeRecipients(['a@b.com', 'c@d.com', 'e@f.com']), 'a@b.com and 2 more');
});

test('summarizeRecipients: empty list falls back to a placeholder', () => {
  assert.equal(summarizeRecipients([]), 'recipient');
});
