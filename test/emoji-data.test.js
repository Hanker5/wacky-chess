'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('emoji data covers the full set without skin-tone components', () => {
  const list = require('../ui/emoji-data.js');
  assert.ok(list.length > 1800, `only ${list.length} emoji`);
  assert.deepEqual(list.find(([e]) => e === '🍄'), ['🍄', 'mushroom', 'fungus toadstool']);
  assert.ok(list.some(([, label]) => label === 'troll'));
  assert.ok(!list.some(([, label]) => /skin tone$/.test(label)));
  for (const entry of list) assert.equal(entry.length, 3);
});
