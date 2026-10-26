import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkoutBranch,
  cloneRemoteRepository,
  commitChanges,
  discardPaths,
  fetchRemotes,
  getBranches,
  getCommitDetail,
  getDiff,
  getFileContent,
  getFileHistory,
  getGitVersion,
  getLog,
  getRepoSummary,
  getRepoTree,
  getStatus,
  listRepoFiles,
  pushCurrentBranch,
  readWorkingFile,
  resolveRepo,
  revealPath,
  saveWorkingFile,
  stagePaths,
  unstagePaths,
} from './git.js';
import { browseDirectories, scanRepositories } from './fs-browser.js';
import { RepoStore } from './store.js';
import { AppError } from './errors.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function numberQuery(value, fallback, min, max) {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] : value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function boolQuery(value, fallback = false) {
  if (value === undefined) return fallback;
  const normalized = Array.isArray(value) ? value[0] : value;
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function summarizeRepoEntry(repo, summary) {
  return {
    ...summary,
    ...repo,
    ok: true,
  };
}

async function listRepoSummaries(store) {
  const state = await store.list();
  const repos = await Promise.all(
    state.repos.map(async (repo) => {
      try {
        return summarizeRepoEntry(repo, await getRepoSummary(repo.path));
      } catch (error) {
        return {
          ...repo,
          name: path.basename(repo.path),
          ok: false,
          missing: error.code === 'repo_missing',
          error: error.message,
          counts: { total: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
          branch: '—',
          ahead: 0,
          behind: 0,
          lastCommit: null,
        };
      }
    }),
  );
  return { repos, activeRepoId: state.activeRepoId };
}

export async function createApp() {
  const app = express();
  const store = new RepoStore();
  await store.ensureLoaded();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));
  app.use((request, response, next) => {
    if (request.path.startsWith('/api')) response.set('Cache-Control', 'no-store');
    next();
  });

  const repoFromRequest = async (request) => {
    const repo = await store.require(request.params.id);
    return repo;
  };

  app.get(
    '/api/health',
    asyncRoute(async (_request, response) => {
      const state = await store.list();
      response.json({
        ok: true,
        name: 'GitDeck',
        version: '1.2.0',
        gitVersion: await getGitVersion(),
        node: process.version,
        platform: process.platform,
        repoCount: state.repos.length,
        cwd: projectRoot,
      });
    }),
  );

  app.get(
    '/api/repos',
    asyncRoute(async (_request, response) => {
      const data = await listRepoSummaries(store);
      response.json(data);
    }),
  );

  app.post(
    '/api/repos',
    asyncRoute(async (request, response) => {
      const input = request.body?.path;
      if (!input) throw new AppError('请输入代码库路径', { status: 400 });
      let result;
      try {
        result = await store.add(input);
      } catch (error) {
        if (error.code === 'repo_exists' && error.repo) {
          await store.setActive(error.repo.id);
          const summary = await getRepoSummary(error.repo.path).catch(() => null);
          response.status(200).json({
            duplicate: true,
            repo: { ...error.repo, ...(summary || {}) },
            activeRepoId: error.repo.id,
          });
          return;
        }
        throw error;
      }
      const summary = await getRepoSummary(result.repo.path);
      await store.setActive(result.repo.id);
      response.status(201).json({
        duplicate: false,
        repo: { ...result.repo, ...summary },
        activeRepoId: result.repo.id,
      });
    }),
  );

  app.delete(
    '/api/repos/:id',
    asyncRoute(async (request, response) => {
      const result = await store.remove(request.params.id);
      response.json({ ok: true, removed: result.removed, activeRepoId: result.activeRepoId });
    }),
  );

  app.post(
    '/api/repos/clone',
    asyncRoute(async (request, response) => {
      const url = String(request.body?.url || '').trim();
      const parent = String(request.body?.parent || '').trim();
      const name = String(request.body?.name || '').trim();
      if (!url) throw new AppError('请输入远程仓库地址', { status: 400 });
      if (!parent) throw new AppError('请选择目标文件夹', { status: 400 });
      const clone = await cloneRemoteRepository({ url, parent, name });
      let result;
      try {
        result = await store.add(clone.path);
      } catch (error) {
        if (error.code === 'repo_exists' && error.repo) {
          await store.setActive(error.repo.id);
          const summary = await getRepoSummary(error.repo.path).catch(() => null);
          response.status(200).json({
            duplicate: true,
            repo: { ...error.repo, ...(summary || {}) },
            activeRepoId: error.repo.id,
            clone,
          });
          return;
        }
        throw error;
      }
      const summary = await getRepoSummary(result.repo.path);
      await store.setActive(result.repo.id);
      response.status(201).json({
        duplicate: false,
        repo: { ...result.repo, ...summary },
        activeRepoId: result.repo.id,
        clone,
      });
    }),
  );

  app.post(
    '/api/repos/active',
    asyncRoute(async (request, response) => {
      const id = request.body?.id || null;
      const active = await store.setActive(id);
      response.json({ activeRepoId: active });
    }),
  );

  app.get(
    '/api/repos/:id/status',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      response.json(await getStatus(repo.path));
    }),
  );

  app.get(
    '/api/repos/:id/log',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      response.json(
        await getLog(repo.path, {
          limit: numberQuery(request.query.limit, 60, 1, 200),
          skip: numberQuery(request.query.skip, 0, 0, 100000),
          all: boolQuery(request.query.all),
          query: String(request.query.q || ''),
          author: String(request.query.author || ''),
          branch: request.query.branch ? String(request.query.branch) : null,
          path: request.query.path ? String(request.query.path) : null,
          follow: boolQuery(request.query.follow),
        }),
      );
    }),
  );

  app.get(
    '/api/repos/:id/commits/:hash',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      response.json(await getCommitDetail(repo.path, request.params.hash));
    }),
  );

  app.get(
    '/api/repos/:id/diff',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      if (!request.query.path) throw new AppError('缺少文件路径', { status: 400 });
      response.json(
        await getDiff(repo.path, {
          path: String(request.query.path),
          mode: request.query.mode ? String(request.query.mode) : 'worktree',
          context: numberQuery(request.query.context, 3, 0, 20000),
          from: request.query.from ? String(request.query.from) : null,
          to: request.query.to ? String(request.query.to) : null,
          rev: request.query.rev ? String(request.query.rev) : null,
        }),
      );
    }),
  );

  app.get(
    '/api/repos/:id/compare',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      if (!request.query.path) throw new AppError('缺少文件路径', { status: 400 });
      if (!request.query.from || !request.query.to) {
        throw new AppError('版本对比需要 from 和 to', { status: 400 });
      }
      response.json(
        await getDiff(repo.path, {
          path: String(request.query.path),
          mode: 'between',
          from: String(request.query.from),
          to: String(request.query.to),
          context: numberQuery(request.query.context, 3, 0, 20000),
        }),
      );
    }),
  );

  app.get(
    '/api/repos/:id/file-history',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      if (!request.query.path) throw new AppError('请先选择一个文件', { status: 400 });
      response.json(
        await getFileHistory(repo.path, {
          path: String(request.query.path),
          limit: numberQuery(request.query.limit, 40, 1, 160),
          skip: numberQuery(request.query.skip, 0, 0, 10000),
          branch: request.query.branch ? String(request.query.branch) : null,
        }),
      );
    }),
  );

  app.get(
    '/api/repos/:id/file-content',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      if (!request.query.path) throw new AppError('缺少文件路径', { status: 400 });
      response.json(
        await getFileContent(repo.path, {
          path: String(request.query.path),
          rev: request.query.rev ? String(request.query.rev) : 'WORKTREE',
        }),
      );
    }),
  );

  app.get(
    '/api/repos/:id/tree',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      response.json(await getRepoTree(repo.path));
    }),
  );

  app.get(
    '/api/repos/:id/working-file',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      if (!request.query.path) throw new AppError('缺少文件路径', { status: 400 });
      response.json(await readWorkingFile(repo.path, { path: String(request.query.path) }));
    }),
  );

  app.put(
    '/api/repos/:id/working-file',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      const body = request.body || {};
      if (!body.path) throw new AppError('缺少文件路径', { status: 400 });
      const file = await saveWorkingFile(repo.path, {
        path: body.path,
        content: body.content,
        eol: body.eol,
        baseMtimeMs: body.baseMtimeMs,
      });
      response.json({ ok: true, file });
    }),
  );

  app.get(
    '/api/repos/:id/files',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      response.json(await listRepoFiles(repo.path, String(request.query.q || '')));
    }),
  );

  app.get(
    '/api/repos/:id/branches',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      response.json(await getBranches(repo.path));
    }),
  );

  app.post(
    '/api/repos/:id/checkout',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      const { name, create, startPoint } = request.body || {};
      await checkoutBranch(repo.path, { name, create, startPoint });
      response.json({ ok: true, summary: await getRepoSummary(repo.path) });
    }),
  );

  app.post(
    '/api/repos/:id/stage',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      const paths = Array.isArray(request.body?.paths) ? request.body.paths : [];
      response.json({ ok: true, status: await stagePaths(repo.path, paths) });
    }),
  );

  app.post(
    '/api/repos/:id/unstage',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      const paths = Array.isArray(request.body?.paths) ? request.body.paths : [];
      response.json({ ok: true, status: await unstagePaths(repo.path, paths) });
    }),
  );

  app.post(
    '/api/repos/:id/discard',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      const paths = Array.isArray(request.body?.paths) ? request.body.paths : [];
      response.json({ ok: true, status: await discardPaths(repo.path, paths) });
    }),
  );

  app.post(
    '/api/repos/:id/commit',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      const { message, amend } = request.body || {};
      const result = await commitChanges(repo.path, { message, amend });
      response.json({ ok: true, ...result });
    }),
  );

  app.post(
    '/api/repos/:id/fetch',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      response.json({ ok: true, ...(await fetchRemotes(repo.path)) });
    }),
  );

  app.post(
    '/api/repos/:id/push',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      const remote = request.body?.remote ? String(request.body.remote) : '';
      const setUpstream = Boolean(request.body?.setUpstream);
      response.json({
        ok: true,
        ...(await pushCurrentBranch(repo.path, { remote, setUpstream })),
      });
    }),
  );

  app.post(
    '/api/repos/:id/reveal',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      response.json({
        ok: true,
        ...(await revealPath(repo.path, request.body?.path || null)),
      });
    }),
  );

  app.get(
    '/api/repos/:id/summary',
    asyncRoute(async (request, response) => {
      const repo = await repoFromRequest(request);
      response.json({ ...repo, ...(await getRepoSummary(repo.path)), ok: true });
    }),
  );

  app.get(
    '/api/fs',
    asyncRoute(async (request, response) => {
      response.json(
        await browseDirectories(request.query.path ? String(request.query.path) : ''),
      );
    }),
  );

  app.post(
    '/api/scan',
    asyncRoute(async (request, response) => {
      response.json(
        await scanRepositories(request.body?.path || '', {
          depth: numberQuery(request.body?.depth, 2, 1, 4),
        }),
      );
    }),
  );

  app.get(
    '/api/resolve',
    asyncRoute(async (request, response) => {
      if (!request.query.path) throw new AppError('请输入路径', { status: 400 });
      response.json(await resolveRepo(String(request.query.path)));
    }),
  );

  app.use('/api', (request, response) => {
    response.status(404).json({
      error: { message: 'API 不存在', code: 'not_found' },
    });
  });

  const devMode = process.argv.includes('--dev') || process.env.GITDECK_DEV === '1';
  if (devMode) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: projectRoot,
      appType: 'spa',
      server: { middlewareMode: true },
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.use(async (request, response, next) => {
      if (request.method !== 'GET') return next();
      try {
        await fs.access(path.join(distDir, 'index.html'));
        response.sendFile(path.join(distDir, 'index.html'));
      } catch {
        response
          .status(503)
          .type('html')
          .send(
            '<!doctype html><meta charset="utf-8"><title>GitDeck</title><body style="background:#0b0f17;color:#dfe6f3;font-family:system-ui;padding:48px"><h1>GitDeck 尚未构建</h1><p>请先运行 <code>npm run build</code>，然后重新启动。</p></body>',
          );
      }
    });
  }

  app.use((error, _request, response, _next) => {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error('[gitdeck]', error);
    response.status(status).json({
      error: {
        message:
          status >= 500 && !error.status
            ? '服务器内部错误，请查看终端日志'
            : error.message || '请求失败',
        code: error.code || 'server_error',
        detail: error.detail || error.stderr || '',
      },
    });
  });

  return { app, store };
}

export async function startServer({ port = Number(process.env.PORT) || 4788 } = {}) {
  const { app } = await createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      const actual = server.address();
      const url = `http://127.0.0.1:${actual.port}`;
      console.log('');
      console.log('  \x1b[38;5;111m◆ GitDeck\x1b[0m  local-first git workbench');
      console.log(`  \x1b[2m→\x1b[0m ${url}`);
      console.log(`  \x1b[2m↳\x1b[0m ${projectRoot}`);
      console.log('');
      resolve({ server, port: actual.port, url });
    });
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(
          new Error(
            `端口 ${port} 已被占用。请设置 PORT=其他端口 后重启，例如：PORT=4789 npm start`,
          ),
        );
      } else {
        reject(error);
      }
    });
  });
}

if (isMain) {
  const argPort = process.argv.find((arg) => arg.startsWith('--port='));
  const port = argPort ? Number(argPort.split('=')[1]) : undefined;
  startServer({ port }).catch((error) => {
    console.error(`\n  GitDeck 启动失败：${error.message}\n`);
    process.exitCode = 1;
  });
}
