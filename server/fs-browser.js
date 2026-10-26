import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AppError } from './errors.js';
import { isWindows, stripUserPath } from './git.js';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.svn',
  '.hg',
  '__pycache__',
  '.venv',
  'venv',
]);

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function isGitRepository(directory) {
  try {
    const stat = await fs.stat(path.join(directory, '.git'));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

async function listWindowsDrives() {
  const drives = [];
  await Promise.all(
    'CDEFGHIJKLMNOPQRSTUVWXYZAB'.split('').map(async (letter) => {
      const root = `${letter}:\\`;
      if (await exists(root)) drives.push({ name: `${letter}:`, path: root });
    }),
  );
  return drives.sort((a, b) => a.name.localeCompare(b.name));
}

async function getRoots() {
  const roots = [];
  const seen = new Set();
  const add = async (label, target) => {
    if (!target) return;
    const resolved = path.resolve(target);
    if (seen.has(resolved)) return;
    if (!(await exists(resolved))) return;
    seen.add(resolved);
    roots.push({ label, path: resolved });
  };

  await add('主目录', os.homedir());
  await add('桌面', path.join(os.homedir(), 'Desktop'));
  await add('文档', path.join(os.homedir(), 'Documents'));
  await add('工作区', process.cwd());
  if (isWindows()) {
    const drives = await listWindowsDrives();
    for (const drive of drives) await add(`磁盘 ${drive.name}`, drive.path);
  } else {
    await add('根目录', '/');
  }
  return roots;
}

async function listEntries(current) {
  let dirents;
  try {
    dirents = await fs.readdir(current, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new AppError('目录不存在', { status: 404, code: 'directory_not_found' });
    }
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      throw new AppError('没有权限读取该目录', { status: 403, code: 'permission_denied' });
    }
    throw new AppError(`无法读取目录：${error.message}`, { status: 400 });
  }
  const directories = dirents
    .filter((entry) => entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  const truncated = directories.length > 500;
  const sliced = directories.slice(0, 500);
  const entries = await Promise.all(
    sliced.map(async (entry) => {
      const fullPath = path.join(current, entry.name);
      const repo = await isGitRepository(fullPath);
      let readable = true;
      try {
        await fs.access(fullPath, constants.R_OK);
      } catch {
        readable = false;
      }
      return {
        name: entry.name,
        path: fullPath,
        isRepo: repo,
        hidden: entry.name.startsWith('.'),
        readable,
      };
    }),
  );
  entries.sort((a, b) => {
    if (a.isRepo !== b.isRepo) return a.isRepo ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
  return { entries, truncated };
}

export async function browseDirectories(inputPath) {
  const roots = await getRoots();
  const current = inputPath ? stripUserPath(inputPath) : roots[0]?.path || os.homedir();
  let stat;
  try {
    stat = await fs.stat(current);
  } catch {
    throw new AppError('目录不存在或不可访问', { status: 404, code: 'directory_not_found' });
  }
  if (!stat.isDirectory()) {
    throw new AppError('所选路径不是目录', { status: 400, code: 'not_directory' });
  }
  const { entries, truncated } = await listEntries(current);
  const parent = path.dirname(current) !== current ? path.dirname(current) : null;
  return {
    current,
    parent,
    entries,
    truncated,
    roots,
    isRepo: await isGitRepository(current),
    separator: path.sep,
  };
}

export async function scanRepositories(inputPath, options = {}) {
  const root = inputPath ? stripUserPath(inputPath) : process.cwd();
  const depthLimit = Math.min(4, Math.max(1, Number(options.depth) || 2));
  const found = [];
  const visited = new Set();

  async function walk(directory, depth) {
    if (found.length >= 60) return;
    let key;
    try {
      key = await fs.realpath(directory);
    } catch {
      return;
    }
    if (visited.has(key)) return;
    visited.add(key);
    if (await isGitRepository(directory)) {
      found.push({ path: directory, name: path.basename(directory) });
      return;
    }
    if (depth >= depthLimit) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.config') continue;
      await walk(path.join(directory, entry.name), depth + 1);
      if (found.length >= 60) return;
    }
  }

  await walk(root, 0);
  return { root, repositories: found };
}
