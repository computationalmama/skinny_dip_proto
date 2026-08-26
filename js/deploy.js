#!/usr/bin/env node
/**
 * Push ../dist to the `gh-pages` branch.
 *
 *   node deploy.js          # or: npm run deploy  (exports first)
 *
 * A temporary worktree rather than a branch checkout, so nothing touches the
 * working tree you're in — no stashing, no switching back. The branch carries a
 * single commit each time (`--orphan`), because its history is build output and
 * nobody needs to diff it.
 *
 * The worktree lives in the system temp dir, deliberately NOT inside the repo.
 * An earlier version put it at ROOT/.gh-pages-worktree, which meant this script
 * ran `git worktree remove --force` and `fs.rmSync` on a path inside the working
 * tree it was trying to protect. During that period the main worktree was found
 * checked out to gh-pages with every tracked file — including the source corpus
 * under docs/ — deleted from disk. The cause was never pinned to a specific
 * command, so this doesn't claim to be the fix for it; it removes the sharp edge
 * either way, and the check at the end fails loudly if the branch ever moves.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
// Outside the repo on purpose — see the note at the top of this file.
const WORK = path.join(os.tmpdir(), 'skinny-dip-gh-pages');
const BRANCH = 'gh-pages';
// The commit is built on a throwaway branch and pushed straight to the remote
// ref, so no local `gh-pages` ever exists. That isn't only tidiness: a local
// branch of build output is something a stray `git checkout gh-pages` can land
// on, which empties the working tree of every source file.
const TEMP = 'gh-pages-build';

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitIn = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('No dist/index.html. Run: npm run export:static');
  process.exit(1);
}

// Also runs before the build, in case a previous run died partway through.
const cleanup = () => {
  if (fs.existsSync(WORK)) {
    try { git('worktree', 'remove', '--force', WORK); } catch {}
  }
  git('worktree', 'prune');
  try { git('branch', '-D', TEMP); } catch {}

  // Refuse to recursively delete anything inside the repo, whatever WORK says.
  if (path.resolve(WORK).startsWith(path.resolve(ROOT) + path.sep)) {
    throw new Error(`Refusing to remove ${WORK}: it is inside the repository.`);
  }
  fs.rmSync(WORK, { recursive: true, force: true });
};

// What the working tree is on now, so we can prove we left it there.
const startedOn = git('rev-parse', '--abbrev-ref', 'HEAD');
const startedAt = git('rev-parse', 'HEAD');

cleanup();

try {
  console.log(`Preparing ${BRANCH} worktree…`);
  git('worktree', 'add', '--detach', WORK);
  gitIn(WORK, 'checkout', '--orphan', TEMP);
  gitIn(WORK, 'rm', '-rf', '--quiet', '.');

  console.log('Copying dist/…');
  fs.cpSync(DIST, WORK, { recursive: true });

  // The export writes data/*.json incrementally and can still be running, so a
  // copy can catch a file mid-write. Parsing them here turns that race into a
  // failed deploy you retry, rather than a live site with truncated JSON.
  const dataDir = path.join(WORK, 'data');
  if (fs.existsSync(dataDir)) {
    for (const name of fs.readdirSync(dataDir).filter((f) => f.endsWith('.json'))) {
      const file = path.join(dataDir, name);
      try {
        JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        throw new Error(`data/${name} is not valid JSON (${e.message}). ` +
                        'If the export is still running, wait for it and deploy again.');
      }
    }
    console.log(`  checked ${fs.readdirSync(dataDir).filter((f) => f.endsWith('.json')).length} JSON files`);
  }

  gitIn(WORK, 'add', '-A');
  const sha = git('rev-parse', '--short', 'HEAD');
  gitIn(WORK, 'commit', '-m', `Deploy seeds canvas (from ${sha})`);

  // HEAD:refs/heads/... rather than a branch pair, since there is no local
  // branch by that name to push from.
  console.log(`Pushing ${BRANCH}…`);
  gitIn(WORK, 'push', '--force', 'origin', `HEAD:refs/heads/${BRANCH}`);

  const url = git('remote', 'get-url', 'origin')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '');
  const [, user, repo] = url.match(/github\.com\/([^/]+)\/([^/]+)$/) || [];

  console.log('\nPushed.');
  if (user) {
    console.log(`Set Pages to branch ${BRANCH} / root, once:`);
    console.log(`  ${url}/settings/pages`);
    console.log(`\nThen it's live at:\n  https://${user}.github.io/${repo}/`);
  }
} finally {
  cleanup();

  // The whole point of the worktree is that your checkout doesn't move. If it
  // did, say so here rather than leaving it to be discovered as missing files.
  const endedOn = git('rev-parse', '--abbrev-ref', 'HEAD');
  const endedAt = git('rev-parse', 'HEAD');

  if (endedOn !== startedOn || endedAt !== startedAt) {
    console.error(`\n! Your working tree moved: ${startedOn} @ ${startedAt.slice(0, 7)}` +
                  ` -> ${endedOn} @ ${endedAt.slice(0, 7)}`);
    console.error(`! Nothing is lost — get back with: git checkout ${startedOn}`);
    process.exitCode = 1;
  }
}
