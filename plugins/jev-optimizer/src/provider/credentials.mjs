import { spawn } from 'node:child_process';
import { definition, ProviderError } from './model.mjs';

function command(path, args, input = '') {
  return new Promise((resolve) => {
    const proc = spawn(path, args, { stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 });
    const chunks = [];
    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.on('error', () => resolve({ code: -1, output: '' }));
    proc.on('close', (code) => resolve({ code, output: Buffer.concat(chunks).toString().trim() }));
    proc.stdin.on('error', () => {});
    proc.stdin.end(input);
  });
}
const service = 'dev.jev-optimizer.provider';

export async function credential(provider, env = process.env) {
  for (const name of definition(provider).env) {
    if (env[name]?.trim()) return { source: name, secret: env[name].trim() };
  }
  let result;
  if (process.platform === 'darwin') {
    result = await command('/usr/bin/security', [
      'find-generic-password',
      '-s',
      service,
      '-a',
      provider,
      '-w',
    ]);
  } else if (process.platform === 'linux') {
    result = await command('/usr/bin/secret-tool', ['lookup', 'service', service, 'provider', provider]);
  }
  return result?.code === 0 && result.output
    ? { source: 'keychain', secret: result.output }
    : { source: null, secret: null };
}

export async function credentialStatus(provider) {
  const { source } = await credential(provider);
  return { configured: !!source, source };
}

export async function saveCredential(provider, secret) {
  definition(provider);
  // Keeps input to macOS security's interactive parser a single literal token.
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_.=+\/-]{8,8192}$/.test(secret)) {
    throw new ProviderError(
      'invalid_credential',
      'Unsupported credential format; use the documented provider environment variable.',
    );
  }
  let result;
  if (process.platform === 'darwin') {
    result = await command(
      '/usr/bin/security',
      ['-i'],
      `add-generic-password -U -s ${service} -a ${provider} -w ${secret}\n`,
    );
  } else if (process.platform === 'linux') {
    result = await command(
      '/usr/bin/secret-tool',
      ['store', '--label=Jev Optimizer', 'service', service, 'provider', provider],
      secret,
    );
  }
  if (result?.code !== 0 || (await credential(provider, {})).secret !== secret) {
    throw new ProviderError(
      'keychain_unavailable',
      'Secure storage is unavailable. Use a provider environment variable.',
    );
  }
  return { configured: true, source: 'keychain' };
}
export async function forgetCredential(provider) {
  definition(provider);
  const saved = await credential(provider, {});
  if (saved.secret) {
    const result =
      process.platform === 'darwin'
        ? await command('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', provider])
        : await command('/usr/bin/secret-tool', ['clear', 'service', service, 'provider', provider]);
    if (result.code !== 0)
      throw new ProviderError('keychain_unavailable', 'Unable to remove the stored credential.');
  }
  return credentialStatus(provider);
}
