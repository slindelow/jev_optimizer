import test from 'node:test';
import assert from 'node:assert/strict';
import { connectTypeSafe } from '../src/provider/key-prompt.mjs';

test('direct login uses masked input, saves to TypeSafe, and returns metadata only', async () => {
  const result = await connectTypeSafe({
    platform: 'darwin',
    prompt: async (program, args) => {
      assert.equal(program, '/usr/bin/osascript');
      assert.match(args[1], /with hidden answer/);
      return { stdout: 'synthetic-example\n' };
    },
    store: async (provider, value) => {
      assert.equal(provider, 'typesafe');
      assert.equal(value, 'synthetic-example');
    },
  });
  assert.deepEqual(result, { provider:'typesafe', configured:true, source:'keychain' });
});
test('cancelled entry preserves the previous credential and suppresses dialog output', async () => {
  await assert.rejects(connectTypeSafe({ platform:'darwin',
    prompt:async () => { throw new Error('private dialog output'); },
    store:async () => assert.fail('must not store on cancellation'),
  }), err => /cancelled/.test(err.message) && !err.message.includes('private dialog output'));
});
