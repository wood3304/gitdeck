import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileClock,
  GitCommitHorizontal,
  History,
  Minus,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { api } from '../api.js';
import {
  cn,
  shortHash,
  splitPath,
  statusMeta,
  useDebouncedValue,
} from '../utils.js';
import { ConfirmDialog, EmptyState, SearchInput, Spinner } from './common.jsx';
import DiffViewer from './DiffViewer.jsx';

const GROUP_META = {
  conflicts: { title: '冲突', tone: 'conflict', action: null },
  staged: { title: '已暂存', tone: 'staged', action: 'unstage' },
  changes: { title: '更改', tone: 'changes', action: 'stage' },
  untracked: { title: '未跟踪', tone: 'untracked', action: 'stage' },
};

function buildGroups(files) {
  return [
    {
      id: 'conflicts',
      files: files.filter((file) => file.conflicted),
    },
    {
      id: 'staged',
      files: files.filter((file) => file.staged),
    },
    {
      id: 'changes',
      files: files.filter((file) => file.unstaged),
    },
    {
      id: 'untracked',
      files: files.filter((file) => file.untracked),
    },
  ].filter((group) => group.files.length > 0);
}

function modeForGroup(groupId) {
  if (groupId === 'staged') return 'staged';
  if (groupId === 'untracked') return 'untracked';
  return 'worktree';
}

function pickSelection(status, previous) {
  const groups = buildGroups(status.files || []);
  if (!groups.length) return null;
  if (previous) {
    const same = groups.find(
      (group) =>
        group.id === previous.group && group.files.some((file) => file.path === previous.path),
    );
    if (same) return { ...previous, mode: modeForGroup(same.id) };
    const moved = groups.find((group) => group.files.some((file) => file.path === previous.path));
    if (moved) return { path: previous.path, group: moved.id, mode: modeForGroup(moved.id) };
  }
  const order = ['conflicts', 'changes', 'staged', 'untracked'];
  const group = order.map((id) => groups.find((item) => item.id === id)).find(Boolean);
  const file = group?.files[0];
  return file ? { path: file.path, group: group.id, mode: modeForGroup(group.id) } : null;
}

function FileStatusBadge({ code }) {
  const meta = statusMeta(code);
  return (
    <span className={cn('file-status', meta.tone)} title={meta.title}>
      {meta.label}
    </span>
  );
}

function FileRow({
  file,
  group,
  active,
  busy,
  onSelect,
  onToggleStage,
  onOpenHistory,
}) {
  const statusCode =
    group === 'staged'
      ? file.indexStatus || 'M'
      : group === 'untracked'
        ? '?'
        : group === 'conflicts'
          ? 'U'
          : file.worktreeStatus || 'M';
  const path = splitPath(file.path);
  const checked = group === 'staged';
  const canToggle = group !== 'conflicts';
  return (
    <div
      className={cn(
        'file-row',
        active && 'is-active',
        group === 'conflicts' && 'has-conflict',
      )}
      onClick={() => onSelect(file.path, group)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSelect(file.path, group);
      }}
    >
      <button
        className={cn('stage-check', checked && 'is-checked', !canToggle && 'is-disabled')}
        onClick={(event) => {
          event.stopPropagation();
          if (!canToggle || busy) return;
          onToggleStage(file, group);
        }}
        disabled={!canToggle || busy}
        title={checked ? '取消暂存' : '暂存此文件'}
        aria-label={checked ? '取消暂存' : '暂存此文件'}
      >
        {busy ? <Spinner size={11} /> : checked ? <Check size={11} /> : null}
      </button>
      <FileStatusBadge code={statusCode} />
      <div className="file-row-copy">
        <div className="file-row-path" title={file.path}>
          <span className="file-dir">{path.directory}</span>
          <span className={cn('file-name', file.worktreeStatus === 'D' && 'is-deleted')}>
            {path.name}
          </span>
        </div>
        {file.origPath && file.origPath !== file.path ? (
          <div className="file-orig">← {file.origPath}</div>
        ) : (
          <div className="file-row-meta">
            {file.binary ? '二进制文件' : `${file.additions || 0} 行新增 · ${file.deletions || 0} 行删除`}
          </div>
        )}
      </div>
      <div className="file-row-stats">
        {!file.binary ? (
          <>
            <span className="stat-add">+{file.additions || 0}</span>
            <span className="stat-del">−{file.deletions || 0}</span>
          </>
        ) : (
          <span className="stat-bin">BIN</span>
        )}
      </div>
      <button
        className="file-row-history"
        onClick={(event) => {
          event.stopPropagation();
          onOpenHistory(file.path);
        }}
        title="查看此文件的版本历史"
        aria-label="查看此文件的版本历史"
      >
        <FileClock size={13} />
      </button>
    </div>
  );
}

function GroupSection({
  group,
  files,
  selected,
  collapsed,
  onToggleCollapse,
  onSelect,
  onToggleStage,
  onOpenHistory,
  busyPath,
  onBulk,
  bulkBusy,
  filter,
}) {
  const meta = GROUP_META[group];
  const Icon = collapsed ? ChevronRight : ChevronDown;
  const filtered = files.filter((file) =>
    file.path.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  if (filter && filtered.length === 0) return null;
  return (
    <section className="file-group">
      <div className="file-group-head">
        <button className="file-group-toggle" onClick={onToggleCollapse}>
          <Icon size={12} />
          <span>{meta.title}</span>
          <span className="group-count">{files.length}</span>
        </button>
        {meta.action && !collapsed ? (
          <button
            className="group-action"
            onClick={() => onBulk(meta.action, files)}
            disabled={bulkBusy}
          >
            {meta.action === 'stage' ? <Plus size={11} /> : <Minus size={11} />}
            {meta.action === 'stage' ? '全部暂存' : '全部取消'}
          </button>
        ) : null}
      </div>
      {!collapsed ? (
        <div className="file-group-list">
          {filtered.map((file) => (
            <FileRow
              key={`${group}:${file.path}`}
              file={file}
              group={group}
              active={selected?.path === file.path && selected?.group === group}
              busy={busyPath === `${group}:${file.path}`}
              onSelect={onSelect}
              onToggleStage={onToggleStage}
              onOpenHistory={onOpenHistory}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function ChangesView({
  repo,
  refreshKey,
  onChanged,
  onOpenFileHistory,
  onOpenHistory,
  notify,
}) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('');
  const debouncedFilter = useDebouncedValue(filter, 120);
  const [selected, setSelected] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [busyPath, setBusyPath] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [discardTarget, setDiscardTarget] = useState(null);
  const [discardBusy, setDiscardBusy] = useState(false);
  const [diff, setDiff] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState('');
  const [context, setContext] = useState(3);
  const [layout, setLayout] = useState(() => {
    try {
      return localStorage.getItem('gitdeck.diffLayout') || 'split';
    } catch {
      return 'split';
    }
  });
  const textareaRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem('gitdeck.diffLayout', layout);
    } catch {
      // Ignore storage restrictions.
    }
  }, [layout]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    api
      .status(repo.id)
      .then((data) => {
        if (cancelled) return;
        setStatus(data);
        setSelected((previous) => pickSelection(data, previous));
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo.id, refreshKey]);

  useEffect(() => {
    setSelected(null);
    setDiff(null);
    setFilter('');
    setMessage('');
    setCollapsed({});
    setContext(3);
  }, [repo.id]);

  useEffect(() => {
    if (!selected) {
      setDiff(null);
      setDiffError('');
      return undefined;
    }
    const controller = new AbortController();
    setDiffLoading(true);
    setDiffError('');
    setDiff(null);
    api
      .diff(
        repo.id,
        { path: selected.path, mode: selected.mode, context },
        controller.signal,
      )
      .then((result) => setDiff(result))
      .catch((error) => {
        if (error.name !== 'AbortError') setDiffError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDiffLoading(false);
      });
    return () => controller.abort();
  }, [repo.id, selected?.path, selected?.mode, context, refreshKey]);

  const groups = useMemo(() => buildGroups(status?.files || []), [status]);
  const counts = status?.counts || {
    total: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };
  const selectedFile = selected
    ? (status?.files || []).find((file) => file.path === selected.path)
    : null;
  const filteredCount = useMemo(() => {
    if (!debouncedFilter.trim()) return counts.total;
    return (status?.files || []).filter((file) =>
      file.path.toLowerCase().includes(debouncedFilter.trim().toLowerCase()),
    ).length;
  }, [status, debouncedFilter, counts.total]);

  const diffModeOptions = useMemo(() => {
    if (!selectedFile) return [];
    const options = [];
    if (selectedFile.staged) options.push({ mode: 'staged', label: '已暂存' });
    if (selectedFile.unstaged) {
      options.push({ mode: 'worktree', label: '与 HEAD' });
      options.push({ mode: 'unstaged', label: '未暂存' });
    }
    if (selectedFile.untracked) options.push({ mode: 'untracked', label: '未跟踪' });
    if (!options.length) options.push({ mode: 'worktree', label: '与 HEAD' });
    return options;
  }, [selectedFile]);

  function selectFile(path, group) {
    setSelected({ path, group, mode: modeForGroup(group) });
    setContext(3);
  }

  async function toggleStage(file, group) {
    const key = `${group}:${file.path}`;
    setBusyPath(key);
    try {
      const result =
        group === 'staged'
          ? await api.unstage(repo.id, [file.path])
          : await api.stage(repo.id, [file.path]);
      setStatus(result.status);
      setSelected((previous) => pickSelection(result.status, previous));
      onChanged?.({ silent: true });
    } catch (error) {
      notify({
        type: 'error',
        title: group === 'staged' ? '取消暂存失败' : '暂存失败',
        message: error.message,
        detail: error.detail,
      });
    } finally {
      setBusyPath('');
    }
  }

  async function bulkStage(action, files) {
    setBulkBusy(true);
    try {
      const paths = files.map((file) => file.path);
      const result =
        action === 'stage'
          ? await api.stage(repo.id, paths)
          : await api.unstage(repo.id, paths);
      setStatus(result.status);
      setSelected((previous) => pickSelection(result.status, previous));
      onChanged?.({ silent: true });
      notify({
        type: 'success',
        title: action === 'stage' ? '已暂存文件' : '已取消暂存',
        message: `${paths.length} 个文件`,
      });
    } catch (error) {
      notify({
        type: 'error',
        title: action === 'stage' ? '暂存失败' : '取消暂存失败',
        message: error.message,
        detail: error.detail,
      });
    } finally {
      setBulkBusy(false);
    }
  }

  async function stageEverything() {
    setBulkBusy(true);
    try {
      const result = await api.stage(repo.id, []);
      setStatus(result.status);
      setSelected((previous) => pickSelection(result.status, previous));
      onChanged?.({ silent: true });
      notify({ type: 'success', title: '已暂存全部更改' });
    } catch (error) {
      notify({
        type: 'error',
        title: '暂存失败',
        message: error.message,
        detail: error.detail,
      });
    } finally {
      setBulkBusy(false);
    }
  }

  async function unstageEverything() {
    setBulkBusy(true);
    try {
      const result = await api.unstage(repo.id, []);
      setStatus(result.status);
      setSelected((previous) => pickSelection(result.status, previous));
      onChanged?.({ silent: true });
      notify({ type: 'success', title: '已取消全部暂存' });
    } catch (error) {
      notify({
        type: 'error',
        title: '取消暂存失败',
        message: error.message,
        detail: error.detail,
      });
    } finally {
      setBulkBusy(false);
    }
  }

  async function commit() {
    if (commitBusy) return;
    if (!message.trim()) {
      notify({ type: 'warning', title: '请填写提交信息' });
      textareaRef.current?.focus();
      return;
    }
    if (!amend && counts.staged === 0) {
      notify({
        type: 'warning',
        title: '没有已暂存的更改',
        message: '请先暂存要提交的文件，或勾选“修正上次提交”。',
      });
      return;
    }
    setCommitBusy(true);
    try {
      const result = await api.commit(repo.id, { message, amend });
      setStatus(result.status);
      setSelected((previous) => pickSelection(result.status, previous));
      setMessage('');
      setAmend(false);
      onChanged?.();
      notify({
        type: 'success',
        title: amend ? '已修正上一次提交' : '提交成功',
        message: result.commit
          ? `${shortHash(result.commit.hash)} · ${result.commit.subject}`
          : '更改已记录到 Git 历史',
      });
    } catch (error) {
      notify({
        type: 'error',
        title: '提交失败',
        message: error.message,
        detail: error.detail,
      });
    } finally {
      setCommitBusy(false);
    }
  }

  async function confirmDiscard() {
    if (!discardTarget) return;
    setDiscardBusy(true);
    try {
      const result = await api.discard(repo.id, [discardTarget]);
      setStatus(result.status);
      setSelected((previous) => pickSelection(result.status, previous));
      onChanged?.({ silent: true });
      notify({
        type: 'success',
        title: '已丢弃更改',
        message: discardTarget,
      });
      setDiscardTarget(null);
    } catch (error) {
      notify({
        type: 'error',
        title: '丢弃更改失败',
        message: error.message,
        detail: error.detail,
      });
    } finally {
      setDiscardBusy(false);
    }
  }

  async function retryLoad() {
    setRefreshTick((value) => value + 1);
  }
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!refreshTick) return;
    let cancelled = false;
    setLoading(true);
    api
      .status(repo.id)
      .then((data) => {
        if (cancelled) return;
        setStatus(data);
        setSelected((previous) => pickSelection(data, previous));
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick, repo.id]);

  const onTextareaKeyDown = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  };

  return (
    <div className="split-view changes-view">
      <section className="list-panel changes-list">
        <div className="panel-toolbar">
          <div className="panel-title-block">
            <h2>本地更改</h2>
            <span className="panel-subtitle">
              {counts.total} 个文件
              {counts.staged ? ` · ${counts.staged} 已暂存` : ''}
            </span>
          </div>
          <div className="toolbar-actions">
            <button
              className="icon-button"
              onClick={stageEverything}
              disabled={bulkBusy || counts.total === 0}
              title="暂存全部更改"
              aria-label="暂存全部更改"
            >
              {bulkBusy ? <Spinner size={14} /> : <Plus size={14} />}
            </button>
            <button
              className="icon-button"
              onClick={unstageEverything}
              disabled={bulkBusy || counts.staged === 0}
              title="取消全部暂存"
              aria-label="取消全部暂存"
            >
              <Minus size={14} />
            </button>
            <button
              className="icon-button"
              onClick={retryLoad}
              disabled={loading}
              title="刷新更改"
              aria-label="刷新更改"
            >
              {loading ? <Spinner size={14} /> : <RefreshCw size={14} />}
            </button>
          </div>
        </div>

        {counts.conflicted > 0 ? (
          <div className="conflict-banner">
            <AlertTriangle size={14} />
            <span>{counts.conflicted} 个文件存在合并冲突，请解决后暂存。</span>
          </div>
        ) : null}

        <div className="filter-bar-wrap">
          <SearchInput
            value={filter}
            onChange={setFilter}
            placeholder="筛选文件…"
            className="file-filter"
          />
          {debouncedFilter && filteredCount !== counts.total ? (
            <span className="filter-result-count">{filteredCount}</span>
          ) : null}
        </div>

        <div className="list-scroll file-list-scroll">
          {loading && !status ? (
            <div className="change-skeletons">
              {[0, 1, 2, 3, 4].map((index) => (
                <div className="change-skeleton" key={index}>
                  <span className="skeleton-block check" />
                  <span className="skeleton-block badge" />
                  <div>
                    <span className="skeleton-block line" />
                    <span className="skeleton-block line short" />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {!loading && loadError ? (
            <EmptyState
              icon={<AlertTriangle size={24} />}
              title="读取更改失败"
              description={loadError}
              action={
                <button className="button ghost small" onClick={retryLoad}>
                  重试
                </button>
              }
            />
          ) : null}

          {!loading && !loadError && counts.total === 0 ? (
            <EmptyState
              className="clean-state"
              icon={<CheckCircle2 size={28} />}
              title="工作区是干净的"
              description="所有更改都已提交。可以切换到“历史”浏览提交，或从文件历史追踪某个文件。"
              action={
                onOpenHistory ? (
                  <button className="button ghost small" onClick={onOpenHistory}>
                    <History size={14} />
                    查看提交历史
                  </button>
                ) : null
              }
            />
          ) : null}

          {!loading &&
            !loadError &&
            groups.map((group) => (
              <GroupSection
                key={group.id}
                group={group.id}
                files={group.files}
                selected={selected}
                collapsed={collapsed[group.id]}
                onToggleCollapse={() =>
                  setCollapsed((value) => ({ ...value, [group.id]: !value[group.id] }))
                }
                onSelect={selectFile}
                onToggleStage={toggleStage}
                onOpenHistory={onOpenFileHistory}
                busyPath={busyPath}
                onBulk={bulkStage}
                bulkBusy={bulkBusy}
                filter={debouncedFilter}
              />
            ))}
        </div>

        <div className="commit-composer">
          <div className="commit-composer-head">
            <span className="commit-title">
              <GitCommitHorizontal size={13} />
              提交
            </span>
            <span className="commit-target">
              {status?.branchName || 'main'} · {counts.staged} 个暂存文件
            </span>
          </div>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={onTextareaKeyDown}
            placeholder="填写提交信息（Ctrl+Enter 提交）"
            rows={3}
            spellCheck={false}
            aria-label="提交信息"
          />
          <div className="commit-options">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={amend}
                onChange={(event) => setAmend(event.target.checked)}
              />
              <span className="fake-checkbox">
                <Check size={9} />
              </span>
              修正上次提交
            </label>
            <span className="commit-hint">
              {message.length > 0 ? `${message.length} 字符` : '支持多行提交信息'}
            </span>
          </div>
          <div className="commit-actions">
            <div className="commit-summary">
              {counts.staged > 0 ? (
                <>
                  <span className={cn('summary-dot', 'has-staged')} />
                  将提交 {counts.staged} 个文件
                </>
              ) : (
                <>
                  <span className="summary-dot" />
                  暂无已暂存文件
                </>
              )}
            </div>
            <button
              className="commit-button"
              onClick={commit}
              disabled={
                commitBusy ||
                !message.trim() ||
                (!amend && counts.staged === 0)
              }
            >
              {commitBusy ? <Spinner size={14} /> : <CheckCheck size={15} />}
              {amend ? '修正提交' : '提交'}
              <kbd>Ctrl ↵</kbd>
            </button>
          </div>
        </div>
      </section>

      <DiffViewer
        diff={diff}
        loading={diffLoading}
        error={diffError}
        layout={layout}
        onLayoutChange={setLayout}
        filePath={selected?.path}
        context={context}
        onToggleContext={() => setContext((value) => (value >= 1000 ? 3 : 9999))}
        onRetry={() => {
          if (!selected) return;
          setDiffLoading(true);
          api
            .diff(repo.id, {
              path: selected.path,
              mode: selected.mode,
              context,
            })
            .then(setDiff)
            .catch((error) => setDiffError(error.message))
            .finally(() => setDiffLoading(false));
        }}
        metaLabel={
          diffModeOptions.length > 1 ? (
            <div className="inline-mode-switch">
              {diffModeOptions.map((option) => (
                <button
                  key={option.mode}
                  className={cn(selected?.mode === option.mode && 'is-active')}
                  onClick={() =>
                    setSelected((previous) =>
                      previous ? { ...previous, mode: option.mode } : previous,
                    )
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null
        }
        actions={
          selectedFile ? (
            <>
              {selectedFile.staged || selectedFile.unstaged ? (
                <button
                  className="icon-button diff-action danger-hover"
                  onClick={() => setDiscardTarget(selectedFile.path)}
                  title="丢弃此文件的更改"
                  aria-label="丢弃此文件的更改"
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
              <button
                className="icon-button diff-action"
                onClick={() => onOpenFileHistory(selectedFile.path)}
                title="打开文件历史"
                aria-label="打开文件历史"
              >
                <FileClock size={14} />
              </button>
            </>
          ) : null
        }
      />

      <ConfirmDialog
        open={Boolean(discardTarget)}
        title="丢弃文件更改？"
        description={`将丢弃 ${discardTarget || ''} 的工作区和暂存区修改，此操作无法撤销。`}
        confirmLabel="丢弃更改"
        danger
        loading={discardBusy}
        onClose={() => setDiscardTarget(null)}
        onConfirm={confirmDiscard}
      />
    </div>
  );
}
