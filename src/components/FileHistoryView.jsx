import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  Eye,
  FileClock,
  FileSearch,
  FileText,
  GitCommitHorizontal,
  History,
  Sparkles,
  X,
} from 'lucide-react';
import { api } from '../api.js';
import {
  cn,
  relativeTime,
  shortHash,
  splitPath,
  useDebouncedValue,
} from '../utils.js';
import {
  EmptyState,
  Modal,
  ModalHeader,
  Spinner,
} from './common.jsx';
import DiffViewer from './DiffViewer.jsx';

function FileSuggestions({ items, loading, query, onPick, total }) {
  if (!query) return null;
  return (
    <div className="file-suggestions">
      <div className="suggestions-head">
        <span>匹配文件</span>
        <span>{total ?? items.length}</span>
      </div>
      {loading ? (
        <div className="suggestions-loading">
          <Spinner size={14} />
          正在查找…
        </div>
      ) : null}
      {!loading && items.length === 0 ? (
        <div className="suggestions-empty">没有匹配的已跟踪文件</div>
      ) : null}
      {!loading &&
        items.map((file) => {
          const parts = splitPath(file);
          return (
            <button key={file} className="suggestion-row" onClick={() => onPick(file)}>
              <FileText size={13} />
              <span title={file}>
                <span className="suggestion-dir">{parts.directory}</span>
                {parts.name}
              </span>
              <ChevronRight size={12} />
            </button>
          );
        })}
    </div>
  );
}

function SnapshotModal({ snapshot, open, onClose, onRequest, loading, error }) {
  const [copied, setCopied] = useState(false);
  const content = snapshot?.content || '';
  const lines = useMemo(() => {
    if (!content) return [];
    const all = content.split(/\r?\n/);
    return all.slice(0, 4000);
  }, [content]);
  const truncatedLines = content && content.split(/\r?\n/).length > lines.length;
  async function copyAll() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard restrictions.
    }
  }
  return (
    <Modal open={open} onClose={onClose} className="snapshot-card" ariaLabel="历史版本快照">
      <ModalHeader
        eyebrow="FILE SNAPSHOT"
        title="历史版本"
        description={snapshot ? `${snapshot.path} @ ${shortHash(snapshot.rev)}` : undefined}
        onClose={onClose}
        icon={<Code2 size={18} />}
      />
      <div className="snapshot-meta">
        <span className="snapshot-rev">
          <GitCommitHorizontal size={12} />
          {snapshot ? shortHash(snapshot.rev) : '—'}
        </span>
        {snapshot ? <span>{snapshot.binary ? '二进制文件' : `${snapshot.size || 0} 字节`}</span> : null}
        {snapshot?.truncated ? <span className="snapshot-warning">内容已截断</span> : null}
        <div className="snapshot-actions">
          <button className="button ghost small" onClick={copyAll} disabled={!content}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? '已复制' : '复制内容'}
          </button>
          <button className="button ghost small" onClick={onRequest} disabled={loading}>
            {loading ? <Spinner size={13} /> : <FileSearch size={13} />}
            重新读取
          </button>
        </div>
      </div>
      <div className="snapshot-body">
        {loading ? (
          <div className="snapshot-loading">
            <Spinner size={20} />
            正在读取此版本…
          </div>
        ) : null}
        {!loading && error ? (
          <EmptyState icon={<FileText size={28} />} title="无法读取版本" description={error} />
        ) : null}
        {!loading && !error && snapshot?.binary ? (
          <EmptyState
            icon={<BinaryIcon />}
            title="二进制文件"
            description="此文件包含二进制内容，无法以文本形式显示。"
          />
        ) : null}
        {!loading && !error && snapshot && !snapshot.binary ? (
          <>
            <div className="snapshot-code">
              {lines.map((line, index) => (
                <div className="snapshot-line" key={index}>
                  <span className="snapshot-line-number">{index + 1}</span>
                  <code>{line || ' '}</code>
                </div>
              ))}
            </div>
            {truncatedLines ? (
              <div className="snapshot-truncated">仅显示前 4,000 行</div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function BinaryIcon() {
  return <FileText size={28} />;
}

function VersionStrip({
  commit,
  viewMode,
  setViewMode,
  onSnapshot,
  compareSelection,
  comparePair,
  compareMode,
}) {
  if (!commit && !compareMode) return null;
  if (compareMode) {
    return (
      <div className="version-strip compare-strip">
        <div className="version-commit">
          <ArrowLeftRight size={15} />
          <div>
            <strong>版本对比</strong>
            <span>
              {comparePair
                ? `${shortHash(comparePair.from)} → ${shortHash(comparePair.to)}`
                : compareSelection.length === 2
                  ? `${shortHash(compareSelection[0])} ↔ ${shortHash(compareSelection[1])}`
                  : '从左侧选择两个历史版本'}
            </span>
          </div>
        </div>
        <span className="compare-tip">
          <Sparkles size={12} />
          {compareSelection.length === 2 ? '正在展示差异' : '已选择 ' + compareSelection.length + '/2'}
        </span>
      </div>
    );
  }
  return (
    <div className="version-strip">
      <div className="version-commit">
        <span className="version-icon">
          <GitCommitHorizontal size={14} />
        </span>
        <div>
          <strong>{commit.subject}</strong>
          <span>
            {commit.author} · {relativeTime(commit.authorDate)} · {commit.shortHash}
          </span>
        </div>
      </div>
      <div className="version-actions">
        <div className="segmented small">
          <button
            className={cn(viewMode === 'commit' && 'is-active')}
            onClick={() => setViewMode('commit')}
          >
            此版本变更
          </button>
          <button
            className={cn(viewMode === 'worktree' && 'is-active')}
            onClick={() => setViewMode('worktree')}
          >
            与工作区
          </button>
        </div>
        <button className="button ghost small" onClick={onSnapshot}>
          <Eye size={13} />
          查看此版本
        </button>
      </div>
    </div>
  );
}

export default function FileHistoryView({
  repo,
  seed,
  refreshKey,
  notify,
}) {
  const [pathValue, setPathValue] = useState(() => {
    if (seed?.path) return seed.path;
    try {
      return localStorage.getItem('gitdeck.lastFileHistoryPath') || '';
    } catch {
      return '';
    }
  });
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestions, setSuggestions] = useState({ files: [], total: 0 });
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedHash, setSelectedHash] = useState(null);
  const pendingHashRef = useRef(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareHashes, setCompareHashes] = useState([]);
  const [viewMode, setViewMode] = useState('commit');
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
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState('');
  const pathFieldRef = useRef(null);
  const debouncedPath = useDebouncedValue(pathValue, 380);
  const debouncedSuggest = useDebouncedValue(pathValue, 180);

  useEffect(() => {
    try {
      localStorage.setItem('gitdeck.diffLayout', layout);
    } catch {
      // Ignore storage restrictions.
    }
  }, [layout]);

  useEffect(() => {
    if (!seed?.path) return;
    setPathValue(seed.path);
    pendingHashRef.current = seed.commit || null;
    setCompareMode(false);
    setCompareHashes([]);
    setSnapshotOpen(false);
    setDiff(null);
    setDiffError('');
  }, [seed?.nonce, seed?.path, seed?.commit, repo.id]);

  useEffect(() => {
    setLoading(true);
    setError('');
    const targetPath = debouncedPath.trim();
    if (!targetPath) {
      setLoading(false);
      setHistory(null);
      setSelectedHash(null);
      return undefined;
    }
    let cancelled = false;
    api
      .fileHistory(repo.id, { path: targetPath, limit: 80 })
      .then((data) => {
        if (cancelled) return;
        setHistory(data);
        const wantedHash = pendingHashRef.current;
        pendingHashRef.current = null;
        setSelectedHash((previous) => {
          if (wantedHash && data.entries.some((entry) => entry.hash === wantedHash)) {
            return wantedHash;
          }
          if (data.entries.some((entry) => entry.hash === previous)) return previous;
          return data.entries[0]?.hash || null;
        });
        try {
          localStorage.setItem('gitdeck.lastFileHistoryPath', targetPath);
        } catch {
          // Ignore storage restrictions.
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
  }, [repo.id, debouncedPath, refreshKey, seed?.nonce]);

  useEffect(() => {
    const query = debouncedSuggest.trim();
    if (!suggestOpen || !query) {
      setSuggestions({ files: [], total: 0 });
      return undefined;
    }
    let cancelled = false;
    setSuggestLoading(true);
    api
      .files(repo.id, query)
      .then((data) => {
        if (!cancelled) setSuggestions(data);
      })
      .catch(() => {
        if (!cancelled) setSuggestions({ files: [], total: 0 });
      })
      .finally(() => {
        if (!cancelled) setSuggestLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo.id, debouncedSuggest, suggestOpen]);

  useEffect(() => {
    if (!compareMode) setCompareHashes([]);
  }, [compareMode]);

  useEffect(() => {
    if (compareMode) {
      setDiff(null);
      setDiffError('');
      return undefined;
    }
    if (!selectedHash || !debouncedPath.trim()) {
      setDiff(null);
      return undefined;
    }
    const controller = new AbortController();
    setDiffLoading(true);
    setDiffError('');
    setDiff(null);
    const params =
      viewMode === 'worktree'
        ? {
            path: debouncedPath.trim(),
            mode: 'commit-to-worktree',
            from: selectedHash,
            context,
          }
        : {
            path: debouncedPath.trim(),
            mode: 'commit',
            to: selectedHash,
            context,
          };
    api
      .diff(repo.id, params, controller.signal)
      .then((data) => setDiff(data))
      .catch((err) => {
        if (err.name !== 'AbortError') setDiffError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDiffLoading(false);
      });
    return () => controller.abort();
  }, [repo.id, selectedHash, debouncedPath, viewMode, compareMode, context, refreshKey]);

  const comparePair = useMemo(() => {
    if (!history || compareHashes.length !== 2) return null;
    const indices = compareHashes
      .map((hash) => history.entries.findIndex((entry) => entry.hash === hash))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b);
    if (indices.length !== 2) return null;
    const newest = history.entries[indices[0]];
    const oldest = history.entries[indices[1]];
    return { from: oldest.hash, to: newest.hash, newest, oldest };
  }, [compareHashes, history]);

  useEffect(() => {
    if (!compareMode || !comparePair) {
      if (compareMode) setDiff(null);
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
          path: debouncedPath.trim(),
          mode: 'between',
          from: comparePair.from,
          to: comparePair.to,
          context,
        },
        controller.signal,
      )
      .then((data) => setDiff(data))
      .catch((err) => {
        if (err.name !== 'AbortError') setDiffError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDiffLoading(false);
      });
    return () => controller.abort();
  }, [repo.id, compareMode, comparePair, debouncedPath, context]);

  const selectedCommit = useMemo(
    () => history?.entries.find((entry) => entry.hash === selectedHash) || null,
    [history, selectedHash],
  );

  function pickSuggestion(file) {
    setPathValue(file);
    setSuggestOpen(false);
    setCompareHashes([]);
    const target = document.activeElement;
    if (target instanceof HTMLElement) target.blur();
  }

  function toggleCompareHash(hash) {
    setCompareHashes((previous) => {
      if (previous.includes(hash)) return previous.filter((value) => value !== hash);
      if (previous.length >= 2) return [previous[1], hash];
      return [...previous, hash];
    });
    setSelectedHash(hash);
  }

  async function loadSnapshot(rev) {
    if (!rev) return;
    setSnapshotOpen(true);
    setSnapshotLoading(true);
    setSnapshotError('');
    setSnapshot(null);
    try {
      const data = await api.fileContent(repo.id, {
        path: debouncedPath.trim(),
        rev,
      });
      setSnapshot(data);
    } catch (err) {
      setSnapshotError(err.message);
    } finally {
      setSnapshotLoading(false);
    }
  }

  const hasFilePath = Boolean(debouncedPath.trim());
  const historyEntries = history?.entries || [];

  return (
    <div className="split-view file-history-view">
      <section className="list-panel file-history-list">
        <div className="panel-toolbar">
          <div className="panel-title-block">
            <h2>文件历史</h2>
            <span className="panel-subtitle">跟随文件重命名</span>
          </div>
          <button
            className={cn('button ghost small compare-toggle', compareMode && 'is-active')}
            onClick={() => setCompareMode((value) => !value)}
            disabled={!hasFilePath}
          >
            <ArrowLeftRight size={13} />
            {compareMode ? '退出对比' : '对比版本'}
          </button>
        </div>

        <div className="file-path-picker" ref={pathFieldRef}>
          <div className={cn('file-path-input', suggestOpen && 'is-focused')}>
            <FileSearch size={14} />
            <input
              value={pathValue}
              onChange={(event) => {
                setPathValue(event.target.value);
                setSuggestOpen(true);
                setCompareHashes([]);
              }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => setTimeout(() => setSuggestOpen(false), 140)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setSuggestOpen(false);
                  const first = suggestions.files[0];
                  if (first) pickSuggestion(first);
                }
                if (event.key === 'Escape') setSuggestOpen(false);
              }}
              placeholder="输入文件路径，例如 src/App.jsx"
              spellCheck={false}
              aria-label="文件路径"
            />
            {pathValue ? (
              <button
                className="path-clear"
                onClick={() => {
                  setPathValue('');
                  setHistory(null);
                  setDiff(null);
                }}
                aria-label="清空路径"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
          {suggestOpen ? (
            <FileSuggestions
              items={suggestions.files || []}
              total={suggestions.total}
              loading={suggestLoading}
              query={pathValue.trim()}
              onPick={pickSuggestion}
            />
          ) : null}
        </div>

        {compareMode ? (
          <div className="compare-bar">
            <span className="compare-bar-icon">
              <ArrowLeftRight size={13} />
            </span>
            <span>
              已选择 <strong>{compareHashes.length}</strong> / 2 个版本
              {compareHashes.length === 2 ? ' · 差异已加载' : ' · 勾选左侧版本'}
            </span>
            {compareHashes.length ? (
              <button
                className="compare-clear"
                onClick={() => setCompareHashes([])}
                title="清空选择"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="list-scroll version-list">
          {!hasFilePath ? (
            <EmptyState
              icon={<FileClock size={28} />}
              title="追踪一个文件"
              description="输入路径或从匹配结果中选择文件，查看它的每次版本变化、提交作者与差异。"
            />
          ) : null}

          {hasFilePath && loading ? (
            <div className="history-loading">
              {[0, 1, 2, 3, 4].map((index) => (
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

          {hasFilePath && !loading && error ? (
            <EmptyState
              icon={<Clock3 size={24} />}
              title="读取文件历史失败"
              description={error}
            />
          ) : null}

          {hasFilePath && !loading && !error && history && historyEntries.length === 0 ? (
            <EmptyState
              icon={<FileClock size={27} />}
              title={history.tracked ? '这个文件还没有历史' : '文件尚未被追踪'}
              description={
                history.tracked
                  ? '该路径在 Git 历史中没有记录，可能还没有提交。'
                  : history.exists
                    ? '文件在工作区中存在，但还没有被 Git 跟踪，因此没有历史版本。'
                    : '在仓库中找不到这个路径，请检查拼写或使用文件搜索。'
              }
            />
          ) : null}

          {hasFilePath && !loading && !error && historyEntries.length > 0 ? (
            <div className="version-timeline">
              <div className="version-list-head">
                <span>{historyEntries.length} 个版本</span>
                <span>最新在前</span>
              </div>
              {historyEntries.map((entry, index) => {
                const checked = compareHashes.includes(entry.hash);
                return (
                  <div
                    className={cn(
                      'version-row',
                      selectedHash === entry.hash && !compareMode && 'is-active',
                      checked && 'is-checked',
                      index === 0 && 'is-latest',
                    )}
                    key={entry.hash}
                    onClick={() =>
                      compareMode ? toggleCompareHash(entry.hash) : setSelectedHash(entry.hash)
                    }
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        if (compareMode) toggleCompareHash(entry.hash);
                        else setSelectedHash(entry.hash);
                      }
                    }}
                  >
                    <div className="version-rail">
                      <span className="version-line" />
                      {compareMode ? (
                        <span className={cn('version-check', checked && 'is-checked')}>
                          {checked ? <Check size={9} /> : null}
                        </span>
                      ) : (
                        <span className="version-dot" />
                      )}
                    </div>
                    <div className="version-copy">
                      <div className="version-subject">{entry.subject}</div>
                      <div className="version-meta">
                        <span>{entry.author}</span>
                        <span className="meta-dot" />
                        <span>{relativeTime(entry.authorDate)}</span>
                        <span className="meta-dot" />
                        <code>{entry.shortHash}</code>
                        {index === 0 ? <span className="latest-badge">最新</span> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              {history?.hasMore ? (
                <div className="version-more-note">仅展示最近 {historyEntries.length} 个版本</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="file-history-detail">
        {!hasFilePath ? (
          <EmptyState
            className="file-history-empty"
            icon={<FileSearch size={32} />}
            title="查看某个文件的版本故事"
            description="在左侧输入文件路径，GitDeck 会沿着重命名追踪这个文件的历史，并把每一次变化放在时间线上。"
          />
        ) : null}

        {hasFilePath && !loading && (selectedCommit || compareMode) ? (
          <>
            <VersionStrip
              commit={selectedCommit}
              viewMode={viewMode}
              setViewMode={setViewMode}
              onSnapshot={() => loadSnapshot(selectedHash)}
              compareSelection={compareHashes}
              comparePair={comparePair}
              compareMode={compareMode}
            />
            {compareMode && compareHashes.length !== 2 ? (
              <EmptyState
                className="file-history-empty"
                icon={<ArrowLeftRight size={30} />}
                title={compareHashes.length === 0 ? '选择两个版本' : '再选择一个版本'}
                description="勾选任意两个历史版本，即可横向比较这个文件在两个时间点之间的差异。"
              />
            ) : (
              <DiffViewer
                className="file-history-diff"
                diff={diff}
                loading={diffLoading}
                error={diffError}
                layout={layout}
                onLayoutChange={setLayout}
                filePath={debouncedPath.trim()}
                context={context}
                onToggleContext={() => setContext((value) => (value >= 1000 ? 3 : 9999))}
                metaLabel={
                  compareMode && comparePair ? (
                    <span className="compare-label">
                      {shortHash(comparePair.from)} → {shortHash(comparePair.to)}
                    </span>
                  ) : null
                }
              />
            )}
          </>
        ) : null}

        {hasFilePath && !loading && !selectedCommit && !compareMode && history ? (
          <EmptyState
            className="file-history-empty"
            icon={<History size={30} />}
            title="没有可展示的版本"
            description="请选择左侧的一个历史版本。"
          />
        ) : null}
      </section>

      <SnapshotModal
        open={snapshotOpen}
        onClose={() => setSnapshotOpen(false)}
        snapshot={snapshot}
        loading={snapshotLoading}
        error={snapshotError}
        onRequest={() => loadSnapshot(selectedHash)}
      />
    </div>
  );
}
