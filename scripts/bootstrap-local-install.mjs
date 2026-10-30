/** First-run guarded isolated DB setup for extracted local Windows developer installation. */
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {localDevEnvironment,ensureLocalDevDatabase} from './local-dev-bootstrap.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
try { const {db}=ensureLocalDevDatabase(root,localDevEnvironment(process.env)); console.log('Local JARVIS development DB:',db); }
catch(err) { console.error('Development DB startup blocked:',err.message); process.exitCode=1; }
