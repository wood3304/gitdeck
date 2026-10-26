import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FolderGit2,
  FolderOpen,
  GitBranch,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { cn, formatDay, relativeTime, repoAccent, useOutsideClick } from '../utils.js';
import { SearchInput, Spinner } from './common.jsx';

function RepoMenu({ repo, onClose, onReveal, onRemove }) {
  const menuRef = useRef(null);
  useOutsideClick(menuRef, onClose);
  return (
    <div className="repo-menu" ref={menuRef} onClick={(event) => event.stopPropagation()}>
      <button
        className="menu-item"
        onClick={() => {
          onReveal(repo);
          onClose();
        }}
      >
        <FolderOpen size={14} />
        在文件管理器中打开
      </button>
      <button
        className="menu-item"
        onClick={async () => {
          await navigator.clipboard?.writeText(repo.path).catch(() => {});
          onClose();
        }}
      >
        <Copy size={14} />
        复制仓库路径
      </button>
      <div className="menu-divider" />
      <button
        className="menu-item danger"
        onClick={() => {
          onRemove(repo);
          onClose();
        }}
      >
        <Trash2 size={14} />
        从工作台移除
      </button>
    </div>
  );
}

function RepoCard({
  repo,
  active,
  onSelect,
  onReveal,
  onRemove,
  menuOpen,
  setMenuOpen,
}) {
  const changes = repo.counts?.total || 0;
  const branch = repo.branchName || repo.branch || 'unknown';
  return (
    <div
      className={cn('repo-card', active && 'is-active', !repo.ok && 'is-missing')}
      style={repoAccent(repo.path)}
      onClick={() => onSelect(repo.id)}
      onDoubleClick={() => onReveal(repo)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(repo.id);
        }
      }}
    >
      <div className="repo-avatar">
        <GitBranch size={15} />
        {changes > 0 ? <span className="repo-avatar-dot" /> : null}
      </div>
      <div className="repo-main">
        <div className="repo-name-row">
          <span className="repo-name">{repo.name}</span>
          {repo.ok ? null : <span className="repo-broken">不可用</span>}
          {repo.ahead > 0 ? (
            <span className="repo-ahead" title={`领先 ${repo.ahead} 个提交`}>
              <ArrowUp size={9} />
              {repo.ahead}
            </span>
          ) : null}
          {repo.behind > 0 ? (
            <span className="repo-behind" title={`落后 ${repo.behind} 个提交`}>
              <ArrowDown size={9} />
              {repo.behind}
            </span>
          ) : null}
        </div>
        <div className="repo-sub">
          <span className="repo-branch">
            <GitBranch size={10} />
            {branch}
          </span>
          {repo.lastCommit ? (
            <>
              <span className="repo-dot-separator" />
              <span className="repo-time">{relativeTime(repo.lastCommit.date)}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="repo-trailing">
        {changes > 0 ? (
          <span className="change-count" title={`${changes} 个文件有更改`}>
            {changes}
          </span>
        ) : repo.ok ? (
          <span className="clean-check" title="工作区干净">
            <Check size={12} />
          </span>
        ) : null}
      </div>
      <button
        className="repo-more"
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen(menuOpen ? null : repo.id);
        }}
        aria-label="代码库操作"
      >
        <MoreHorizontal size={14} />
      </button>
      {menuOpen ? (
        <RepoMenu
          repo={repo}
          onClose={() => setMenuOpen(null)}
          onReveal={onReveal}
          onRemove={onRemove}
        />
      ) : null}
    </div>
  );
}

export default function RepoRail({
  repos,
  activeId,
  loading,
  onSelect,
  onAdd,
  onRemove,
  onReveal,
  onRefresh,
  refreshing,
}) {
  const [filter, setFilter] = useState('');
  const [menuOpen, setMenuOpen] = useState(null);
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return repos;
    return repos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(needle) ||
        repo.path.toLowerCase().includes(needle) ||
        String(repo.branchName || '').toLowerCase().includes(needle),
    );
  }, [repos, filter]);

  useEffect(() => {
    setMenuOpen(null);
  }, [activeId]);

  useEffect(() => {
    if (repos.length <= 2) setFilter('');
  }, [repos.length]);

  return (
    <aside className="repo-rail">
      <div className="rail-head">
        <div className="rail-title-row">
          <div>
            <p className="rail-eyebrow">Workspaces</p>
            <h2>
              代码库
              <span className="rail-count">{repos.length}</span>
            </h2>
          </div>
          <div className="rail-head-actions">
            <button
              className="icon-button"
              onClick={onRefresh}
              title="刷新所有代码库"
              aria-label="刷新所有代码库"
            >
              {refreshing ? <Spinner size={14} /> : <RefreshCw size={14} />}
            </button>
            <button className="icon-button accent" onClick={onAdd} title="打开代码库">
              <Plus size={15} />
            </button>
          </div>
        </div>
        {repos.length > 2 ? (
          <SearchInput
            value={filter}
            onChange={setFilter}
            placeholder="筛选代码库…"
            className="rail-search"
          />
        ) : null}
      </div>

      <div className="repo-list">
        {loading ? (
          <div className="rail-loading">
            {[0, 1, 2].map((index) => (
              <div className="repo-skeleton" key={index}>
                <span className="skeleton-block avatar" />
                <div>
                  <span className="skeleton-block line" />
                  <span className="skeleton-block line short" />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {!loading &&
          filtered.map((repo) => (
            <RepoCard
              key={repo.id}
              repo={repo}
              active={repo.id === activeId}
              onSelect={onSelect}
              onReveal={onReveal}
              onRemove={onRemove}
              menuOpen={menuOpen === repo.id}
              setMenuOpen={setMenuOpen}
            />
          ))}

        {!loading && filtered.length === 0 && repos.length > 0 ? (
          <div className="rail-empty">没有匹配的代码库</div>
        ) : null}

        {!loading && repos.length === 0 ? (
          <div className="rail-empty">
            <FolderGit2 size={20} />
            <strong>还没有代码库</strong>
            <span>打开一个本地 Git 仓库开始</span>
            <button className="button primary small" onClick={onAdd}>
              <Plus size={14} />
              打开代码库
            </button>
          </div>
        ) : null}
      </div>

      <div className="rail-foot">
        <button className="add-repo-button" onClick={onAdd}>
          <span className="add-repo-icon">
            <FolderGit2 size={15} />
          </span>
          <span>
            <strong>打开代码库</strong>
            <small>添加本地 Git 仓库</small>
          </span>
          <Plus size={14} />
        </button>
        <div className="rail-privacy">
          <span className="privacy-dot" />
          本地优先 · 代码不离开这台设备
        </div>
        <div className="rail-day">{formatDay(new Date())}</div>
      </div>
    </aside>
  );
}
