/**
 * Operator-only credential provisioning. Run LOCALLY in a private terminal;
 * never through a remote chat transcript or with an agent observing stdout.
 * Prints config values for secure server environment settings, never writes
 * private secrets to the repository. No default owner passphrase exists.
 */
import { randomBytes, createHash, scryptSync } from 'node:crypto';

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
      reject(new Error('Interactive private terminal required.')); return;
    }
    process.stdout.write(prompt);
    let value = '';
    const handler = (chunk) => {
      const input = chunk.toString('utf8');
      for (const char of input) {
        if (char === '\r' || char === '\n') {
          process.stdin.off('data', handler);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') {
          value = Array.from(value).slice(0, -1).join('');
        } else if (char >= ' ' && value.length < 256) {
          value += char;
        }
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', handler);
  });
}

try {
  const passphrase = await readHidden('New owner passphrase (minimum 12 chars): ');
  const confirm = await readHidden('Confirm passphrase: ');
  if (passphrase.length < 12 || passphrase.length > 256 || passphrase !== confirm) {
    throw new Error('Passphrase invalid or confirmation does not match.');
  }
  const salt = randomBytes(16);
  const digest = scryptSync(passphrase, salt, 64);
  const setupToken = randomBytes(32).toString('base64url');
  const setupDigest = createHash('sha256').update(setupToken).digest('hex');
  console.log('\nSERVER ENVIRONMENT VARIABLES — set these privately, not in chat:');
  console.log(`JARVIS_OWNER_SCRYPT_HASH=scrypt:${salt.toString('hex')}:${digest.toString('hex')}`);
  console.log(`JARVIS_SETUP_TOKEN_SHA256=${setupDigest}`);
  console.log('JARVIS_PUBLIC_ORIGIN=https://<the-exact-verified-public-hostname>');
  console.log('\nONE-TIME SETUP TOKEN — enter directly in the initial NEXUS enrollment UI:');
  console.log(setupToken);
  console.log('\nDo not commit these values, share them in chat, or log them.');
  console.log('Existing owners need only the owner passphrase hash, not re-enrollment.');
} catch (err) {
  console.error(err instanceof Error ? err.message : 'Credential creation failed');
  process.exitCode = 1;
}
