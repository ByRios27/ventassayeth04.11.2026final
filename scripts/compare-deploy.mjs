import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
const HOST = 'https://chances-v5.firebaseapp.com';

function extractAssetPaths(html) {
  const paths = new Set();
  // script src
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) paths.add(m[1]);
  // link href
  for (const m of html.matchAll(/<link[^>]+href=["']([^"']+)["']/g)) paths.add(m[1]);
  // img src
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/g)) paths.add(m[1]);
  // manifest
  for (const m of html.matchAll(/<link[^>]+rel=["']manifest["'][^>]*href=["']([^"']+)["']/g)) paths.add(m[1]);
  return Array.from(paths).filter(p => p && !p.startsWith('http'));
}

async function fetchRemote(relPath) {
  const url = new URL(relPath, HOST).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function readLocal(relPath) {
  // remove leading slash
  const rel = relPath.replace(/^\//, '');
  const p = path.join(DIST, rel);
  return Buffer.from(await fs.readFile(p));
}

async function main() {
  try {
    const indexPath = path.join(DIST, 'index.html');
    const html = await fs.readFile(indexPath, 'utf-8');
    const assets = extractAssetPaths(html);
    console.log(`Found ${assets.length} asset paths to compare`);
    const mismatches = [];
    for (const a of assets) {
      try {
        const local = await readLocal(a);
        const remote = await fetchRemote(a);
        if (!local.equals(remote)) {
          mismatches.push(a);
          console.log('DIFFER:', a, 'local', local.length, 'bytes remote', remote.length, 'bytes');
        } else {
          console.log('OK:', a);
        }
      } catch (err) {
        mismatches.push(a);
        console.log('ERROR comparing', a, err.message);
      }
    }
    // also compare index.html
    try {
      const localIndex = Buffer.from(await fs.readFile(path.join(DIST, 'index.html')));
      const remoteIndex = await fetchRemote('/');
      if (!localIndex.equals(remoteIndex)) {
        console.log('index.html differs (byte-wise)');
      } else {
        console.log('index.html identical (byte-wise)');
      }
    } catch (err) {
      console.log('Could not compare index.html byte-wise:', err.message);
    }

    if (mismatches.length === 0) {
      console.log('\nALL FILES MATCH. The deployed site appears byte-for-byte identical to local `dist` build for the checked assets.');
      process.exit(0);
    } else {
      console.log('\nMISMATCHES:', mismatches.length);
      mismatches.forEach(m => console.log('-', m));
      process.exit(2);
    }
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(3);
  }
}

main();
