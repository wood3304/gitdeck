import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  checkoutBranch,
  commitChanges,
  discardPaths,
  getBranches,
  getCommitDetail,
  getDiff,
  getFileContent,
  getFileHistory,
  getLog,
  getRemotes,
  getStatus,
  parseStatusOutput,
  pushCurrentBranch,
  runGit,
  stagePaths,
  unstagePaths,
} from '../server/git.js';

test('parseStatusOutput understands porcelain v2 records', () => {
  const records = [
    '# branch.oid 1234567890abcdef',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb src/app.js',
    '2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 src/new name.js',
    'src/old name.js',
    'u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc conflict.js',
    '? docs/roadmap.md',
  ];
  const parsed = parseStatusOutput(`${records.join('\0')}\0`);
  assert.equal(parsed.branch.head, 'main');
  assert.equal(parsed.branch.ahead, 2);
  assert.equal(parsed.branch.behind, 1);
  assert.equal(parsed.files.length, 4);
  const modified = parsed.files.find((file) => file.path === 'src/app.js');
  assert.equal(modified.unstaged, true);
  assert.equal(modified.worktreeStatus, 'M');
  const renamed = parsed.files.find((file) => file.path === 'src/new name.js');
  assert.equal(renamed.origPath, 'src/old name.js');
  assert.equal(renamed.statusCode, 'R');
  const conflict = parsed.files.find((file) => file.path === 'conflict.js');
  assert.equal(conflict.conflicted, true);
  const untracked = parsed.files.find((file) => file.path === 'docs/roadmap.md');
  assert.equal(untracked.untracked, true);
});

test('git backend covers status, diff, stage, commit, history and branches', async (t) => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'gitdeck-test-'));
  t.after(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });
  await runGit(repo, ['init', '-b', 'main']);
  await runGit(repo, ['config', 'user.name', 'GitDeck Test']);
  await runGit(repo, ['config', 'user.email', 'gitdeck@example.com']);

  await fs.writeFile(path.join(repo, 'src.js'), 'export const answer = 41;\n');
  await fs.writeFile(path.join(repo, 'notes.md'), 'first line\n');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-m', 'chore: initial scaffold']);

  let status = await getStatus(repo);
  assert.equal(status.counts.total, 0);
  assert.equal(status.branchName, 'main');

  await fs.writeFile(path.join(repo, 'src.js'), 'export const answer = 42;\n');
  await fs.writeFile(path.join(repo, 'new-file.txt'), 'alpha\nbeta\n');
  status = await getStatus(repo);
  assert.equal(status.counts.total, 2);
  assert.equal(status.counts.untracked, 1);

  const worktreeDiff = await getDiff(repo, { path: 'src.js', mode: 'worktree' });
  assert.equal(worktreeDiff.status, 'modified');
  assert.equal(worktreeDiff.additions, 1);
  assert.equal(worktreeDiff.deletions, 1);
  assert.ok(worktreeDiff.hunks.length >= 1);

  const untrackedDiff = await getDiff(repo, { path: 'new-file.txt', mode: 'untracked' });
  assert.equal(untrackedDiff.status, 'added');
  assert.equal(untrackedDiff.additions, 2);

  status = await stagePaths(repo, ['src.js', 'new-file.txt']);
  assert.equal(status.counts.staged, 2);
  const stagedDiff = await getDiff(repo, { path: 'src.js', mode: 'staged' });
  assert.equal(stagedDiff.status, 'modified');

  status = await unstagePaths(repo, ['src.js']);
  assert.equal(status.counts.staged, 1);
  assert.equal(status.counts.unstaged, 1);

  await stagePaths(repo, ['src.js']);
  const committed = await commitChanges(repo, {
    message: 'feat: update answer\n\nKeep the test fixture meaningful.',
  });
  assert.equal(committed.status.counts.total, 0);
  assert.match(committed.commit.subject, /update answer/);

  const log = await getLog(repo, { limit: 10 });
  assert.equal(log.entries.length, 2);
  assert.equal(log.entries[0].subject, 'feat: update answer');

  const detail = await getCommitDetail(repo, log.entries[0].hash);
  assert.equal(detail.files.length, 2);
  assert.ok(detail.stats.additions >= 3);
  assert.match(detail.body, /meaningful/);

  const history = await getFileHistory(repo, { path: 'src.js' });
  assert.equal(history.entries.length, 2);
  assert.equal(history.exists, true);

  const snapshot = await getFileContent(repo, {
    path: 'src.js',
    rev: log.entries[0].hash,
  });
  assert.match(snapshot.content, /answer = 42/);
  assert.equal(snapshot.binary, false);

  const branches = await getBranches(repo);
  assert.equal(branches.local[0].current, true);

  await checkoutBranch(repo, { name: 'feature/demo', create: true });
  const branched = await getBranches(repo);
  assert.ok(branched.local.some((branch) => branch.name === 'feature/demo' && branch.current));
  await checkoutBranch(repo, { name: 'main' });

  await fs.writeFile(path.join(repo, 'notes.md'), 'first line\ndirty line\n');
  const discarded = await discardPaths(repo, ['notes.md']);
  assert.equal(discarded.counts.total, 0);
  const restored = await fs.readFile(path.join(repo, 'notes.md'), 'utf8');
  assert.equal(restored.replace(/\r\n/g, '\n'), 'first line\n');
});

test('git backend publishes a branch and pushes later commits', async (t) => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'gitdeck-push-source-'));
  const remote = await fs.mkdtemp(path.join(os.tmpdir(), 'gitdeck-push-remote-'));
  t.after(async () => {
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(remote, { recursive: true, force: true });
  });

  await runGit(repo, ['init', '-b', 'main']);
  await runGit(repo, ['config', 'user.name', 'GitDeck Test']);
  await runGit(repo, ['config', 'user.email', 'gitdeck@example.com']);
  await runGit(remote, ['init', '--bare']);
  await runGit(repo, ['remote', 'add', 'origin', remote]);

  await fs.writeFile(path.join(repo, 'README.md'), '# Push fixture\n');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-m', 'chore: initial push fixture']);

  const remotes = await getRemotes(repo);
  assert.equal(remotes.length, 1);
  assert.equal(remotes[0].name, 'origin');
  assert.ok(remotes[0].url.includes('gitdeck-push-remote-'));

  const firstPush = await pushCurrentBranch(repo, { setUpstream: true });
  assert.equal(firstPush.remote, 'origin');
  assert.equal(firstPush.setUpstream, true);
  assert.equal(firstPush.summary.upstream, 'origin/main');
  assert.match(await runGit(remote, ['log', 'main', '--oneline']), /initial push fixture/);

  await fs.writeFile(path.join(repo, 'README.md'), '# Push fixture\n\nSecond commit.\n');
  await runGit(repo, ['commit', '-am', 'feat: second pushed commit']);
  const secondPush = await pushCurrentBranch(repo, {});
  assert.equal(secondPush.setUpstream, false);
  assert.equal(secondPush.summary.ahead, 0);
  assert.match(await runGit(remote, ['log', 'main', '--oneline']), /second pushed commit/);
});
