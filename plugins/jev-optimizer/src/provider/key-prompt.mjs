import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { saveCredential } from './credentials.mjs';

const run = promisify(execFile);
const dialog = [
  'use scripting additions',
  'activate',
  'set entry to display dialog "Enter your TypeSafe Jev API key. Save stores it in your macOS login Keychain for Jev Optimizer." default answer "" with hidden answer buttons {"Cancel", "Save"} default button "Save" cancel button "Cancel" with title "Jev Optimizer"',
  'return text returned of entry',
].join('\n');

export async function connectTypeSafe({
  platform = process.platform, prompt = run, store = saveCredential,
} = {}) {
  if (platform !== 'darwin') throw new Error('Use TYPESAFE_API_KEY in the host environment on this platform.');
  let output;
  try {
    // Capture directly in-process. Never forward dialog output or subprocess errors to the terminal.
    ({ stdout: output } = await prompt('/usr/bin/osascript', ['-e', dialog], { maxBuffer: 16384 }));
  } catch {
    throw new Error('TypeSafe setup was cancelled or the macOS dialog could not open.');
  }
  await store('typesafe', output.trim());
  return { provider: 'typesafe', configured: true, source: 'keychain' };
}
