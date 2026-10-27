'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('emoji data covers the full set without skin-tone components', () => {
  const list = require('../ui/emoji-data.js');
  assert.ok(list.length > 1800, `only ${list.length} emoji`);
  assert.deepEqual(list.find(([e]) => e === '🍄'), ['🍄', 'mushroom', 'fungus toadstool']);
  assert.ok(list.some(([, label]) => label === 'troll'));
  assert.ok(!list.some(([, label]) => /skin tone$/.test(label)));
  for (const entry of list) assert.equal(entry.length, 3);
});

test('emoji data ships with its MIT notice and CLDR credit', () => {
  const header = fs.readFileSync(path.join(__dirname, '..', 'ui', 'emoji-data.js'), 'utf8').slice(0, 3000);
  assert.match(header, /Copyright \(c\) 2017-2019 Miles Johnson/);
  assert.match(header, /Permission is hereby granted, free of charge/);
  assert.match(header, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.match(header, /Unicode CLDR/);
});
