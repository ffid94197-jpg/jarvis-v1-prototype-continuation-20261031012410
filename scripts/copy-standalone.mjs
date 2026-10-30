/** Copy standard Next.js standalone static assets, cross-platform.
 * Avoid shell cp/tee/bun so the development source can build on Windows.
 * Usage: node scripts/copy-standalone.mjs [project-root]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.argv[2] || defaultRoot);
const standalone = path.join(root, '.next', 'standalone');
if (!fs.existsSync(path.join(standalone,'server.js'))) {
  console.error('Standalone server.js is missing; Next build did not finish.');
  process.exitCode = 1;
} else {
  for (const [source, destination] of [
    [path.join(root,'.next','static'),path.join(standalone,'.next','static')],
    [path.join(root,'public'),path.join(standalone,'public')],
  ]) {
    if (!fs.existsSync(source)) {
      if (path.basename(source) === 'public') continue;
      throw new Error(`Required build assets missing: ${source}`);
    }
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    fs.cpSync(source,destination,{recursive:true,force:true});
  }
  console.log('Standalone static assets copied. This does not certify the release.');
}
