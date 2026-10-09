import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserPort } from '../browser/port.mjs';
test('browser harness defaults to 4173 and accepts explicit valid ports', () => {
  const previous = process.env.MERMAID_BROWSER_PORT;
  delete process.env.MERMAID_BROWSER_PORT;
  try { assert.equal(browserPort(), 4173); }
  finally { if (previous !== undefined) process.env.MERMAID_BROWSER_PORT = previous; }
  assert.equal(browserPort('4176'), 4176);
  assert.equal(browserPort('65535'), 65535);
  assert.equal(browserPort('1'), 1);
});
test('browser harness rejects empty, fractional, signed, whitespace and out-of-range ports', () => {
  for (const value of ['', '0', '65536', '-1', '4.2', '+4176', ' 4176', '4176 ', '04176', '4176abc', 'NaN', 'Infinity']) {
    assert.throws(() => browserPort(value), /MERMAID_BROWSER_PORT/);
  }
});
