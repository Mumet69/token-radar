// main.ts — the token launch radar's entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every protocol with the radar-2 model in
// lib/model.ts, and writes the ranked board, the dashboard's data, the page
// itself and its screenshots to the output directory, then the dossier the
// judge reads. Running it twice on the same snapshot writes the same bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildRadar, checkRadar } from './lib/model.ts';
import type { Snapshot } from './lib/model.ts';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DEFAULT = '/input/snapshot.json';
const MAX_SHOT_BYTES = 524288;
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function fail(message: string): never {
  console.error(`token radar: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = '';
  let output = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--input' && i + 1 < argv.length) input = argv[++i]!;
    else if (arg.startsWith('--input=')) input = arg.slice('--input='.length);
    else if (arg === '--output' && i + 1 < argv.length) output = argv[++i]!;
    else if (arg.startsWith('--output=')) output = arg.slice('--output='.length);
    else if (arg === '--help') {
      console.log('usage: node main.ts [--input <snapshot.json|dir>] [--output <dir>]');
      console.log('  input defaults to /input/snapshot.json; output defaults to $MAKEFUN_OUTPUT_DIR, else out/');
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  if (input === '') input = SNAPSHOT_DEFAULT;
  if (output === '') output = process.env.MAKEFUN_OUTPUT_DIR ?? 'out';
  return { input, output };
}

function resolveSnapshotPath(input: string): string {
  if (existsSync(input) && statSync(input).isDirectory()) return join(input, 'snapshot.json');
  return input;
}

function readSnapshot(path: string): Snapshot {
  if (!existsSync(path)) fail(`snapshot not found at ${path} (pass --input <snapshot.json>)`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`snapshot at ${path} is not valid JSON`);
  }
  const snap = parsed as Partial<Snapshot>;
  if (typeof snap.as_of !== 'string' || typeof snap.floor_usd !== 'number') {
    fail(`snapshot at ${path} is missing as_of or floor_usd`);
  }
  if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) {
    fail(`snapshot at ${path} is missing the protocols or watchlist arrays`);
  }
  return snap as Snapshot;
}

function copyTreeFiles(fromDir: string, toDir: string, label: string): string[] {
  if (!existsSync(fromDir)) fail(`missing ${label} directory at ${fromDir}`);
  mkdirSync(toDir, { recursive: true });
  const names = readdirSync(fromDir).sort();
  const copied: string[] = [];
  for (const name of names) {
    const from = join(fromDir, name);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(toDir, name));
    copied.push(name);
  }
  return copied;
}

function checkShots(dir: string, names: string[]): void {
  if (names.length < 3) fail(`screenshots/ holds ${names.length} images, need at least 3`);
  for (const name of names) {
    const path = join(dir, name);
    const bytes = readFileSync(path);
    if (bytes.length > MAX_SHOT_BYTES) fail(`screenshots/${name} is ${bytes.length} bytes, over the 512 KiB cap`);
    if (!JPEG_MAGIC.every((b, i) => bytes[i] === b)) fail(`screenshots/${name} is not a JPEG`);
  }
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const snapshotPath = resolveSnapshotPath(input);
  const snapshot = readSnapshot(snapshotPath);

  const radar = buildRadar(snapshot);
  const problems = checkRadar(radar, snapshot);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`token radar: gate failed: ${problem}`);
    process.exit(1);
  }

  mkdirSync(output, { recursive: true });

  const boardPath = join(output, 'board.json');
  writeFileSync(boardPath, `${JSON.stringify({ rows: radar.rows }, null, 2)}\n`);

  const watchlist = new Set(snapshot.watchlist);
  const data = {
    meta: {
      as_of: snapshot.as_of,
      floor_usd: snapshot.floor_usd,
      protocols: snapshot.protocols.length,
      watchlist: radar.watchlistTotal,
      watchlist_covered: radar.watchlistCovered,
      rows: radar.rows.length,
      live: radar.live.length,
      top_ten_total_usd: radar.topTenTotal,
    },
    rows: radar.rows.map((row) => ({ ...row, watchlist: watchlist.has(row.slug) })),
    live: radar.live,
    watchlist: snapshot.watchlist,
  };
  // window.DATA (not const DATA): a const at the top level of a classic script
  // does not become a window property, and app.js reads window.DATA.
  writeFileSync(join(output, 'data.js'), `window.DATA = ${JSON.stringify(data)};\n`);

  const dashboardFiles = copyTreeFiles(join(REPO_ROOT, 'dashboard'), join(output, 'dashboard'), 'dashboard');
  const shotNames = copyTreeFiles(join(REPO_ROOT, 'screenshots'), join(output, 'screenshots'), 'screenshots');
  checkShots(join(output, 'screenshots'), shotNames);

  const dossier = buildDossier(output, { text_max_bytes: 65536 });
  writeFileSync(join(output, 'dossier.json'), dossier);

  const top = radar.rows[0]!;
  console.log(
    `token radar: ${snapshot.protocols.length} protocols, ${radar.watchlistCovered} of ${radar.watchlistTotal} on the watchlist, ${radar.rows.length} rows scored (${radar.belowFloorRows} early, ${radar.live.length} live set aside)`,
  );
  console.log(`token radar: rank 1 is ${top.slug} at $${top.implied_value_usd.toLocaleString('en-US')} implied value`);
  console.log(
    `token radar: wrote ${boardPath}, data.js, dashboard (${dashboardFiles.length} files), screenshots (${shotNames.length} images) and dossier.json (${dossier.length} bytes)`,
  );
}

main();
