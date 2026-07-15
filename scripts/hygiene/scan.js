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
 *
 * Exit codes: 0 = clean, 1 = denylisted token found, 2 = setup error.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

function checkLine(salt, hashes, location, text, report) {
  let hit = false;
  for (const candidate of extractCandidates(text)) {
    const h = hashWord(salt, candidate);
    if (hashes.has(h)) {
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
  if (args[0] === '--files') {
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
