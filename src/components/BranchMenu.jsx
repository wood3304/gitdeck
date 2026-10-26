import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  GitBranch,
  GitBranchPlus,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { api } from '../api.js';
import { cn, relativeTime, useOutsideClick } from '../utils.js';
import { Spinner } from './common.jsx';

export default function BranchMenu({ open, repo, onClose, onChanged, notify }) {
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const [branches, setBranches] = useState({ local: [], remote: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busyBranch, setBusyBranch] = useState('');
  const [creatingBusy, setCreatingBusy] = useState(false);

  useOutsideClick(rootRef, onClose, open);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    setFilter('');
    setNewName('');
    setCreating(false);
    api
      .branches(repo.id)
      .then((data) => {
        if (!cancelled) setBranches(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const timer = setTimeout(() => searchRef.current?.focus(), 80);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, repo.id]);

  const filteredLocal = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return branches.local;
    return branches.local.filter(
      (branch) =>
        branch.name.toLowerCase().includes(needle) ||
        branch.subject.toLowerCase().includes(needle),
    );
  }, [branches.local, filter]);

  const filteredRemote = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return branches.remote;
    return branches.remote.filter(
      (branch) =>
        branch.name.toLowerCase().includes(needle) ||
        branch.subject.toLowerCase().includes(needle),
    );
  }, [branches.remote, filter]);

  async function switchTo(branch) {
    if (branch.current) {
      onClose();
      return;
    }
    setBusyBranch(branch.fullName);
    try {
      await api.checkout(repo.id, { name: branch.name });
      notify({
        type: 'success',
        title: '已切换分支',
        message: `当前分支：${branch.name}`,
      });
      onChanged?.();
      onClose();
    } catch (err) {
      notify({
        type: 'error',
        title: '切换分支失败',
        message: err.message,
        detail: err.detail,
      });
    } finally {
      setBusyBranch('');
    }
  }

  async function checkoutRemote(branch) {
    const localName = branch.name.split('/').slice(1).join('/') || branch.name;
    setBusyBranch(branch.fullName);
    try {
      await api.checkout(repo.id, {
        name: localName,
        create: true,
        startPoint: branch.name,
      });
      notify({
        type: 'success',
        title: '已创建本地分支',
        message: `${localName} ← ${branch.name}`,
      });
      onChanged?.();
      onClose();
    } catch (err) {
      notify({
        type: 'error',
        title: '检出远程分支失败',
        message: err.message,
        detail: err.detail,
      });
    } finally {
      setBusyBranch('');
    }
  }

  async function createBranch(event) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreatingBusy(true);
    try {
      await api.checkout(repo.id, { name, create: true, startPoint: 'HEAD' });
      notify({ type: 'success', title: '已创建并切换分支', message: name });
      onChanged?.();
      onClose();
    } catch (err) {
      notify({
        type: 'error',
        title: '无法创建分支',
        message: err.message,
        detail: err.detail,
      });
    } finally {
      setCreatingBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="branch-popover" ref={rootRef} onClick={(event) => event.stopPropagation()}>
      <div className="popover-head">
        <div>
          <p className="eyebrow">Branches</p>
          <h3>切换分支</h3>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="关闭">
          <X size={14} />
        </button>
      </div>
      <label className="popover-search">
        <Search size={13} />
        <input
          ref={searchRef}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="搜索分支…"
          spellCheck={false}
        />
        {filter ? (
          <button className="search-clear" onClick={() => setFilter('')} aria-label="清空">
            <X size={11} />
          </button>
        ) : null}
      </label>

      <div className="branch-scroll">
        {loading ? (
          <div className="branch-loading">
            <Spinner size={16} />
            读取分支…
          </div>
        ) : null}
        {error ? <div className="branch-error">{error}</div> : null}

        {!loading && filteredLocal.length > 0 ? (
          <div className="branch-group">
            <p className="branch-group-label">本地分支</p>
            {filteredLocal.map((branch) => (
              <button
                key={branch.fullName}
                className={cn('branch-row', branch.current && 'is-current')}
                onClick={() => switchTo(branch)}
                disabled={Boolean(busyBranch)}
              >
                <span className="branch-row-icon">
                  {branch.current ? <Check size={13} /> : <GitBranch size={13} />}
                </span>
                <span className="branch-row-copy">
                  <span className="branch-row-name">
                    {branch.name}
                    {branch.current ? <em>当前</em> : null}
                  </span>
                  <span className="branch-row-meta">
                    {branch.subject || '无提交'} · {relativeTime(branch.date)}
                  </span>
                </span>
                {busyBranch === branch.fullName ? <Spinner size={13} /> : null}
              </button>
            ))}
          </div>
        ) : null}

        {!loading && filteredRemote.length > 0 ? (
          <div className="branch-group">
            <p className="branch-group-label">远程分支</p>
            {filteredRemote.map((branch) => (
              <button
                key={branch.fullName}
                className="branch-row remote"
                onClick={() => checkoutRemote(branch)}
                disabled={Boolean(busyBranch)}
                title="创建一个跟踪此远程分支的本地分支"
              >
                <span className="branch-row-icon">
                  <GitBranchPlus size={13} />
                </span>
                <span className="branch-row-copy">
                  <span className="branch-row-name">{branch.name}</span>
                  <span className="branch-row-meta">
                    {branch.subject || '远程分支'} · {relativeTime(branch.date)}
                  </span>
                </span>
                {busyBranch === branch.fullName ? <Spinner size={13} /> : null}
              </button>
            ))}
          </div>
        ) : null}

        {!loading && !error && filteredLocal.length === 0 && filteredRemote.length === 0 ? (
          <div className="branch-empty">没有匹配的分支</div>
        ) : null}
      </div>

      <div className="branch-create">
        {creating ? (
          <form onSubmit={createBranch} className="branch-create-form">
            <GitBranchPlus size={14} />
            <input
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="新分支名称，基于 HEAD"
              spellCheck={false}
            />
            <button
              className="button primary small"
              type="submit"
              disabled={!newName.trim() || creatingBusy}
            >
              {creatingBusy ? <Spinner size={13} /> : <Check size={13} />}
              创建
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => setCreating(false)}
              aria-label="取消"
            >
              <X size={13} />
            </button>
          </form>
        ) : (
          <button className="branch-create-trigger" onClick={() => setCreating(true)}>
            <Plus size={14} />
            新建分支
            <span>基于当前 HEAD</span>
          </button>
        )}
      </div>
    </div>
  );
}
