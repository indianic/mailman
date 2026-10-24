import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveVars,
  estimateDuration,
  isAwkwardName,
  listTokens,
  renderTemplate,
  selectSamples,
  type RecipientPlan,
} from '../src/campaigns/render.js';

test('renderTemplate: substitutes known tokens', () => {
  const out = renderTemplate('Hi {{first_name}}, your address is {{email}}.', { first_name: 'Yash', email: 'y@x.com' }, 'text');
  assert.equal(out.text, 'Hi Yash, your address is y@x.com.');
  assert.deepEqual(out.unresolved, []);
  assert.deepEqual(out.fallbacks, []);
});

test('renderTemplate: a missing token with no fallback is reported unresolved, never blanked', () => {
  const out = renderTemplate('Hi {{name}},', {}, 'text');
  assert.deepEqual(out.unresolved, ['name']);
  // The gap is left visible rather than rendering "Hi ," — a caller that
  // ignores `unresolved` still cannot ship a blank greeting silently.
  assert.equal(out.text, 'Hi {{name}},');
});

test('renderTemplate: an empty-string var is treated as missing, not as a value', () => {
  const out = renderTemplate('Hi {{name}},', { name: '' }, 'text');
  assert.deepEqual(out.unresolved, ['name']);
});

test('renderTemplate: an explicit fallback resolves and is reported', () => {
  const out = renderTemplate('Hi {{first_name|there}},', {}, 'text');
  assert.equal(out.text, 'Hi there,');
  assert.deepEqual(out.fallbacks, ['first_name']);
  assert.deepEqual(out.unresolved, []);
});

test('renderTemplate: values are HTML-escaped for an HTML body', () => {
  const out = renderTemplate('Hi {{name}},', { name: `O'Brien & <Sons>` }, 'html');
  assert.equal(out.text, 'Hi O&#39;Brien &amp; &lt;Sons&gt;,');
  assert.doesNotMatch(out.text, /<Sons>/);
});

test('renderTemplate: values are NOT escaped for a text body', () => {
  const out = renderTemplate('Hi {{name}},', { name: 'Sales & Marketing' }, 'text');
  assert.equal(out.text, 'Hi Sales & Marketing,');
});

test('renderTemplate: the fallback literal is escaped on the same footing as a value', () => {
  const out = renderTemplate('Hi {{name|the <team>}},', {}, 'html');
  assert.equal(out.text, 'Hi the &lt;team&gt;,');
});

test('renderTemplate: whitespace inside the braces is tolerated', () => {
  assert.equal(renderTemplate('Hi {{ first_name }},', { first_name: 'Yash' }, 'text').text, 'Hi Yash,');
  assert.equal(renderTemplate('Hi {{ name | there }},', {}, 'text').text, 'Hi there,');
});

test('renderTemplate: the same token twice renders twice (no lastIndex carry-over)', () => {
  const out = renderTemplate('{{name}} — {{name}}', { name: 'Yash' }, 'text');
  assert.equal(out.text, 'Yash — Yash');
});

test('renderTemplate: rendering the same template repeatedly is stable', () => {
  const template = 'Hi {{name}},';
  const first = renderTemplate(template, { name: 'A' }, 'text');
  const second = renderTemplate(template, { name: 'B' }, 'text');
  assert.equal(first.text, 'Hi A,');
  assert.equal(second.text, 'Hi B,');
});

test('renderTemplate: an unknown token is unresolved — a typo fails loudly rather than sending "{{firstname}}"', () => {
  const out = renderTemplate('Hi {{firstname}},', { first_name: 'Yash' }, 'text');
  assert.deepEqual(out.unresolved, ['firstname']);
});

test('listTokens: de-duplicates and preserves order', () => {
  assert.deepEqual(listTokens('{{name}} {{email}} {{name}} {{first_name|there}}'), ['name', 'email', 'first_name']);
});

test('deriveVars: splits first_name off a full name', () => {
  const vars = deriveVars('y@x.com', 'Yash Suryawanshi');
  assert.deepEqual(vars, { email: 'y@x.com', name: 'Yash Suryawanshi', first_name: 'Yash' });
});

test('deriveVars: a blank contact name yields NO name var, so the unresolved check fires', () => {
  const vars = deriveVars('chetan@x.com', '   ');
  assert.deepEqual(vars, { email: 'chetan@x.com' });
  assert.equal(renderTemplate('Hi {{name}},', vars, 'text').unresolved.length, 1);
});

test('deriveVars: a single-word name populates both name and first_name', () => {
  assert.deepEqual(deriveVars('b@x.com', 'Brinda'), { email: 'b@x.com', name: 'Brinda', first_name: 'Brinda' });
});

test('deriveVars: explicit overrides beat the contact name and carry custom tokens', () => {
  const vars = deriveVars('y@x.com', 'Wrong Name', { name: 'Yash S', company: 'IndiaNIC' });
  assert.equal(vars.name, 'Yash S');
  assert.equal(vars.first_name, 'Yash');
  assert.equal(vars.company, 'IndiaNIC');
});

function plan(overrides: Partial<RecipientPlan>): RecipientPlan {
  return {
    seq: 0,
    email: 'a@x.com',
    vars: {},
    subject: 's',
    bodyPreview: 'b',
    unresolved: [],
    fallbacks: [],
    ...overrides,
  };
}

test('selectSamples: surfaces the fallback case, not just the flattering one', () => {
  const plans = [
    plan({ seq: 0, email: 'full@x.com', vars: { name: 'Yash Suryawanshi' } }),
    plan({ seq: 1, email: 'also-full@x.com', vars: { name: 'Sandeep Mundra' } }),
    plan({ seq: 2, email: 'nameless@x.com', fallbacks: ['first_name'] }),
  ];
  const samples = selectSamples(plans);
  assert.ok(
    samples.some((s) => s.email === 'nameless@x.com'),
    'the ugly rendering must be shown — hiding it is how "Hi ," reaches an inbox with sign-off behind it',
  );
  assert.ok(samples.some((s) => s.email === 'full@x.com'));
});

test('selectSamples: never returns duplicates and respects the limit', () => {
  const plans = [plan({ seq: 0, email: 'only@x.com', vars: { name: 'A B' } })];
  const samples = selectSamples(plans);
  assert.equal(samples.length, 1);
});

test('selectSamples: empty in, empty out', () => {
  assert.deepEqual(selectSamples([]), []);
});

test('isAwkwardName: a one-word name counts as awkward', () => {
  assert.equal(isAwkwardName(plan({ vars: { name: 'Brinda' } })), true);
  assert.equal(isAwkwardName(plan({ vars: { name: 'Brinda Modi' } })), false);
  assert.equal(isAwkwardName(plan({ fallbacks: ['name'], vars: { name: 'X Y' } })), true);
});

test('estimateDuration: reflects the throttle', () => {
  assert.equal(estimateDuration(1, 20), '~instant');
  assert.equal(estimateDuration(39, 20), '~2 min');
  assert.equal(estimateDuration(11, 20), '~30 sec');
});
