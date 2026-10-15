#!/usr/bin/env node
/**
 * scripts/hygiene/scan.js — performance-critical hashing/matching engine for
 * scripts/hygiene/scan.sh. Kept in Node so we hash candidates in-process
 * instead of forking `sha256sum` per token (which does not scale past a
 * handful of files).
 *
 * This file intentionally contains NO denylisted plaintext and no canary
 * literal — see scan.sh for why the canary may only live there.
 *
 * Usage (always invoked by scan.sh, not directly):
 *   node scan.js --diff            Read a unified diff from stdin
 *   node scan.js --files <f1> ...  Scan the full content of each given file
 *   node scan.js --tree            Scan the FULL content (and paths) of every git-tracked file in
 *                                  the current working directory's repo (`git ls-files`). The
 *                                  diff modes only ever see what a change adds; this mode sees
 *                                  what the tree already holds, so a token denylisted AFTER its
 *                                  content landed is still caught.
 *
 * Exit codes: 0 = clean, 1 = denylisted token found, 2 = setup error.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const HASH_FILE = path.join(__dirname, 'denylist.sha256');
const SELF_SUFFIX = 'scripts/hygiene/scan.sh';

function loadDenylist() {
  if (!fs.existsSync(HASH_FILE)) {
    process.stderr.write(`ERROR: denylist hash file not found at ${HASH_FILE}\n`);
    process.exit(2);
  }
  const lines = fs.readFileSync(HASH_FILE, 'utf8').split('\n');
  let salt = null;
  const hashes = new Set();
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('# salt: ')) {
      salt = line.slice('# salt: '.length).trim();
    } else if (line === '' || line.startsWith('#')) {
      continue;
    } else {
      hashes.add(line);
    }
  }
  if (!salt) {
    process.stderr.write(`ERROR: no '# salt: <hex>' line found in ${HASH_FILE}\n`);
    process.exit(2);
  }
  if (hashes.size === 0) {
    process.stderr.write('ERROR: denylist hash file has no hash entries\n');
    process.exit(2);
  }
  return { salt, hashes };
}

function hashWord(salt, word) {
  return crypto.createHash('sha256').update(salt + word, 'utf8').digest('hex');
}

// Candidates: each maximal run of [a-z0-9_.-], plus each '.'/'_'-delimited
// segment of that run. Matches the contract in scan.sh's header comment.
function extractCandidates(text) {
  const lower = text.toLowerCase();
  const compounds = lower.match(/[a-z0-9_.-]+/g) || [];
  const out = [];
  for (const compound of compounds) {
    out.push(compound);
    for (const seg of compound.split(/[._]/)) {
      if (seg) out.push(seg);
    }
  }
  return out;
}

function isSelfPath(p) {
  return p.endsWith(SELF_SUFFIX) || path.basename(p) === 'scan.sh';
}

// Memoised per run: the tree mode sees the same words (import, const, ...) tens of thousands of
// times, and hashing each occurrence would dominate the runtime.
const verdictCache = new Map();

function checkLine(salt, hashes, location, text, report) {
  let hit = false;
  for (const candidate of extractCandidates(text)) {
    let denied = verdictCache.get(candidate);
    if (denied === undefined) {
      denied = hashes.has(hashWord(salt, candidate));
      verdictCache.set(candidate, denied);
    }
    if (denied) {
      report(`${location}: REDACTED token match`);
      hit = true;
    }
  }
  return hit;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

function scanFiles(salt, hashes, files, report) {
  let found = false;
  for (const f of files) {
    if (isSelfPath(f)) continue;
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) continue;
    if (checkLine(salt, hashes, `${f} (path)`, f, report)) found = true;
    const content = fs.readFileSync(f, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (checkLine(salt, hashes, `${f}:${i + 1}`, lines[i], report)) found = true;
    }
  }
  return found;
}

// Content of these is never text a human wrote; their PATH is still scanned.
const BINARY_EXT = /\.(png|jpe?g|gif|ico|webp|pdf|zip|gz|tgz|bz2|xz|7z|wasm|woff2?|ttf|otf|eot|mp3|mp4|webm|wav|ogg|m4a|mov|avi|xlsx|docx|pptx|odt|so|dylib|dll|exe|bin|class|jar|pyc|node)$/i;
// Machine-generated, huge, and carries registry integrity hashes, not authored prose.
const TREE_SKIP = /(^|\/)pnpm-lock\.yaml$/;

function scanTree(salt, hashes, report) {
  let listed;
  try {
    listed = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  } catch (e) {
    process.stderr.write('ERROR: git ls-files failed (not a git work tree?)\n');
    process.exit(2);
  }
  const files = listed.split('\0').filter((f) => f && !TREE_SKIP.test(f));
  // Vacuity guard: a verdict over zero files is no verdict.
  if (files.length === 0) {
    process.stderr.write('ERROR: tree scan set is EMPTY; refusing to report a vacuous CLEAN\n');
    process.exit(2);
  }
  process.stdout.write(`hygiene tree scan: ${files.length} tracked file(s)\n`);
  let found = false;
  for (const f of files) {
    if (isSelfPath(f)) continue;
    if (checkLine(salt, hashes, `${f} (path)`, f, report)) found = true;
    if (BINARY_EXT.test(f)) continue;
    let st;
    try { st = fs.lstatSync(f); } catch (e) { continue; }
    if (!st.isFile()) continue; // symlinks / submodules: nothing to read
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (checkLine(salt, hashes, `${f}:${i + 1}`, lines[i], report)) found = true;
    }
  }
  return found;
}

function scanDiff(salt, hashes, diffText, report) {
  let found = false;
  let currentFile = '';
  let skipCurrent = false;
  let newLineno = 0;
  const lines = diffText.split('\n');
  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      currentFile = line.slice(4).replace(/^b\//, '');
      skipCurrent = isSelfPath(currentFile);
      if (!skipCurrent) {
        if (checkLine(salt, hashes, `${currentFile} (path)`, currentFile, report)) found = true;
      }
    } else if (line.startsWith('@@ ')) {
      const m = line.match(/\+(\d+)/);
      newLineno = m ? Math.max(0, parseInt(m[1], 10) - 1) : 0;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      newLineno += 1;
      if (skipCurrent) continue;
      const content = line.slice(1);
      if (checkLine(salt, hashes, `${currentFile}:${newLineno}`, content, report)) found = true;
    } else if (line.startsWith(' ')) {
      newLineno += 1;
    }
  }
  return found;
}

function main() {
  const args = process.argv.slice(2);
  const { salt, hashes } = loadDenylist();
  const messages = [];
  const report = (msg) => messages.push(msg);

  let found;
  if (args[0] === '--tree') {
    found = scanTree(salt, hashes, report);
  } else if (args[0] === '--files') {
    found = scanFiles(salt, hashes, args.slice(1), report);
  } else {
    // Default / --diff: read unified diff from stdin
    found = scanDiff(salt, hashes, readStdin(), report);
  }

  for (const m of messages) process.stdout.write(m + '\n');

  if (found) {
    process.stderr.write('❌ Hygiene scan FAILED: denylisted vocabulary detected (see locations above).\n');
    process.exit(1);
  }
  process.stdout.write('✅ Hygiene scan CLEAN\n');
  process.exit(0);
}

main();
