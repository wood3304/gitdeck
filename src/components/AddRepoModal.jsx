import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  CloudDownload,
  FileText,
  Folder,
  FolderGit2,
  FolderOpen,
  HardDrive,
  Home,
  Laptop,
  Link2,
  Monitor,
  Plus,
} from 'lucide-react';
import { api } from '../api.js';
import { cn } from '../utils.js';
import { Modal, ModalHeader, Spinner } from './common.jsx';

function rootIcon(label) {
  if (label.includes('主目录')) return Home;
  if (label.includes('桌面')) return Monitor;
  if (label.includes('文档')) return FileText;
  if (label.includes('工作区')) return FolderGit2;
  if (label.includes('磁盘')) return HardDrive;
  return FolderOpen;
}

function deriveCloneName(url) {
  const value = String(url || '')
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  if (!value) return '';
  const withoutGit = value.endsWith('.git') ? value.slice(0, -4) : value;
  const parts = withoutGit.split(/[/:]/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

function cloneTarget(parent, name) {
  if (!parent) return '—';
  return `${parent.replace(/[\\/]+$/, '')}/${name || 'repository'}`;
}

export default function AddRepoModal({ open, onClose, onAdded, notify }) {
  const [data, setData] = useState(null);
  const [pathInput, setPathInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [recent, setRecent] = useState([]);
  const [mode, setMode] = useState('local');
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneNameTouched, setCloneNameTouched] = useState(false);
  const [cloning, setCloning] = useState(false);

  const initialPath = useMemo(() => {
    try {
      return localStorage.getItem('gitdeck.lastBrowsePath') || '';
    } catch {
      return '';
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setError('');
    setLoading(true);
    let startPath = initialPath;
    try {
      startPath = localStorage.getItem('gitdeck.lastBrowsePath') || initialPath;
    } catch {
      startPath = initialPath;
    }
    api
      .browse(startPath)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setPathInput(result.current);
        try {
          const stored = JSON.parse(localStorage.getItem('gitdeck.recentPaths') || '[]');
          setRecent(Array.isArray(stored) ? stored.slice(0, 4) : []);
        } catch {
          setRecent([]);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialPath]);

  async function navigate(target) {
    if (!target || cloning) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.browse(target);
      setData(result);
      setPathInput(result.current);
      try {
        localStorage.setItem('gitdeck.lastBrowsePath', result.current);
      } catch {
        // Ignore storage restrictions.
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGo(event) {
    event?.preventDefault();
    if (!pathInput.trim()) return;
    await navigate(pathInput.trim());
  }

  function rememberPath(path) {
    try {
      const next = [path, ...recent.filter((item) => item !== path)].slice(0, 4);
      setRecent(next);
      localStorage.setItem('gitdeck.recentPaths', JSON.stringify(next));
    } catch {
      // Ignore storage restrictions.
    }
  }

  function closeModal() {
    if (!cloning) onClose?.();
  }

  function switchMode(nextMode) {
    if (cloning) return;
    setMode(nextMode);
    setError('');
  }

  function handleCloneUrl(value) {
    setCloneUrl(value);
    if (!cloneNameTouched) setCloneName(deriveCloneName(value));
  }

  async function cloneRepository() {
    if (cloning || adding) return;
    if (!cloneUrl.trim()) {
      setError('请输入远程仓库地址');
      return;
    }
    if (!data?.current) {
      setError('请选择克隆到的目标文件夹');
      return;
    }
    setCloning(true);
    setError('');
    try {
      const result = await api.cloneRepo({
        url: cloneUrl.trim(),
        parent: data.current,
        name: cloneName.trim(),
      });
      rememberPath(result.repo?.path || data.current);
      try {
        localStorage.setItem('gitdeck.lastBrowsePath', result.repo?.path || data.current);
      } catch {
        // Ignore storage restrictions.
      }
      notify?.({
        type: result.duplicate ? 'info' : 'success',
        title: result.duplicate ? '代码库已在工作台中' : '远程代码库已克隆',
        message: result.repo?.name || cloneName || cloneUrl,
      });
      onAdded?.(result);
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setCloning(false);
    }
  }

  async function addFolder(target) {
    if (!target || adding || cloning) return;
    setAdding(true);
    setError('');
    try {
      const result = await api.addRepo(target);
      rememberPath(result.repo?.path || target);
      try {
        localStorage.setItem('gitdeck.lastBrowsePath', result.repo?.path || target);
      } catch {
        // Ignore storage restrictions.
      }
      onAdded?.(result);
      if (result.duplicate) {
        notify?.({
          type: 'info',
          title: '代码库已在工作台中',
          message: result.repo?.name || target,
        });
      } else {
        notify?.({
          type: 'success',
          title: '已添加代码库',
          message: result.repo?.name || target,
        });
      }
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  const currentIsRepo = data?.isRepo;
  const entries = data?.entries || [];

  return (
    <Modal
      open={open}
      onClose={closeModal}
      className="add-repo-card"
      ariaLabel={mode === 'clone' ? '克隆远程代码库' : '打开本地代码库'}
    >
      <ModalHeader
        eyebrow={mode === 'clone' ? 'CLONE REPOSITORY' : 'OPEN REPOSITORY'}
        title={mode === 'clone' ? '克隆远程代码库' : '打开本地代码库'}
        description={
          mode === 'clone'
            ? '输入 HTTPS 或 SSH 地址，选择目标文件夹，GitDeck 会完整克隆后加入工作台。'
            : '选择一个包含 .git 的文件夹，或直接输入仓库路径。'
        }
        onClose={closeModal}
        icon={mode === 'clone' ? <CloudDownload size={19} /> : <FolderGit2 size={19} />}
      />

      <div className="repo-source-tabs" role="tablist" aria-label="添加方式">
        <button
          className={cn('repo-source-tab', mode === 'local' && 'is-active')}
          onClick={() => switchMode('local')}
          disabled={cloning}
        >
          <FolderGit2 size={14} />
          本地仓库
        </button>
        <button
          className={cn('repo-source-tab', mode === 'clone' && 'is-active')}
          onClick={() => switchMode('clone')}
          disabled={cloning}
        >
          <CloudDownload size={14} />
          远程克隆
        </button>
      </div>

      {mode === 'clone' ? (
        <div className="clone-form">
          <label className="clone-field clone-url-field">
            <span>远程地址</span>
            <div className="clone-input-wrap">
              <Link2 size={14} />
              <input
                value={cloneUrl}
                onChange={(event) => handleCloneUrl(event.target.value)}
                placeholder="https://github.com/user/repo.git 或 git@github.com:user/repo.git"
                spellCheck={false}
                autoComplete="off"
                disabled={cloning}
                aria-label="远程仓库地址"
              />
            </div>
          </label>
          <div className="clone-form-row">
            <label className="clone-field clone-name-field">
              <span>目录名</span>
              <input
                value={cloneName}
                onChange={(event) => {
                  setCloneName(event.target.value);
                  setCloneNameTouched(true);
                }}
                placeholder="repository"
                spellCheck={false}
                disabled={cloning}
                aria-label="克隆目录名"
              />
            </label>
            <div className="clone-target-preview">
              <span>克隆到</span>
              <code title={cloneTarget(data?.current, cloneName)}>
                {cloneTarget(data?.current, cloneName)}
              </code>
            </div>
          </div>
        </div>
      ) : null}

      <div className="repo-pathbar">
        <button
          className="icon-button path-back"
          onClick={() => navigate(data?.parent)}
          disabled={!data?.parent || loading || cloning}
          title="上一级"
          aria-label="上一级"
        >
          <ArrowLeft size={15} />
        </button>
        <form className="path-input-wrap" onSubmit={handleGo}>
          <Folder size={14} />
          <input
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            placeholder={
              mode === 'clone'
                ? '选择克隆到的目标文件夹，例如 D:\\code'
                : '输入本地路径，例如 D:\\code\\my-project'
            }
            spellCheck={false}
            aria-label={mode === 'clone' ? '克隆目标文件夹' : '代码库路径'}
            disabled={cloning}
          />
        </form>
        <button
          className="button ghost small path-go"
          onClick={handleGo}
          disabled={loading || cloning}
        >
          {loading ? <Spinner size={14} /> : <ArrowRight size={14} />}
          前往
        </button>
        {mode === 'local' ? (
          <button
            className="button primary small path-add"
            onClick={() => addFolder(data?.current)}
            disabled={adding || loading || !data?.current}
          >
            {adding ? <Spinner size={14} /> : <Plus size={14} />}
            添加此文件夹
          </button>
        ) : null}
      </div>

      {cloning ? (
        <div className="clone-progress">
          <Spinner size={15} />
          <span>
            正在克隆 <code>{cloneUrl}</code>，仓库较大时可能需要几分钟，请保持窗口打开。
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="add-repo-error">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="add-repo-body">
        <aside className="add-repo-side">
          <p className="section-caption">快速访问</p>
          <div className="quick-locations">
            {(data?.roots || []).map((root) => {
              const Icon = rootIcon(root.label);
              return (
                <button
                  key={`${root.label}-${root.path}`}
                  className={cn('quick-location', data?.current === root.path && 'is-active')}
                  onClick={() => navigate(root.path)}
                  title={root.path}
                >
                  <Icon size={14} />
                  <span>{root.label}</span>
                </button>
              );
            })}
          </div>

          {recent.length > 0 ? (
            <>
              <p className="section-caption recent-caption">最近打开</p>
              <div className="quick-locations recent-list">
                {recent.map((path) => (
                  <button
                    key={path}
                    className="quick-location recent"
                    onClick={() => navigate(path)}
                    title={path}
                  >
                    <FolderGit2 size={13} />
                    <span>{path.split(/[\\/]/).filter(Boolean).pop() || path}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <div className="side-note">
            <Laptop size={14} />
            <p>
              {mode === 'clone'
                ? '克隆使用系统 Git 凭据；私有仓库请先在终端完成登录。'
                : 'GitDeck 通过系统 Git CLI 读取仓库状态。'}
            </p>
          </div>
        </aside>

        <section className="dir-browser">
          <div className="dir-browser-head">
            <div className="dir-current">
              <FolderOpen size={14} />
              <span title={data?.current}>{data?.current || '—'}</span>
              {currentIsRepo ? (
                <span className="dir-repo-badge">
                  <GitBranchMini />
                  Git 仓库
                </span>
              ) : null}
            </div>
            <span className="dir-count">
              {mode === 'clone' ? '选择克隆目标' : `${entries.length} 个文件夹`}
            </span>
          </div>

          <div className="dir-list">
            {loading ? (
              <div className="dir-loading">
                <Spinner size={18} />
                正在读取目录…
              </div>
            ) : null}

            {!loading && entries.length === 0 ? (
              <div className="dir-empty">
                <Folder size={24} />
                <p>这个目录下没有子文件夹</p>
              </div>
            ) : null}

            {!loading &&
              entries.map((entry) => (
                <div
                  key={entry.path}
                  className={cn(
                    'dir-row',
                    entry.isRepo && 'is-repo',
                    cloning && 'is-disabled',
                  )}
                  onClick={() => navigate(entry.path)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') navigate(entry.path);
                  }}
                >
                  <span className={cn('dir-icon', entry.isRepo && 'repo')}>
                    {entry.isRepo ? <FolderGit2 size={16} /> : <Folder size={16} />}
                  </span>
                  <span className="dir-name">{entry.name}</span>
                  {entry.isRepo ? <span className="dir-git-tag">GIT</span> : null}
                  {entry.isRepo && mode === 'local' ? (
                    <button
                      className="dir-add-inline"
                      onClick={(event) => {
                        event.stopPropagation();
                        addFolder(entry.path);
                      }}
                      disabled={adding}
                    >
                      添加
                    </button>
                  ) : null}
                  <ChevronRight size={14} className="dir-chevron" />
                </div>
              ))}
          </div>
        </section>
      </div>

      <footer className="add-repo-footer">
        <span className="footer-shortcut">
          <span className="footer-dot" />
          {mode === 'clone'
            ? `将完整克隆到 ${cloneTarget(data?.current, cloneName)}`
            : '支持嵌套仓库、工作树与子模块'}
        </span>
        <div className="modal-actions inline">
          <button className="button ghost small" onClick={closeModal} disabled={cloning}>
            取消
          </button>
          {mode === 'clone' ? (
            <button
              className="button primary small"
              onClick={cloneRepository}
              disabled={cloning || !cloneUrl.trim() || !data?.current}
            >
              {cloning ? <Spinner size={14} /> : <CloudDownload size={14} />}
              克隆并添加
            </button>
          ) : (
            <button
              className="button primary small"
              onClick={() => addFolder(data?.current)}
              disabled={adding || loading || !data?.current}
            >
              {adding ? <Spinner size={14} /> : <FolderGit2 size={14} />}
              打开此文件夹
            </button>
          )}
        </div>
      </footer>
    </Modal>
  );
}

function GitBranchMini() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6" cy="5" r="2.4" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="6" cy="19" r="2.4" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="7" r="2.4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M6 7.4v9.2M8.4 5h3.2c3.5 0 4 2 4 4.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
