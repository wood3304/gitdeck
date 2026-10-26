import { spawn, spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { AppError, GitError } from './errors.js';

const GIT_BIN = process.env.GITDECK_GIT || 'git';
const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURE_TMP = path.join(PROJECT_ROOT, '.data', 'tmp');
const FILE_CAPTURE =
  process.env.GITDECK_GIT_CAPTURE === 'file' ||
  (process.platform === 'win32' && process.env.GITDECK_GIT_CAPTURE !== 'pipe');

function gitArgs(args) {
  return [
    '--no-pager',
    '-c',
    'color.ui=false',
    '-c',
    'core.quotepath=false',
    '--literal-pathspecs',
    ...args,
  ];
}

export function isWindows() {
  return process.platform === 'win32';
}

function pathKey(value) {
  const resolved = path.resolve(value);
  return isWindows() ? resolved.toLowerCase() : resolved;
}

export function stripUserPath(input) {
  let value = String(input ?? '').trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (value === '~') value = os.homedir();
  else if (value.startsWith('~/') || value.startsWith('~\\')) {
    value = path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

export function normalizeRepoRelPath(input) {
  if (input == null || input === '') {
    throw new AppError('缺少文件路径', { status: 400, code: 'missing_path' });
  }
  let value = String(input).replace(/\\/g, '/');
  if (value.includes('\0')) {
    throw new AppError('文件路径包含非法字符', { status: 400, code: 'invalid_path' });
  }
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new AppError('文件路径必须是代码库内的相对路径', {
      status: 400,
      code: 'invalid_path',
    });
  }
  value = path.posix.normalize(value).replace(/^\.\//, '');
  if (value === '.' || value === '..' || value.startsWith('../')) {
    throw new AppError('文件路径越过了代码库边界', {
      status: 400,
      code: 'invalid_path',
    });
  }
  return value;
}

export function resolveInside(root, relPath) {
  const normalized = normalizeRepoRelPath(relPath);
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, ...normalized.split('/'));
  const relative = path.relative(rootAbs, abs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('文件路径越过了代码库边界', {
      status: 400,
      code: 'invalid_path',
    });
  }
  return abs;
}

function clamp(value, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function redactRemoteUrl(value) {
  return String(value || '').replace(
    /\b([a-z][a-z0-9+.-]*:\/\/)([^@\s/]+)@/gi,
    '$1***@',
  );
}

function gitCaptureEnv(options) {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    LC_ALL: 'C',
    ...options.env,
  };
}

function runGitPipeCapture(cwd, args, options = {}) {
  const timeout = options.timeout ?? 30_000;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const env = gitCaptureEnv(options);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(GIT_BIN, gitArgs(args), {
        cwd,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(new GitError(`无法启动 Git：${error.message}`, { args }));
      return;
    }

    const stdout = [];
    const stderr = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let settled = false;
    let timedOut = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(1, timeout));

    child.stdout.on('data', (chunk) => {
      stdoutSize += chunk.length;
      if (stdoutSize <= maxBuffer) stdout.push(chunk);
      else child.kill();
    });
    child.stderr.on('data', (chunk) => {
      stderrSize += chunk.length;
      if (stderrSize <= maxBuffer) stderr.push(chunk);
    });

    child.on('error', (error) => {
      finish(reject, new GitError(`无法执行 Git：${error.message}`, { args }));
    });

    child.on('close', (code) => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      const textOut = out.toString('utf8');
      const textErr = err.toString('utf8');
      if (timedOut) {
        finish(
          reject,
          new GitError('Git 操作超时，请稍后重试', {
            args,
            stdout: textOut,
            stderr: textErr,
            exitCode: code,
          }),
        );
        return;
      }
      if (stdoutSize > maxBuffer) {
        finish(
          reject,
          new GitError('Git 输出过大，已停止读取', {
            args,
            stdout: textOut,
            stderr: textErr,
            exitCode: code,
          }),
        );
        return;
      }
      finish(resolve, { stdout: out, stderr: err, textOut, textErr, code });
    });
  });
}

async function runGitFileCapture(cwd, args, options = {}) {
  const timeout = options.timeout ?? 30_000;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const env = gitCaptureEnv(options);
  await fs.mkdir(CAPTURE_TMP, { recursive: true });
  const workDir = await fs.mkdtemp(path.join(CAPTURE_TMP, 'cmd-'));
  const outPath = path.join(workDir, 'stdout');
  const errPath = path.join(workDir, 'stderr');
  let outFd = null;
  let errFd = null;
  let child = null;
  try {
    outFd = fsSync.openSync(outPath, 'w');
    errFd = fsSync.openSync(errPath, 'w');
    child = spawn(GIT_BIN, gitArgs(args), {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', outFd, errFd],
    });
  } catch (error) {
    if (outFd !== null) fsSync.closeSync(outFd);
    if (errFd !== null) fsSync.closeSync(errFd);
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw new GitError(`无法启动 Git：${error.message}`, { args });
  }

  const result = await new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(1, timeout));
    child.on('error', (error) => finish({ spawnError: error }));
    child.on('close', (code, signal) => finish({ code, signal, timedOut }));
  });

  try {
    if (outFd !== null) fsSync.closeSync(outFd);
    if (errFd !== null) fsSync.closeSync(errFd);
    if (result.spawnError) {
      throw new GitError(`无法执行 Git：${result.spawnError.message}`, { args });
    }
    const [out, err] = await Promise.all([fs.readFile(outPath), fs.readFile(errPath)]);
    const textOut = out.toString('utf8');
    const textErr = err.toString('utf8');
    if (result.timedOut) {
      throw new GitError('Git 操作超时，请稍后重试', {
        args,
        stdout: textOut,
        stderr: textErr,
        exitCode: result.code,
      });
    }
    if (out.length > maxBuffer) {
      throw new GitError('Git 输出过大，已停止读取', {
        args,
        stdout: textOut,
        stderr: textErr,
        exitCode: result.code,
      });
    }
    return { stdout: out, stderr: err, textOut, textErr, code: result.code };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function runGitRaw(cwd, args, options = {}) {
  return FILE_CAPTURE
    ? runGitFileCapture(cwd, args, options)
    : runGitPipeCapture(cwd, args, options);
}

export async function runGit(cwd, args, options = {}) {
  const result = await runGitRaw(cwd, args, options);
  if (result.code !== 0) {
    throw new GitError(`Git ${args[0] || ''} 执行失败`, {
      args,
      stdout: result.textOut,
      stderr: result.textErr,
      exitCode: result.code,
    });
  }
  return result.textOut;
}

async function tryGit(cwd, args, options = {}) {
  try {
    return await runGitRaw(cwd, args, options);
  } catch (error) {
    return {
      code: -1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      textOut: '',
      textErr: error.message || '',
    };
  }
}

export async function resolveRepo(inputPath) {
  if (!inputPath) {
    throw new AppError('请输入代码库路径', { status: 400, code: 'missing_path' });
  }
  let candidate = stripUserPath(inputPath);
  let stat;
  try {
    stat = await fs.stat(candidate);
  } catch {
    throw new AppError(`路径不存在：${candidate}`, {
      status: 400,
      code: 'path_not_found',
    });
  }
  if (!stat.isDirectory()) {
    candidate = path.dirname(candidate);
  }

  const result = await tryGit(candidate, ['rev-parse', '--show-toplevel']);
  if (result.code !== 0) {
    throw new AppError('该目录不是 Git 代码库，请选择包含 .git 的项目目录', {
      status: 400,
      code: 'not_a_repo',
      detail: result.textErr.trim(),
    });
  }
  const topLevel = result.textOut.trim();
  if (!topLevel) {
    throw new AppError('无法确定 Git 代码库根目录', {
      status: 400,
      code: 'not_a_repo',
    });
  }
  const real = await fs.realpath(topLevel).catch(() => path.resolve(topLevel));
  const bare = await tryGit(real, ['rev-parse', '--is-bare-repository']);
  if (bare.textOut.trim() === 'true') {
    throw new AppError('暂不支持裸仓库（bare repository）', {
      status: 400,
      code: 'bare_repo',
    });
  }
  return { path: real, name: path.basename(real), key: pathKey(real) };
}

export async function assertRepoPath(repoPath) {
  try {
    const stat = await fs.stat(repoPath);
    if (!stat.isDirectory()) throw new Error('not directory');
  } catch {
    throw new AppError('代码库目录已不存在或不可访问', {
      status: 404,
      code: 'repo_missing',
    });
  }
  return repoPath;
}

export async function getGitVersion() {
  const result = await tryGit(process.cwd(), ['--version'], { timeout: 5000 });
  return result.textOut.trim().replace(/^git version\s*/i, '') || 'unknown';
}

function normalizeDate(value) {
  return String(value || '').trim();
}

function parseRefs(decoration) {
  if (!decoration) return [];
  return String(decoration)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((raw) => {
      if (raw.startsWith('HEAD -> ')) {
        return { kind: 'head', name: raw.slice('HEAD -> '.length), raw };
      }
      if (raw === 'HEAD') return { kind: 'head', name: 'HEAD', raw };
      if (raw.startsWith('tag: ')) {
        return { kind: 'tag', name: raw.slice(5), raw };
      }
      if (/^(origin|upstream)\//.test(raw)) {
        return { kind: 'remote', name: raw, raw };
      }
      return { kind: 'branch', name: raw, raw };
    });
}

function parseBranchInfo(records) {
  const info = {
    oid: '',
    head: '',
    upstream: '',
    ahead: 0,
    behind: 0,
    detached: false,
    unborn: false,
  };
  for (const record of records) {
    if (record.startsWith('# branch.oid ')) {
      info.oid = record.slice(13).trim();
      if (info.oid === '(initial)') {
        info.unborn = true;
        info.oid = '';
      }
    } else if (record.startsWith('# branch.head ')) {
      info.head = record.slice(14).trim();
      info.detached = info.head === '(detached)';
    } else if (record.startsWith('# branch.upstream ')) {
      info.upstream = record.slice(18).trim();
    } else if (record.startsWith('# branch.ab ')) {
      const match = record.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        info.ahead = Number(match[1]);
        info.behind = Number(match[2]);
      }
    }
  }
  return info;
}

const STATUS_TEXT = {
  M: '修改',
  A: '新增',
  D: '删除',
  R: '重命名',
  C: '复制',
  T: '类型变更',
  U: '冲突',
  '?': '未跟踪',
};

function fileFromStatus({ x, y, filePath, origPath, conflict, untracked }) {
  const indexCode = x && x !== '.' ? x : null;
  const worktreeCode = y && y !== '.' ? y : null;
  let statusCode = 'M';
  if (untracked) statusCode = '?';
  else if (conflict) statusCode = 'U';
  else if (worktreeCode) statusCode = worktreeCode;
  else if (indexCode) statusCode = indexCode;
  return {
    path: filePath,
    origPath: origPath || null,
    indexStatus: indexCode,
    worktreeStatus: worktreeCode,
    statusCode,
    statusText: STATUS_TEXT[statusCode] || '变更',
    staged: !untracked && !conflict && Boolean(indexCode),
    unstaged: !untracked && !conflict && Boolean(worktreeCode),
    untracked: Boolean(untracked),
    conflicted: Boolean(conflict),
    additions: 0,
    deletions: 0,
    binary: false,
  };
}

export function parseStatusOutput(output) {
  const records = String(output).split('\0');
  const branch = parseBranchInfo(records);
  const files = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.startsWith('#')) continue;
    if (record.startsWith('1 ')) {
      const match = record.match(
        /^1 ([^ ]{2}) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([\s\S]+)$/,
      );
      if (match) {
        files.push(
          fileFromStatus({
            x: match[1][0],
            y: match[1][1],
            filePath: match[8],
          }),
        );
      }
    } else if (record.startsWith('2 ')) {
      const match = record.match(
        /^2 ([^ ]{2}) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([\s\S]+)$/,
      );
      if (match) {
        const origPath = records[index + 1] || null;
        index += 1;
        files.push(
          fileFromStatus({
            x: match[1][0],
            y: match[1][1],
            filePath: match[9],
            origPath,
          }),
        );
      }
    } else if (record.startsWith('u ')) {
      const match = record.match(
        /^u ([^ ]{2}) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([\s\S]+)$/,
      );
      if (match) {
        files.push(
          fileFromStatus({
            x: match[1][0],
            y: match[1][1],
            filePath: match[10],
            conflict: true,
          }),
        );
      }
    } else if (record.startsWith('? ')) {
      files.push(
        fileFromStatus({
          x: '?',
          y: '?',
          filePath: record.slice(2),
          untracked: true,
        }),
      );
    }
  }
  return { branch, files };
}

function parseNumstat(output) {
  const tokens = String(output).split('\0');
  const entries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const firstTab = token.indexOf('\t');
    const secondTab = token.indexOf('\t', firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const adds = token.slice(0, firstTab);
    const dels = token.slice(firstTab + 1, secondTab);
    let filePath = token.slice(secondTab + 1);
    let oldPath = null;
    if (!filePath) {
      oldPath = tokens[index + 1] || null;
      filePath = tokens[index + 2] || null;
      index += 2;
    }
    if (!filePath) continue;
    entries.push({
      path: filePath,
      oldPath,
      additions: adds === '-' ? null : Number(adds) || 0,
      deletions: dels === '-' ? null : Number(dels) || 0,
      binary: adds === '-' || dels === '-',
    });
  }
  return entries;
}

async function countTextFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return { binary: false, lines: 0 };
    const buffer = await fs.readFile(filePath);
    if (buffer.includes(0)) return { binary: true, lines: 0 };
    const text = buffer.toString('utf8');
    if (!text.length) return { binary: false, lines: 0 };
    const lines = text.split(/\r?\n/);
    if (lines[lines.length - 1] === '') lines.pop();
    return { binary: false, lines: lines.length };
  } catch {
    return { binary: false, lines: 0 };
  }
}

async function addStats(repoPath, files) {
  if (!files.length) return;
  const head = await tryGit(repoPath, ['rev-parse', '--verify', 'HEAD']);
  let numstat = '';
  if (head.code === 0) {
    numstat = await tryGit(repoPath, [
      'diff',
      '--numstat',
      '-z',
      '--find-renames',
      'HEAD',
      '--',
    ]).then((result) => result.textOut);
  } else {
    const [cached, worktree] = await Promise.all([
      tryGit(repoPath, ['diff', '--numstat', '-z', '--cached', '--']),
      tryGit(repoPath, ['diff', '--numstat', '-z', '--']),
    ]);
    numstat = `${cached.textOut}${worktree.textOut}`;
  }
  const stats = parseNumstat(numstat);
  const byPath = new Map();
  for (const entry of stats) {
    byPath.set(entry.path, entry);
    if (entry.oldPath) byPath.set(entry.oldPath, entry);
  }
  await Promise.all(
    files.map(async (file) => {
      const entry = byPath.get(file.path) || byPath.get(file.origPath);
      if (entry) {
        file.additions = entry.additions ?? 0;
        file.deletions = entry.deletions ?? 0;
        file.binary = entry.binary;
        return;
      }
      if (file.untracked) {
        try {
          const abs = resolveInside(repoPath, file.path);
          const counted = await countTextFile(abs);
          file.additions = counted.lines;
          file.binary = counted.binary;
        } catch {
          // Ignore unreadable untracked files; status still renders.
        }
      }
    }),
  );
}

export async function getStatus(repoPath, options = {}) {
  await assertRepoPath(repoPath);
  const limit = clamp(options.limit ?? 5000, 1, 20000);
  const raw = await runGit(repoPath, [
    'status',
    '--porcelain=v2',
    '--branch',
    '--untracked-files=all',
    '-z',
  ]);
  const { branch, files } = parseStatusOutput(raw);
  if (options.includeStats !== false) {
    await addStats(repoPath, files.slice(0, limit));
  }
  const counts = {
    total: files.length,
    staged: files.filter((file) => file.staged).length,
    unstaged: files.filter((file) => file.unstaged).length,
    untracked: files.filter((file) => file.untracked).length,
    conflicted: files.filter((file) => file.conflicted).length,
  };
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    branch: branch.detached ? `HEAD 分离于 ${branch.oid.slice(0, 7)}` : branch.head || 'unknown',
    branchName: branch.head,
    detached: branch.detached,
    unborn: branch.unborn,
    upstream: branch.upstream,
    ahead: branch.ahead,
    behind: branch.behind,
    oid: branch.oid,
    files: files.slice(0, limit),
    counts,
    truncated: files.length > limit,
    limit,
    hasCommits: Boolean(branch.oid),
  };
}

export async function getLastCommit(repoPath) {
  const result = await tryGit(repoPath, [
    'log',
    '-1',
    '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%D',
    'HEAD',
  ]);
  if (result.code !== 0 || !result.textOut.trim()) return null;
  const parts = result.textOut.replace(/\r?\n$/, '').split('\x1f');
  return {
    hash: parts[0] || '',
    shortHash: parts[1] || '',
    subject: parts[2] || '',
    author: parts[3] || '',
    authorEmail: parts[4] || '',
    date: normalizeDate(parts[5]),
    refs: parseRefs(parts[6] || ''),
  };
}

export async function getRemotes(repoPath) {
  await assertRepoPath(repoPath);
  const raw = await runGit(repoPath, ['remote', '-v']);
  const remotes = new Map();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^(\S+)\s+(.+?)\s+\((fetch|push)\)$/);
    if (!match) continue;
    const [, name, url, kind] = match;
    const entry = remotes.get(name) || {
      name,
      fetchUrl: '',
      pushUrl: '',
      url: '',
    };
    if (kind === 'fetch') entry.fetchUrl = redactRemoteUrl(url);
    else entry.pushUrl = redactRemoteUrl(url);
    entry.url = entry.pushUrl || entry.fetchUrl;
    remotes.set(name, entry);
  }
  return [...remotes.values()].map((remote) => ({
    ...remote,
    url: remote.pushUrl || remote.fetchUrl,
  }));
}

export async function getRepoSummary(repoPath) {
  await assertRepoPath(repoPath);
  const [status, lastCommit, remoteResult, remotes] = await Promise.all([
    getStatus(repoPath, { includeStats: false, limit: 5000 }),
    getLastCommit(repoPath),
    tryGit(repoPath, ['remote', 'get-url', 'origin']),
    getRemotes(repoPath).catch(() => []),
  ]);
  const originRemote = remotes.find((remote) => remote.name === 'origin');
  const remote =
    originRemote?.url ||
    (remoteResult.code === 0 ? redactRemoteUrl(remoteResult.textOut.trim()) : '') ||
    remotes[0]?.url ||
    '';
  return {
    path: repoPath,
    name: path.basename(repoPath),
    branch: status.branch,
    branchName: status.branchName,
    detached: status.detached,
    unborn: status.unborn,
    upstream: status.upstream,
    ahead: status.ahead,
    behind: status.behind,
    head: status.oid,
    counts: status.counts,
    hasCommits: status.hasCommits,
    lastCommit,
    remote,
    remotes,
  };
}

function normalizeLogRecord(record) {
  const cleaned = record.replace(/^\r?\n/, '');
  if (!cleaned) return null;
  const parts = cleaned.split('\x1f');
  if (parts.length < 10) return null;
  const [
    hash,
    shortHash,
    parentsRaw,
    author,
    authorEmail,
    authorDate,
    commitDate,
    decorations,
    subject,
  ] = parts;
  const body = parts.slice(9).join('\x1f').replace(/\s+$/, '');
  return {
    hash,
    shortHash,
    parents: parentsRaw ? parentsRaw.split(' ').filter(Boolean) : [],
    author,
    authorEmail,
    authorDate: normalizeDate(authorDate),
    commitDate: normalizeDate(commitDate),
    refs: parseRefs(decorations),
    subject,
    body,
  };
}

export async function getLog(repoPath, options = {}) {
  await assertRepoPath(repoPath);
  const limit = clamp(options.limit ?? 60, 1, 200);
  const skip = clamp(options.skip ?? 0, 0, 100000);
  const all = Boolean(options.all);
  const query = String(options.query || '').trim();
  const author = String(options.author || '').trim();
  const branch = String(options.branch || '').trim();
  const filePath = options.path ? normalizeRepoRelPath(options.path) : null;
  const follow = Boolean(options.follow && filePath);

  if (branch && branch.startsWith('-')) {
    throw new AppError('非法分支名称', { status: 400, code: 'invalid_branch' });
  }

  const args = [
    'log',
    '--date=iso-strict',
    '--decorate=short',
    `--max-count=${limit + 1}`,
  ];
  if (skip > 0) args.push(`--skip=${skip}`);
  args.push(
    '--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cI%x1f%D%x1f%s%x1f%b%x1e',
  );
  if (query) {
    args.push('--regexp-ignore-case', '--fixed-strings', `--grep=${query}`);
  }
  if (author) args.push(`--author=${author}`);
  if (all) args.push('--all');
  else if (branch && branch !== 'HEAD') args.push(branch);
  if (follow) args.push('--follow');
  if (filePath) args.push('--', filePath);

  const raw = await runGit(repoPath, args);
  const entries = raw
    .split('\x1e')
    .map(normalizeLogRecord)
    .filter(Boolean);
  const hasMore = entries.length > limit;
  return {
    entries: entries.slice(0, limit),
    hasMore,
    skip,
    limit,
    path: filePath,
    all,
    branch: branch || null,
  };
}

export function validateCommitHash(value) {
  const hash = String(value || '').trim();
  if (!/^[0-9a-fA-F]{4,64}$/.test(hash)) {
    throw new AppError('提交哈希格式不正确', { status: 400, code: 'invalid_hash' });
  }
  return hash;
}

export async function resolveCommit(repoPath, value) {
  if (value === 'WORKTREE') return 'WORKTREE';
  const hash = validateCommitHash(value);
  const verified = await tryGit(repoPath, ['rev-parse', '--verify', `${hash}^{commit}`]);
  if (verified.code !== 0) {
    throw new AppError('找不到指定的提交', { status: 404, code: 'commit_not_found' });
  }
  return verified.textOut.trim();
}

export async function hasHead(repoPath) {
  const head = await tryGit(repoPath, ['rev-parse', '--verify', 'HEAD']);
  return head.code === 0 && Boolean(head.textOut.trim());
}

function parseNameStatus(output) {
  const tokens = String(output).split('\0');
  const files = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const status = tokens[index];
    if (!status) continue;
    const code = status[0];
    if (code === 'R' || code === 'C') {
      const oldPath = tokens[index + 1];
      const newPath = tokens[index + 2];
      index += 2;
      if (newPath) {
        files.push({
          path: newPath,
          oldPath,
          statusCode: code,
          statusText: code === 'R' ? '重命名' : '复制',
        });
      }
    } else {
      const filePath = tokens[index + 1];
      index += 1;
      if (filePath) {
        files.push({
          path: filePath,
          oldPath: null,
          statusCode: code,
          statusText: STATUS_TEXT[code] || '变更',
        });
      }
    }
  }
  return files;
}

export async function getCommitDetail(repoPath, commitValue) {
  await assertRepoPath(repoPath);
  const hash = await resolveCommit(repoPath, commitValue);
  if (hash === 'WORKTREE') {
    throw new AppError('提交详情需要具体的提交哈希', {
      status: 400,
      code: 'invalid_hash',
    });
  }
  const metaRaw = await runGit(repoPath, [
    'show',
    '-s',
    '--date=iso-strict',
    '--decorate=short',
    '--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%D%x1f%s%x1f%b',
    hash,
  ]);
  const fields = metaRaw.split('\x1f');
  const parents = fields[2] ? fields[2].split(' ').filter(Boolean) : [];
  const parent = parents[0] || null;
  let nameStatusRaw;
  if (parent) {
    nameStatusRaw = await runGit(repoPath, [
      'diff',
      '--name-status',
      '-z',
      '--find-renames',
      parent,
      hash,
    ]);
  } else {
    nameStatusRaw = await runGit(repoPath, [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-status',
      '-r',
      '-z',
      '--find-renames',
      hash,
    ]);
  }
  let files = parseNameStatus(nameStatusRaw);
  const numstatArgs = parent
    ? ['diff', '--numstat', '-z', '--find-renames', parent, hash]
    : ['diff-tree', '--root', '--numstat', '-z', '-r', '--find-renames', hash];
  const numstatRaw = await runGit(repoPath, numstatArgs);
  const stats = parseNumstat(numstatRaw);
  const byPath = new Map();
  for (const entry of stats) {
    byPath.set(entry.path, entry);
    if (entry.oldPath) byPath.set(entry.oldPath, entry);
  }
  files = files.map((file) => {
    const entry = byPath.get(file.path) || byPath.get(file.oldPath);
    return {
      ...file,
      additions: entry?.additions ?? 0,
      deletions: entry?.deletions ?? 0,
      binary: Boolean(entry?.binary),
    };
  });
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    hash: fields[0] || hash,
    shortHash: fields[1] || hash.slice(0, 7),
    parents,
    parent,
    isMerge: parents.length > 1,
    author: fields[3] || '',
    authorEmail: fields[4] || '',
    authorDate: normalizeDate(fields[5]),
    committer: fields[6] || '',
    committerEmail: fields[7] || '',
    commitDate: normalizeDate(fields[8]),
    refs: parseRefs(fields[9] || ''),
    subject: fields[10] || '',
    body: fields.slice(11).join('\x1f').replace(/\s+$/, ''),
    files,
    stats: {
      files: files.length,
      additions: files.reduce((sum, file) => sum + (file.additions || 0), 0),
      deletions: files.reduce((sum, file) => sum + (file.deletions || 0), 0),
    },
    base: parent,
  };
}

function parsePatch(patch, fallbackPath, labels) {
  const text = String(patch || '');
  const lines = text.split('\n');
  let status = 'modified';
  let binary = false;
  let oldPath = fallbackPath;
  let newPath = fallbackPath;
  let oldMode = null;
  let newMode = null;
  let renameFrom = null;
  let renameTo = null;
  let similarity = null;
  const hunks = [];
  let current = null;
  let noNewlineTarget = null;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.*?) b\/(.*)$/);
      if (match) {
        oldPath = oldPath || match[1];
        newPath = match[2];
      }
      continue;
    }
    if (line.startsWith('old mode ')) {
      oldMode = line.slice(9).trim();
      continue;
    }
    if (line.startsWith('new mode ')) {
      newMode = line.slice(9).trim();
      continue;
    }
    if (line.startsWith('new file mode ')) {
      status = 'added';
      newMode = line.slice(14).trim();
      continue;
    }
    if (line.startsWith('deleted file mode ')) {
      status = 'deleted';
      oldMode = line.slice(18).trim();
      continue;
    }
    if (line.startsWith('rename from ')) {
      renameFrom = line.slice(12);
      status = 'renamed';
      continue;
    }
    if (line.startsWith('rename to ')) {
      renameTo = line.slice(10);
      status = 'renamed';
      continue;
    }
    if (line.startsWith('similarity index ')) {
      similarity = line.slice(17).trim();
      continue;
    }
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      binary = true;
      continue;
    }
    if (line.startsWith('--- ')) {
      const value = line.slice(4);
      if (value === '/dev/null') status = 'added';
      else if (!oldPath) oldPath = value.replace(/^a\//, '');
      continue;
    }
    if (line.startsWith('+++ ')) {
      const value = line.slice(4);
      if (value === '/dev/null') status = 'deleted';
      else if (!newPath) newPath = value.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('@@')) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/);
      if (!match) continue;
      current = {
        header: line,
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        section: match[5] || '',
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line === '\\ No newline at end of file') {
      if (noNewlineTarget) noNewlineTarget.noNewline = true;
      continue;
    }
    if (!line) {
      // A blank line is a valid context line only when prefixed with a space.
      // Trailing blank lines at the end of a patch are ignored.
      continue;
    }
    const prefix = line[0];
    if (prefix !== ' ' && prefix !== '+' && prefix !== '-') continue;
    const entry = {
      type: prefix === ' ' ? 'context' : prefix === '+' ? 'add' : 'del',
      content: line.slice(1),
      oldLine: null,
      newLine: null,
      noNewline: false,
    };
    if (entry.type !== 'add') entry.oldLine = current.oldStart;
    if (entry.type !== 'del') entry.newLine = current.newStart;
    if (entry.type === 'context') {
      current.oldStart += 1;
      current.newStart += 1;
    } else if (entry.type === 'add') {
      current.newStart += 1;
    } else {
      current.oldStart += 1;
    }
    current.lines.push(entry);
    noNewlineTarget = entry;
  }

  if (renameFrom) oldPath = renameFrom;
  if (renameTo) newPath = renameTo;
  const additions = hunks.reduce(
    (sum, hunk) => sum + hunk.lines.filter((line) => line.type === 'add').length,
    0,
  );
  const deletions = hunks.reduce(
    (sum, hunk) => sum + hunk.lines.filter((line) => line.type === 'del').length,
    0,
  );

  return {
    path: newPath || oldPath,
    oldPath: oldPath || newPath,
    newPath: newPath || oldPath,
    status,
    binary,
    oldMode,
    newMode,
    similarity,
    hunks,
    additions,
    deletions,
    isEmpty: !binary && hunks.length === 0,
    labels,
  };
}

function syntheticUntrackedDiff(repoPath, relPath, buffer, labels) {
  const binary = buffer.includes(0);
  if (binary) {
    return {
      path: relPath,
      oldPath: relPath,
      newPath: relPath,
      status: 'added',
      binary: true,
      oldMode: null,
      newMode: null,
      similarity: null,
      hunks: [],
      additions: 0,
      deletions: 0,
      isEmpty: false,
      labels,
    };
  }
  let text = buffer.toString('utf8');
  if (text.length > 1_500_000) text = text.slice(0, 1_500_000);
  const rawLines = text.split(/\r?\n/);
  if (rawLines.length && rawLines[rawLines.length - 1] === '') rawLines.pop();
  const lines = rawLines.map((content, index) => ({
    type: 'add',
    content,
    oldLine: null,
    newLine: index + 1,
    noNewline: false,
  }));
  const hunk = {
    header: `@@ -0,0 +1,${Math.max(1, lines.length)} @@`,
    oldStart: 0,
    oldCount: 0,
    newStart: 1,
    newCount: lines.length,
    section: '',
    lines,
  };
  return {
    path: relPath,
    oldPath: relPath,
    newPath: relPath,
    status: 'added',
    binary: false,
    oldMode: null,
    newMode: null,
    similarity: null,
    hunks: lines.length ? [hunk] : [],
    additions: lines.length,
    deletions: 0,
    isEmpty: lines.length === 0,
    labels,
  };
}

async function getFirstParent(repoPath, hash) {
  const result = await tryGit(repoPath, ['rev-list', '--parents', '-n', '1', hash]);
  if (result.code !== 0) return null;
  const parts = result.textOut.trim().split(' ');
  return parts[1] || null;
}

async function getUntrackedStatus(repoPath, relPath) {
  const status = await runGit(repoPath, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--',
    relPath,
  ]);
  const entries = status.split('\0').filter(Boolean);
  return entries.some((entry) => entry.startsWith('??'));
}

export async function getDiff(repoPath, options = {}) {
  await assertRepoPath(repoPath);
  const relPath = normalizeRepoRelPath(options.path);
  const mode = options.mode || 'worktree';
  const context = clamp(options.context ?? 3, 0, 20000);
  let oldRev = 'HEAD';
  let newRev = '工作区';
  let oldLabel = 'HEAD';
  let newLabel = '工作区';
  let args;

  if (mode === 'worktree') {
    const untracked = await getUntrackedStatus(repoPath, relPath).catch(() => false);
    if (untracked) {
      const abs = resolveInside(repoPath, relPath);
      const buffer = await fs.readFile(abs);
      return syntheticUntrackedDiff(repoPath, relPath, buffer, {
        old: '空文件',
        new: '工作区',
      });
    }
    const head = await hasHead(repoPath);
    args = [
      'diff',
      '--no-color',
      '--no-ext-diff',
      `--unified=${context}`,
      ...(head ? ['HEAD'] : ['--cached']),
      '--',
      relPath,
    ];
    oldRev = head ? 'HEAD' : '暂存区';
    oldLabel = head ? 'HEAD' : '暂存区';
    newLabel = '工作区';
  } else if (mode === 'unstaged') {
    args = [
      'diff',
      '--no-color',
      '--no-ext-diff',
      `--unified=${context}`,
      '--',
      relPath,
    ];
    oldRev = '暂存区';
    newRev = '工作区';
    oldLabel = '暂存区';
    newLabel = '工作区';
  } else if (mode === 'staged') {
    args = [
      'diff',
      '--no-color',
      '--no-ext-diff',
      `--unified=${context}`,
      '--cached',
      '--',
      relPath,
    ];
    oldRev = 'HEAD';
    newRev = '暂存区';
    oldLabel = 'HEAD';
    newLabel = '暂存区';
  } else if (mode === 'untracked') {
    const abs = resolveInside(repoPath, relPath);
    const buffer = await fs.readFile(abs);
    return syntheticUntrackedDiff(repoPath, relPath, buffer, {
      old: '空文件',
      new: '工作区',
    });
  } else if (mode === 'commit') {
    const target = await resolveCommit(repoPath, options.to || options.rev);
    if (target === 'WORKTREE') {
      throw new AppError('提交差异需要具体提交', { status: 400 });
    }
    const parent = await getFirstParent(repoPath, target);
    if (parent) {
      args = [
        'diff',
        '--no-color',
        '--no-ext-diff',
        `--unified=${context}`,
        '--find-renames',
        parent,
        target,
        '--',
        relPath,
      ];
    } else {
      args = [
        'diff-tree',
        '--root',
        '-p',
        '--no-commit-id',
        '--no-color',
        `--unified=${context}`,
        '-r',
        target,
        '--',
        relPath,
      ];
    }
    oldRev = parent || '(root)';
    newRev = target;
    oldLabel = parent ? parent.slice(0, 7) : '初始提交';
    newLabel = target.slice(0, 7);
  } else if (mode === 'between') {
    const from = await resolveCommit(repoPath, options.from);
    const to = await resolveCommit(repoPath, options.to || 'WORKTREE');
    if (from === 'WORKTREE' || to === 'WORKTREE') {
      throw new AppError('版本对比需要具体的提交', { status: 400 });
    }
    args = [
      'diff',
      '--no-color',
      '--no-ext-diff',
      `--unified=${context}`,
      '--find-renames',
      from,
      to,
      '--',
      relPath,
    ];
    oldRev = from;
    newRev = to;
    oldLabel = from.slice(0, 7);
    newLabel = to.slice(0, 7);
  } else if (mode === 'commit-to-worktree') {
    const from = await resolveCommit(repoPath, options.from);
    if (from === 'WORKTREE') {
      throw new AppError('版本对比需要具体提交', { status: 400 });
    }
    args = [
      'diff',
      '--no-color',
      '--no-ext-diff',
      `--unified=${context}`,
      from,
      '--',
      relPath,
    ];
    oldRev = from;
    newRev = 'WORKTREE';
    oldLabel = from.slice(0, 7);
    newLabel = '工作区';
  } else {
    throw new AppError('未知的差异模式', { status: 400, code: 'invalid_diff_mode' });
  }

  let patch;
  try {
    patch = await runGit(repoPath, args);
  } catch (error) {
    if (mode === 'worktree' && !(await hasHead(repoPath))) {
      const cached = await runGit(repoPath, [
        'diff',
        '--no-color',
        `--unified=${context}`,
        '--cached',
        '--',
        relPath,
      ]);
      const untracked = await getUntrackedStatus(repoPath, relPath).catch(() => false);
      if (!cached && untracked) {
        const abs = resolveInside(repoPath, relPath);
        const buffer = await fs.readFile(abs);
        return syntheticUntrackedDiff(repoPath, relPath, buffer, {
          old: '空文件',
          new: '工作区',
        });
      }
      throw error;
    }
    throw error;
  }

  if (!patch.trim()) {
    const untracked =
      mode === 'worktree' &&
      (await getUntrackedStatus(repoPath, relPath).catch(() => false));
    if (untracked) {
      const abs = resolveInside(repoPath, relPath);
      const buffer = await fs.readFile(abs);
      return syntheticUntrackedDiff(repoPath, relPath, buffer, {
        old: '空文件',
        new: '工作区',
      });
    }
  }

  const parsed = parsePatch(patch, relPath, { old: oldLabel, new: newLabel });
  parsed.mode = mode;
  parsed.oldRev = oldRev;
  parsed.newRev = newRev;
  parsed.patch = patch;
  parsed.isEmpty = !patch.trim() || parsed.isEmpty;
  if (parsed.isEmpty) parsed.status = 'unchanged';
  return parsed;
}

export async function getBranches(repoPath) {
  await assertRepoPath(repoPath);
  const raw = await runGit(repoPath, [
    'for-each-ref',
    '--sort=refname',
    '--format=%(refname)%1f%(refname:short)%1f%(objectname:short)%1f%(upstream:short)%1f%(HEAD)%1f%(committerdate:iso-strict)%1f%(subject)',
    'refs/heads',
    'refs/remotes',
  ]);
  const branches = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [fullName, name, hash, upstream, head, date, subject] = line.split('\x1f');
      const remote = fullName.startsWith('refs/remotes/');
      return {
        fullName,
        name,
        hash,
        upstream: upstream || '',
        current: head === '*',
        remote,
        date: normalizeDate(date),
        subject: subject || '',
      };
    })
    .filter((branch) => !(branch.remote && branch.name.endsWith('/HEAD')));
  return {
    local: branches.filter((branch) => !branch.remote),
    remote: branches.filter((branch) => branch.remote),
  };
}

export async function checkoutBranch(repoPath, { name, create = false, startPoint = 'HEAD' }) {
  await assertRepoPath(repoPath);
  const target = String(name || '').trim();
  if (!target || target.startsWith('-') || target.includes('\0') || target.includes('\n')) {
    throw new AppError('请输入合法的分支名称', { status: 400, code: 'invalid_branch' });
  }
  if (create) {
    await runGit(repoPath, ['check-ref-format', '--branch', target]);
    await runGit(repoPath, ['switch', '-c', target, startPoint], { timeout: 60000 });
  } else {
    await runGit(repoPath, ['switch', target], { timeout: 60000 });
  }
  return getRepoSummary(repoPath);
}

export async function stagePaths(repoPath, paths) {
  await assertRepoPath(repoPath);
  const rels = (paths || []).map(normalizeRepoRelPath);
  if (rels.length === 0) {
    await runGit(repoPath, ['add', '-A'], { timeout: 60000 });
  } else {
    await runGit(repoPath, ['add', '-A', '--', ...rels], { timeout: 60000 });
  }
  return getStatus(repoPath, { limit: 5000 });
}

export async function unstagePaths(repoPath, paths) {
  await assertRepoPath(repoPath);
  const rels = (paths || []).map(normalizeRepoRelPath);
  const head = await hasHead(repoPath);
  try {
    if (rels.length === 0) {
      await runGit(repoPath, ['restore', '--staged', '.'], { timeout: 60000 });
    } else {
      await runGit(repoPath, ['restore', '--staged', '--', ...rels], { timeout: 60000 });
    }
  } catch (error) {
    if (!head) {
      if (rels.length === 0) {
        await runGit(repoPath, ['rm', '--cached', '-r', '--ignore-unmatch', '.'], {
          timeout: 60000,
        });
      } else {
        await runGit(repoPath, ['rm', '--cached', '-r', '--ignore-unmatch', '--', ...rels], {
          timeout: 60000,
        });
      }
    } else {
      throw error;
    }
  }
  return getStatus(repoPath, { limit: 5000 });
}

export async function discardPaths(repoPath, paths) {
  await assertRepoPath(repoPath);
  const rels = (paths || []).map(normalizeRepoRelPath);
  if (!rels.length) {
    throw new AppError('请选择要丢弃的文件', { status: 400 });
  }
  const head = await hasHead(repoPath);
  if (!head) {
    throw new AppError('初始提交前无法丢弃更改，请先完成首次提交', {
      status: 400,
      code: 'no_head',
    });
  }
  const status = await getStatus(repoPath, { includeStats: false, limit: 5000 });
  const byPath = new Map(status.files.map((file) => [file.path, file]));
  const untracked = [];
  const tracked = [];
  for (const rel of rels) {
    const file = byPath.get(rel);
    if (file?.untracked) untracked.push(rel);
    else tracked.push(rel);
  }
  if (tracked.length) {
    await runGit(
      repoPath,
      ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked],
      { timeout: 60000 },
    );
  }
  for (const rel of untracked) {
    const abs = resolveInside(repoPath, rel);
    await fs.rm(abs, { force: true });
  }
  return getStatus(repoPath, { limit: 5000 });
}

export async function commitChanges(repoPath, { message, amend = false }) {
  await assertRepoPath(repoPath);
  const text = String(message || '').replace(/\r\n/g, '\n').trim();
  if (!text) {
    throw new AppError('请输入提交信息', { status: 400, code: 'empty_message' });
  }
  if (text.length > 20000) {
    throw new AppError('提交信息过长', { status: 400, code: 'message_too_long' });
  }
  const args = ['commit', '--cleanup=strip', '-m', text];
  if (amend) args.push('--amend');
  const output = await runGit(repoPath, args, { timeout: 180000 });
  const last = await getLastCommit(repoPath);
  return {
    output: output.trim(),
    commit: last,
    status: await getStatus(repoPath, { limit: 5000 }),
  };
}

export async function fetchRemotes(repoPath) {
  await assertRepoPath(repoPath);
  const output = await runGit(repoPath, ['fetch', '--all', '--prune'], {
    timeout: 180000,
  });
  return { output: output.trim(), summary: await getRepoSummary(repoPath) };
}

export async function pushCurrentBranch(repoPath, options = {}) {
  await assertRepoPath(repoPath);
  const status = await getStatus(repoPath, { includeStats: false, limit: 1 });
  if (!status.hasCommits) {
    throw new AppError('当前分支还没有提交，无法推送', {
      status: 400,
      code: 'no_commits',
    });
  }
  if (status.detached || !status.branchName) {
    throw new AppError('当前处于 detached HEAD 状态，请先切换到一个分支再推送', {
      status: 400,
      code: 'detached_head',
    });
  }

  const branch = status.branchName;
  const remotes = await getRemotes(repoPath);
  if (remotes.length === 0) {
    throw new AppError('当前仓库没有配置远程仓库，请先执行 git remote add', {
      status: 400,
      code: 'no_remote',
    });
  }

  let remoteName = String(options.remote || '').trim();
  if (remoteName && !remotes.some((remote) => remote.name === remoteName)) {
    throw new AppError('找不到指定的远程仓库', {
      status: 400,
      code: 'remote_not_found',
    });
  }

  const hasUpstream = Boolean(status.upstream);
  const configuredRemote = hasUpstream
    ? (await tryGit(repoPath, ['config', '--get', `branch.${branch}.remote`])).textOut.trim()
    : '';
  let args;
  if (hasUpstream && !options.setUpstream) {
    args = ['push', '--porcelain'];
    remoteName = configuredRemote || remoteName || remotes[0].name;
  } else {
    remoteName =
      remoteName ||
      (remotes.some((remote) => remote.name === 'origin') ? 'origin' : remotes[0].name);
    args = ['push', '--porcelain', '--set-upstream', remoteName, branch];
  }

  const result = await runGitRaw(repoPath, args, {
    timeout: 180000,
    maxBuffer: 5 * 1024 * 1024,
  });
  const output = redactRemoteUrl(
    [result.textOut, result.textErr]
      .filter(Boolean)
      .join('\n')
      .trim(),
  );
  if (result.code !== 0) {
    throw new GitError('推送失败', {
      args,
      stdout: redactRemoteUrl(result.textOut || ''),
      stderr: output,
      exitCode: result.code,
    });
  }
  const summary = await getRepoSummary(repoPath);
  return {
    output,
    remote: remoteName,
    branch,
    upstream: summary.upstream || `${remoteName}/${branch}`,
    setUpstream: !hasUpstream || Boolean(options.setUpstream),
    summary,
  };
}

export async function getFileHistory(repoPath, options = {}) {
  await assertRepoPath(repoPath);
  const relPath = normalizeRepoRelPath(options.path);
  const limit = clamp(options.limit ?? 80, 1, 200);
  const result = await getLog(repoPath, {
    limit,
    skip: 0,
    path: relPath,
    follow: true,
    branch: options.branch || null,
  });
  let exists = false;
  let size = 0;
  try {
    const abs = resolveInside(repoPath, relPath);
    const stat = await fs.stat(abs);
    exists = stat.isFile();
    size = stat.size;
  } catch {
    exists = false;
  }
  const tracked = await tryGit(repoPath, ['ls-files', '--error-unmatch', '--', relPath]);
  return {
    ...result,
    path: relPath,
    exists,
    size,
    tracked: tracked.code === 0,
  };
}

export async function getFileContent(repoPath, options = {}) {
  await assertRepoPath(repoPath);
  const relPath = normalizeRepoRelPath(options.path);
  const rev = options.rev === 'WORKTREE' || !options.rev ? 'WORKTREE' : await resolveCommit(repoPath, options.rev);
  let buffer;
  if (rev === 'WORKTREE') {
    const abs = resolveInside(repoPath, relPath);
    buffer = await fs.readFile(abs);
  } else {
    const result = await runGitRaw(
      repoPath,
      ['show', '--no-textconv', `${rev}:${relPath}`],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    if (result.code !== 0) {
      throw new GitError('读取文件版本失败', {
        args: ['show', `${rev}:${relPath}`],
        stderr: result.textErr,
        exitCode: result.code,
      });
    }
    buffer = result.stdout;
  }
  const limit = 2 * 1024 * 1024;
  const truncated = buffer.length > limit;
  const data = truncated ? buffer.subarray(0, limit) : buffer;
  const binary = data.includes(0);
  return {
    path: relPath,
    rev,
    size: buffer.length,
    truncated,
    binary,
    content: binary ? null : data.toString('utf8'),
  };
}

const MAX_EDITABLE_FILE = 2 * 1024 * 1024;

function assertNotGitMetadata(relPath) {
  if (relPath.split('/').some((segment) => segment.toLowerCase() === '.git')) {
    throw new AppError('不能读取或修改 .git 内部文件', {
      status: 400,
      code: 'protected_path',
    });
  }
}

async function assertRealPathInside(repoPath, absolutePath) {
  const [rootReal, fileReal] = await Promise.all([
    fs.realpath(repoPath),
    fs.realpath(absolutePath),
  ]);
  const relative = path.relative(rootReal, fileReal);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('文件路径越过了代码库边界', {
      status: 400,
      code: 'invalid_path',
    });
  }
}

async function readFilePrefix(absolutePath, size) {
  if (size <= MAX_EDITABLE_FILE) {
    return fs.readFile(absolutePath);
  }
  const handle = await fs.open(absolutePath, 'r');
  try {
    const buffer = Buffer.alloc(MAX_EDITABLE_FILE);
    const { bytesRead } = await handle.read(buffer, 0, MAX_EDITABLE_FILE, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function getRepoTree(repoPath, options = {}) {
  await assertRepoPath(repoPath);
  const limit = clamp(options.limit ?? 10000, 100, 50000);
  const raw = await runGit(
    repoPath,
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { timeout: 30000, maxBuffer: 32 * 1024 * 1024 },
  );
  const allPaths = [...new Set(raw.split('\0').filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'en'),
  );
  const paths = allPaths.slice(0, limit);
  const root = { type: 'dir', name: '', path: '', children: [] };
  const directories = new Map([['', root]]);
  const files = [];

  for (const filePath of paths) {
    const parts = filePath.split('/');
    let parentPath = '';
    let parent = root;
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      const isFile = index === parts.length - 1;
      const nodePath = parentPath ? `${parentPath}/${name}` : name;
      if (isFile) {
        parent.children.push({ type: 'file', name, path: nodePath });
        files.push(nodePath);
      } else {
        let directory = directories.get(nodePath);
        if (!directory) {
          directory = { type: 'dir', name, path: nodePath, children: [] };
          directories.set(nodePath, directory);
          parent.children.push(directory);
        }
        parent = directory;
        parentPath = nodePath;
      }
    }
  }

  function sortTree(nodes) {
    nodes.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'dir' ? -1 : 1;
      return left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });
    });
    for (const node of nodes) {
      if (node.type === 'dir') sortTree(node.children);
    }
  }
  sortTree(root.children);

  return {
    tree: root.children,
    files,
    count: allPaths.length,
    shown: paths.length,
    truncated: allPaths.length > limit,
    limit,
  };
}

export async function readWorkingFile(repoPath, options = {}) {
  await assertRepoPath(repoPath);
  const relPath = normalizeRepoRelPath(options.path);
  assertNotGitMetadata(relPath);
  const absolute = resolveInside(repoPath, relPath);
  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new AppError('文件不存在或已被删除', { status: 404, code: 'file_not_found' });
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new AppError('目标不是普通文件', { status: 400, code: 'not_a_file' });
  }
  await assertRealPathInside(repoPath, absolute);
  const buffer = await readFilePrefix(absolute, stat.size);
  const truncated = stat.size > MAX_EDITABLE_FILE;
  const binary = buffer.includes(0);
  let content = null;
  let eol = '\n';
  if (!binary) {
    const text = buffer.toString('utf8');
    const crlfCount = (text.match(/\r\n/g) || []).length;
    const lfCount = (text.match(/\n/g) || []).length;
    eol = crlfCount > 0 && crlfCount === lfCount ? '\r\n' : '\n';
    content = text.replace(/\r\n/g, '\n');
  }
  return {
    path: relPath,
    name: path.basename(relPath),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    truncated,
    binary,
    editable: !binary && !truncated,
    content,
    eol,
    maxBytes: MAX_EDITABLE_FILE,
  };
}

export async function saveWorkingFile(repoPath, options = {}) {
  await assertRepoPath(repoPath);
  const relPath = normalizeRepoRelPath(options.path);
  assertNotGitMetadata(relPath);
  if (typeof options.content !== 'string') {
    throw new AppError('文件内容必须是文本', { status: 400, code: 'invalid_content' });
  }
  if (options.content.includes('\0')) {
    throw new AppError('文件内容包含二进制数据', { status: 400, code: 'binary_content' });
  }
  if (Buffer.byteLength(options.content, 'utf8') > MAX_EDITABLE_FILE) {
    throw new AppError('文件超过 2 MB，暂不支持在 GitDeck 中编辑', {
      status: 400,
      code: 'file_too_large',
    });
  }
  const absolute = resolveInside(repoPath, relPath);
  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new AppError('文件不存在或已被删除', { status: 404, code: 'file_not_found' });
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new AppError('目标不是普通文件', { status: 400, code: 'not_a_file' });
  }
  await assertRealPathInside(repoPath, absolute);
  const baseMtimeMs = Number(options.baseMtimeMs);
  if (Number.isFinite(baseMtimeMs) && Math.abs(stat.mtimeMs - baseMtimeMs) > 2) {
    throw new AppError('文件已在磁盘上发生变化，请重新加载后再保存', {
      status: 409,
      code: 'file_changed',
    });
  }
  const eol = options.eol === '\r\n' ? '\r\n' : '\n';
  const normalized = options.content.replace(/\r\n/g, '\n');
  const output = eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
  await fs.writeFile(absolute, output, 'utf8');
  return readWorkingFile(repoPath, { path: relPath });
}

function normalizeCloneUrl(raw) {
  let value = String(raw || '').trim();
  if (!value) {
    throw new AppError('请输入远程仓库地址', { status: 400, code: 'missing_url' });
  }
  if (value.includes('\0') || /[\r\n]/.test(value)) {
    throw new AppError('远程仓库地址包含非法字符', { status: 400, code: 'invalid_url' });
  }
  const schemeMatch = value.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (!['https', 'http', 'ssh', 'git', 'file'].includes(scheme)) {
      throw new AppError('只支持 HTTPS、SSH 或 Git 协议地址', {
        status: 400,
        code: 'invalid_url',
      });
    }
    if (scheme === 'https' || scheme === 'http') {
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        throw new AppError('远程仓库地址格式不正确', {
          status: 400,
          code: 'invalid_url',
        });
      }
      if (parsed.username || parsed.password) {
        throw new AppError('请不要在地址中携带账号或 Token，请使用系统 Git 凭据管理器', {
          status: 400,
          code: 'credentials_not_allowed',
        });
      }
    }
  } else if (/^[^\s@]+@[^\s:]+:.+$/.test(value)) {
    // SCP-style SSH address, e.g. git@github.com:owner/repo.git
  } else if (/^[^\s/]+\.[^\s/]+\/.+/i.test(value)) {
    value = `https://${value}`;
  } else {
    throw new AppError('无法识别远程仓库地址，请使用完整 HTTPS 或 SSH 地址', {
      status: 400,
      code: 'invalid_url',
    });
  }
  return value;
}

function deriveCloneName(url) {
  let value = url.replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (value.endsWith('.git')) value = value.slice(0, -4);
  const parts = value.split(/[/:]/).filter(Boolean);
  return parts[parts.length - 1] || 'repository';
}

function sanitizeCloneName(value) {
  let name = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!name || name === '.' || name === '..') name = 'repository';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `_${name}`;
  return name.slice(0, 80);
}

export async function cloneRemoteRepository(options = {}) {
  const url = normalizeCloneUrl(options.url);
  const parent = stripUserPath(options.parent || process.cwd());
  let parentStat;
  try {
    parentStat = await fs.stat(parent);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new AppError('目标文件夹不存在', { status: 400, code: 'parent_not_found' });
    }
    throw error;
  }
  if (!parentStat.isDirectory()) {
    throw new AppError('目标位置不是文件夹', { status: 400, code: 'parent_not_directory' });
  }
  const name = sanitizeCloneName(options.name || deriveCloneName(url));
  const destination = path.join(parent, name);
  const relative = path.relative(parent, destination);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('目标目录名不合法', { status: 400, code: 'invalid_name' });
  }
  try {
    await fs.stat(destination);
    throw new AppError('目标目录已存在，请更换目录名或目标位置', {
      status: 409,
      code: 'destination_exists',
    });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const result = await runGitRaw(parent, ['clone', '--progress', url, destination], {
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = redactRemoteUrl(
    [result.textOut, result.textErr]
      .filter(Boolean)
      .join('\n')
      .trim(),
  );
  if (result.code !== 0) {
    throw new GitError('克隆远程代码库失败', {
      args: ['clone', url, destination],
      stderr: output,
      exitCode: result.code,
    });
  }
  await assertRepoPath(destination);
  const lines = output.split(/\r?\n/).filter(Boolean);
  return {
    path: destination,
    name,
    url: redactRemoteUrl(url),
    output: lines.slice(-12).join('\n'),
  };
}

const fileListCache = new Map();

export async function listRepoFiles(repoPath, query = '') {
  await assertRepoPath(repoPath);
  const key = process.platform === 'win32' ? repoPath.toLowerCase() : repoPath;
  const cached = fileListCache.get(key);
  let files;
  if (cached && Date.now() - cached.at < 4000) {
    files = cached.files;
  } else {
    const raw = await runGit(repoPath, [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ]);
    files = raw.split('\0').filter(Boolean).sort((a, b) => a.localeCompare(b));
    fileListCache.set(key, { at: Date.now(), files });
  }
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return { files: files.slice(0, 80), total: files.length, query: '' };
  const scored = [];
  for (const file of files) {
    const lower = file.toLowerCase();
    if (!lower.includes(needle)) continue;
    const base = lower.slice(lower.lastIndexOf('/') + 1);
    let score = 0;
    if (lower === needle) score = 100;
    else if (base === needle) score = 90;
    else if (base.startsWith(needle)) score = 70;
    else if (lower.startsWith(needle)) score = 60;
    else if (base.includes(needle)) score = 40;
    else score = 20;
    scored.push({ file, score });
  }
  scored.sort((a, b) => b.score - a.score || a.file.length - b.file.length);
  return {
    files: scored.slice(0, 80).map((entry) => entry.file),
    total: scored.length,
    query: needle,
  };
}

export async function countRepoStats(repoPath) {
  const summary = await getRepoSummary(repoPath);
  return summary;
}

function runDetached(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(command, args, {
        ...options,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('error', reject);
      child.unref();
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

export async function revealPath(repoPath, relPath) {
  await assertRepoPath(repoPath);
  const rel = relPath ? normalizeRepoRelPath(relPath) : null;
  const abs = rel ? resolveInside(repoPath, rel) : repoPath;
  if (isWindows()) {
    if (rel) {
      await runDetached('explorer.exe', ['/select,', abs]);
    } else {
      await runDetached('explorer.exe', [abs]);
    }
    return { revealed: abs };
  }
  if (process.platform === 'darwin') {
    if (rel) await runDetached('open', ['-R', abs]);
    else await runDetached('open', [abs]);
    return { revealed: abs };
  }
  await runDetached('xdg-open', [rel ? path.dirname(abs) : abs]);
  return { revealed: abs };
}

export function gitBinaryVersionSync() {
  const result = spawnSync(GIT_BIN, ['--version'], { encoding: 'utf8' });
  return (result.stdout || '').trim();
}
