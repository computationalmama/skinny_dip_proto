#!/usr/bin/env node
/**
 * Push ../dist to the `gh-pages` branch.
 *
 *   node deploy.js          # or: npm run deploy  (exports first)
 *
 * A detached temporary worktree rather than a branch checkout, so nothing
 * touches the working tree you're in — no stashing, no switching back. The
 * branch carries a single commit each time (`--orphan`), because its history is
 * build output and nobody needs to diff it.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const WORK = path.join(ROOT, '.gh-pages-worktree');
const BRANCH = 'gh-pages';

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitIn = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('No dist/index.html. Run: npm run export:static');
  process.exit(1);
}

const cleanup = () => {
  try { git('worktree', 'remove', '--force', WORK); } catch {}
  fs.rmSync(WORK, { recursive: true, force: true });
};

cleanup();

try {
  console.log(`Preparing ${BRANCH} worktree…`);
  git('worktree', 'add', '--detach', WORK);
  gitIn(WORK, 'checkout', '--orphan', BRANCH);
  gitIn(WORK, 'rm', '-rf', '--quiet', '.');

  console.log('Copying dist/…');
  fs.cpSync(DIST, WORK, { recursive: true });

  gitIn(WORK, 'add', '-A');
  const sha = git('rev-parse', '--short', 'HEAD');
  gitIn(WORK, 'commit', '-m', `Deploy seeds canvas (from ${sha})`);

  console.log(`Pushing ${BRANCH}…`);
  gitIn(WORK, 'push', '--force', 'origin', `${BRANCH}:${BRANCH}`);

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
}
