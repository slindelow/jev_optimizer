import test from 'node:test';
import assert from 'node:assert/strict';

test('initial checkout has no selected shipping rate', () => {
  const checkout = { address: null, selectedRate: null };
  assert.equal(checkout.selectedRate, null);
});
