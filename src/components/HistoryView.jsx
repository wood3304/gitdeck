import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  ChevronDown,
  FileClock,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  History,
  Search,
  Tag,
  User,
} from 'lucide-react';
import { api } from '../api.js';
import {
  cn,
  formatDateTime,
  getInitial,
  relativeTime,
  splitPath,
  statusMeta,
  useDebouncedValue,
} from '../utils.js';
import { CopyButton, EmptyState, SearchInput, Spinner } from './common.jsx';
import DiffViewer from './DiffViewer.jsx';

function RefChip({ item, compact = false }) {
  const Icon = item.kind === 'tag' ? Tag : item.kind === 'head' ? GitBranch : GitBranch;
  return (
    <span className={cn('ref-chip', `ref-${item.kind}`, compact && 'compact')} title={item.raw}>
      <Icon size={9} />
      {item.name}
    </span>
  );
}

function CommitRow({ commit, selected, onSelect }) {
  const isMerge = commit.parents.length > 1;
  const refs = commit.refs || [];
  return (
    <div
      className={cn('commit-row', selected && 'is-active', isMerge && 'is-merge')}
      onClick={() => onSelect(commit.hash)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSelect(commit.hash);
      }}
    >
      <div className="commit-graph">
        <span className="graph-line" />
        <span className={cn('graph-dot', isMerge && 'merge')}>
          {isMerge ? <GitMerge size={8} /> : null}
        </span>
      </div>
      <div className="commit-row-main">
        <div className="commit-subject" title={commit.subject}>
          {commit.subject}
        </div>
        <div className="commit-row-meta">
          <span className="commit-author">{commit.author}</span>
          <span className="meta-dot" />
          <span>{relativeTime(commit.authorDate)}</span>
          <span className="meta-dot" />
          <code>{commit.shortHash}</code>
        </div>
        {refs.length ? (
          <div className="commit-refs">
            {refs.slice(0, 3).map((ref, index) => (
              <RefChip item={ref} key={`${ref.raw}-${index}`} compact />
            ))}
            {refs.length > 3 ? <span className="ref-more">+{refs.length - 3}</span> : null}
          </div>
        ) : null}
      </div>
      {isMerge ? <span className="merge-mark">merge</span> : null}
    </div>
  );
}

function CommitFiles({
  files,
  selectedPath,
  onSelect,
  onOpenFileHistory,
  filter,
  setFilter,
}) {
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((file) => file.path.toLowerCase().includes(needle));
  }, [files, filter]);

  return (
    <div className="commit-files">
      <div className="commit-files-head">
        <div className="commit-files-title">
          <span>变更文件</span>
          <span className="files-count">{files.length}</span>
        </div>
        {files.length > 7 ? (
          <label className="mini-search">
            <Search size={12} />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="筛选文件"
              spellCheck={false}
            />
          </label>
        ) : null}
      </div>
      <div className="commit-file-scroll">
        {filtered.map((file) => {
          const meta = statusMeta(file.statusCode);
          const path = splitPath(file.path);
          return (
            <div
              className={cn(
                'commit-file-row',
                selectedPath === file.path && 'is-active',
              )}
              key={file.path}
              onClick={() => onSelect(file.path)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSelect(file.path);
              }}
            >
              <span className={cn('file-status', meta.tone)}>{meta.label}</span>
              <span className="commit-file-path" title={file.path}>
                <span className="file-dir">{path.directory}</span>
                {path.name}
              </span>
              <span className="commit-file-stats">
                {file.binary ? (
                  'BIN'
                ) : (
                  <>
                    <span className="stat-add">+{file.additions || 0}</span>
                    <span className="stat-del">−{file.deletions || 0}</span>
                  </>
                )}
              </span>
              <button
                className="commit-file-history"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenFileHistory(file.path);
                }}
                title="打开文件历史"
                aria-label="打开文件历史"
              >
                <FileClock size={13} />
              </button>
            </div>
          );
        })}
        {filtered.length === 0 ? <div className="commit-files-empty">没有匹配文件</div> : null}
      </div>
    </div>
  );
}

export default function HistoryView({ repo, refreshKey, onOpenFileHistory, notify }) {
  const [log, setLog] = useState({ entries: [], hasMore: false });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 280);
  const [allBranches, setAllBranches] = useState(false);
  const [selectedHash, setSelectedHash] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileFilter, setFileFilter] = useState('');
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
    setError('');
    api
      .log(repo.id, {
        limit: 60,
        q: debouncedSearch,
        all: allBranches,
      })
      .then((data) => {
        if (cancelled) return;
        setLog(data);
        setSelectedHash((previous) =>
          data.entries.some((entry) => entry.hash === previous)
            ? previous
            : data.entries[0]?.hash || null,
        );
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
  }, [repo.id, refreshKey, debouncedSearch, allBranches]);

  useEffect(() => {
    if (!selectedHash) {
      setDetail(null);
      setSelectedFile(null);
      return undefined;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError('');
    setSelectedFile(null);
    setDetail(null);
    setDiff(null);
    setFileFilter('');
    api
      .commitDetail(repo.id, selectedHash)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setSelectedFile(data.files[0]?.path || null);
      })
      .catch((err) => {
        if (!cancelled) setDetailError(err.message);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo.id, selectedHash, refreshKey]);

  useEffect(() => {
    if (!selectedHash || !selectedFile) {
      setDiff(null);
      return undefined;
    }
    const controller = new AbortController();
    setDiffLoading(true);
    setDiffError('');
    setDiff(null);
    api
      .diff(
        repo.id,
        {
          path: selectedFile,
          mode: 'commit',
          to: selectedHash,
          context,
        },
        controller.signal,
      )
      .then((result) => setDiff(result))
      .catch((err) => {
        if (err.name !== 'AbortError') setDiffError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDiffLoading(false);
      });
    return () => controller.abort();
  }, [repo.id, selectedHash, selectedFile, context, refreshKey]);

  async function loadMore() {
    if (loadingMore || !log.hasMore) return;
    setLoadingMore(true);
    try {
      const data = await api.log(repo.id, {
        limit: 60,
        skip: log.entries.length,
        q: debouncedSearch,
        all: allBranches,
      });
      setLog((previous) => {
        const seen = new Set(previous.entries.map((entry) => entry.hash));
        const merged = [...previous.entries, ...data.entries.filter((entry) => !seen.has(entry.hash))];
        return { ...data, entries: merged };
      });
    } catch (err) {
      notify({
        type: 'error',
        title: '加载更多提交失败',
        message: err.message,
        detail: err.detail,
      });
    } finally {
      setLoadingMore(false);
    }
  }

  const totalStats = detail
    ? detail.files.reduce(
        (accumulator, file) => ({
          additions: accumulator.additions + (file.additions || 0),
          deletions: accumulator.deletions + (file.deletions || 0),
        }),
        { additions: 0, deletions: 0 },
      )
    : { additions: 0, deletions: 0 };

  return (
    <div className="split-view history-view">
      <section className="list-panel history-list">
        <div className="panel-toolbar">
          <div className="panel-title-block">
            <h2>提交历史</h2>
            <span className="panel-subtitle">
              {allBranches ? '全部分支' : repo.branchName || repo.branch}
            </span>
          </div>
          <div className="history-filters">
            <div className="segmented small">
              <button
                className={cn(!allBranches && 'is-active')}
                onClick={() => setAllBranches(false)}
              >
                当前分支
              </button>
              <button
                className={cn(allBranches && 'is-active')}
                onClick={() => setAllBranches(true)}
              >
                全部分支
              </button>
            </div>
          </div>
        </div>

        <div className="history-search-row">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="搜索提交信息…"
            className="history-search"
          />
        </div>

        <div className="list-scroll commit-list">
          {loading ? (
            <div className="history-loading">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <div className="history-skeleton" key={index}>
                  <span className="skeleton-block graph" />
                  <div>
                    <span className="skeleton-block line" />
                    <span className="skeleton-block line short" />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {!loading && error ? (
            <EmptyState
              icon={<History size={24} />}
              title="读取提交历史失败"
              description={error}
            />
          ) : null}

          {!loading && !error && log.entries.length === 0 ? (
            <EmptyState
              icon={<GitCommitHorizontal size={26} />}
              title={debouncedSearch ? '没有匹配的提交' : '还没有提交'}
              description={
                debouncedSearch
                  ? '尝试其他关键词，或切换到全部分支。'
                  : '完成第一次提交后，提交记录会出现在这里。'
              }
            />
          ) : null}

          {!loading &&
            !error &&
            log.entries.map((commit) => (
              <CommitRow
                key={commit.hash}
                commit={commit}
                selected={commit.hash === selectedHash}
                onSelect={setSelectedHash}
              />
            ))}

          {!loading && !error && log.hasMore ? (
            <button className="load-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Spinner size={14} /> : <ChevronDown size={14} />}
              加载更多提交
            </button>
          ) : null}
        </div>
      </section>

      <section className="history-detail">
        {detailLoading ? (
          <div className="detail-loading">
            <div className="detail-skeleton-head">
              <span className="skeleton-block line wide" />
              <span className="skeleton-block line" />
              <span className="skeleton-block line short" />
            </div>
            <div className="detail-skeleton-files">
              {[0, 1, 2].map((index) => (
                <span className="skeleton-block line" key={index} />
              ))}
            </div>
          </div>
        ) : null}

        {!detailLoading && detailError ? (
          <EmptyState
            icon={<History size={28} />}
            title="无法读取提交详情"
            description={detailError}
          />
        ) : null}

        {!detailLoading && !detailError && !detail ? (
          <EmptyState
            className="history-detail-empty"
            icon={<GitCommitHorizontal size={30} />}
            title="选择一个提交"
            description="从左侧时间线选择提交，查看提交信息、变更文件与逐文件差异。"
          />
        ) : null}

        {!detailLoading && !detailError && detail ? (
          <>
            <div className="commit-detail-head">
              <div className="commit-detail-title-row">
                <div>
                  <div className="commit-detail-kicker">
                    <span className="kicker-dot" />
                    COMMIT
                    <code>{detail.shortHash}</code>
                    {detail.isMerge ? (
                      <span className="merge-badge">
                        <GitMerge size={10} />
                        合并提交
                      </span>
                    ) : null}
                  </div>
                  <h2>{detail.subject}</h2>
                </div>
                <div className="commit-head-actions">
                  <CopyButton value={detail.hash} label="复制哈希" />
                </div>
              </div>

              {detail.body ? <pre className="commit-body">{detail.body}</pre> : null}

              <div className="commit-meta-row">
                <div className="commit-author-block">
                  <span className="author-avatar">{getInitial(detail.author)}</span>
                  <div>
                    <strong>{detail.author}</strong>
                    <span>{detail.authorEmail}</span>
                  </div>
                </div>
                <div className="commit-meta-item">
                  <CalendarClock size={12} />
                  <span title={formatDateTime(detail.authorDate)}>
                    {relativeTime(detail.authorDate)}
                  </span>
                </div>
                {detail.committer && detail.committer !== detail.author ? (
                  <div className="commit-meta-item">
                    <User size={12} />
                    <span>提交者 {detail.committer}</span>
                  </div>
                ) : null}
                <div className="commit-meta-item">
                  <GitCommitHorizontal size={12} />
                  <span>
                    {detail.files.length} 个文件 ·{' '}
                    <span className="stat-add">+{totalStats.additions}</span>{' '}
                    <span className="stat-del">−{totalStats.deletions}</span>
                  </span>
                </div>
                {detail.isMerge ? (
                  <span className="merge-note">与第一个父提交比较</span>
                ) : null}
              </div>

              {detail.refs.length ? (
                <div className="detail-refs">
                  {detail.refs.map((ref, index) => (
                    <RefChip item={ref} key={`${ref.raw}-${index}`} />
                  ))}
                </div>
              ) : null}
            </div>

            <CommitFiles
              files={detail.files}
              selectedPath={selectedFile}
              onSelect={setSelectedFile}
              onOpenFileHistory={(filePath) => onOpenFileHistory(filePath, detail.hash)}
              filter={fileFilter}
              setFilter={setFileFilter}
            />

            <DiffViewer
              className="history-diff"
              diff={diff}
              loading={diffLoading}
              error={diffError}
              layout={layout}
              onLayoutChange={setLayout}
              filePath={selectedFile}
              context={context}
              onToggleContext={() => setContext((value) => (value >= 1000 ? 3 : 9999))}
              actions={
                selectedFile ? (
                  <button
                    className="icon-button diff-action"
                    onClick={() => onOpenFileHistory(selectedFile, detail.hash)}
                    title="打开文件历史"
                    aria-label="打开文件历史"
                  >
                    <FileClock size={14} />
                  </button>
                ) : null
              }
            />
          </>
        ) : null}
      </section>
    </div>
  );
}
