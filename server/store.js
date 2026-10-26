import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.js';
import { resolveRepo } from './git.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.GITDECK_DATA_DIR
  ? path.resolve(process.env.GITDECK_DATA_DIR)
  : path.join(projectRoot, '.data');
const statePath = path.join(dataDir, 'state.json');
const demoCandidates = [
  path.join(projectRoot, 'demo', 'aurora-dashboard'),
  path.join(projectRoot, 'demo', 'nebula-api'),
];

function repoPathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sanitizeState(value) {
  if (!value || typeof value !== 'object') return null;
  const repos = Array.isArray(value.repos)
    ? value.repos
        .filter(
          (repo) =>
            repo &&
            typeof repo.id === 'string' &&
            typeof repo.path === 'string' &&
            path.isAbsolute(repo.path),
        )
        .map((repo) => ({
          id: repo.id,
          path: path.resolve(repo.path),
          addedAt: repo.addedAt || new Date().toISOString(),
        }))
    : [];
  const activeRepoId = repos.some((repo) => repo.id === value.activeRepoId)
    ? value.activeRepoId
    : repos[0]?.id || null;
  return { version: 1, repos, activeRepoId };
}

export class RepoStore {
  constructor() {
    this.state = { version: 1, repos: [], activeRepoId: null };
    this.loaded = false;
    this.writeQueue = Promise.resolve();
  }

  async ensureLoaded() {
    if (this.loaded) return this.state;
    await fs.mkdir(dataDir, { recursive: true });
    try {
      const raw = await fs.readFile(statePath, 'utf8');
      const parsed = sanitizeState(JSON.parse(raw));
      if (parsed) {
        this.state = parsed;
      } else {
        await this.backupCorruptState();
      }
    } catch (error) {
      if (error.code !== 'ENOENT') await this.backupCorruptState();
      await this.seedDemoRepos();
    }
    this.loaded = true;
    await this.persist();
    return this.state;
  }

  async backupCorruptState() {
    try {
      await fs.rename(statePath, `${statePath}.corrupt-${Date.now()}`);
    } catch {
      // Nothing to back up.
    }
  }

  async seedDemoRepos() {
    if (process.env.GITDECK_SEED_DEMO === '0') return;
    const repos = [];
    for (const candidate of demoCandidates) {
      try {
        await fs.access(path.join(candidate, '.git'));
        const resolved = await resolveRepo(candidate);
        repos.push({
          id: crypto.randomUUID(),
          path: resolved.path,
          addedAt: new Date().toISOString(),
        });
      } catch {
        // Demo repository not present; this is a normal production install.
      }
    }
    if (repos.length) {
      this.state = {
        version: 1,
        repos,
        activeRepoId: repos[0].id,
      };
    }
  }

  persist() {
    const payload = `${JSON.stringify(this.state, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(dataDir, { recursive: true });
      const tempPath = path.join(dataDir, `.state-${process.pid}.tmp`);
      await fs.writeFile(tempPath, payload, 'utf8');
      await fs.rm(statePath, { force: true });
      await fs.rename(tempPath, statePath);
    });
    return this.writeQueue;
  }

  async list() {
    await this.ensureLoaded();
    return {
      repos: this.state.repos.map((repo) => ({ ...repo })),
      activeRepoId: this.state.activeRepoId,
    };
  }

  async get(id) {
    await this.ensureLoaded();
    return this.state.repos.find((repo) => repo.id === id) || null;
  }

  async require(id) {
    const repo = await this.get(id);
    if (!repo) {
      throw new AppError('找不到该代码库，它可能已从工作台移除', {
        status: 404,
        code: 'repo_not_found',
      });
    }
    return repo;
  }

  async add(inputPath) {
    await this.ensureLoaded();
    const resolved = await resolveRepo(inputPath);
    const existing = this.state.repos.find(
      (repo) => repoPathKey(repo.path) === repoPathKey(resolved.path),
    );
    if (existing) {
      const error = new AppError('该代码库已在工作台中', {
        status: 409,
        code: 'repo_exists',
      });
      error.repo = existing;
      throw error;
    }
    const repo = {
      id: crypto.randomUUID(),
      path: resolved.path,
      addedAt: new Date().toISOString(),
    };
    this.state.repos.push(repo);
    if (!this.state.activeRepoId) this.state.activeRepoId = repo.id;
    await this.persist();
    return { repo, activeRepoId: this.state.activeRepoId };
  }

  async remove(id) {
    await this.ensureLoaded();
    const index = this.state.repos.findIndex((repo) => repo.id === id);
    if (index < 0) {
      throw new AppError('找不到该代码库', { status: 404, code: 'repo_not_found' });
    }
    const [removed] = this.state.repos.splice(index, 1);
    if (this.state.activeRepoId === id) {
      this.state.activeRepoId = this.state.repos[0]?.id || null;
    }
    await this.persist();
    return { removed, activeRepoId: this.state.activeRepoId };
  }

  async setActive(id) {
    await this.ensureLoaded();
    if (id && !this.state.repos.some((repo) => repo.id === id)) {
      throw new AppError('找不到该代码库', { status: 404, code: 'repo_not_found' });
    }
    this.state.activeRepoId = id || null;
    await this.persist();
    return this.state.activeRepoId;
  }
}

export { dataDir, projectRoot, statePath };
