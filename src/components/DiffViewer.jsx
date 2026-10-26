import { Fragment, useMemo, useState } from 'react';
import {
  ArrowRight,
  Binary,
  Check,
  Copy,
  FileDiff,
  FileWarning,
  Maximize2,
  Minimize2,
  Rows3,
  Columns2,
} from 'lucide-react';
import { cn, copyText, splitPath, statusMeta } from '../utils.js';
import { EmptyState } from './common.jsx';

function tokenize(text) {
  return String(text).match(/(\s+|[^\p{L}\p{N}_]+|[\p{L}\p{N}_]+)/gu) || [];
}

function computeWordDiff(oldText, newText) {
  const left = tokenize(oldText);
  const right = tokenize(newText);
  if (left.length * right.length > 45_000 || left.length > 260 || right.length > 260) {
    return null;
  }
  const rows = left.length + 1;
  const cols = right.length + 1;
  const table = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        left[i] === right[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const leftChanged = new Set();
  const rightChanged = new Set();
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      leftChanged.add(i);
      i += 1;
    } else {
      rightChanged.add(j);
      j += 1;
    }
  }
  while (i < left.length) {
    leftChanged.add(i);
    i += 1;
  }
  while (j < right.length) {
    rightChanged.add(j);
    j += 1;
  }
  return {
    left: left.map((token, index) => ({ token, changed: leftChanged.has(index) })),
    right: right.map((token, index) => ({ token, changed: rightChanged.has(index) })),
  };
}

function Tokens({ tokens, tone }) {
  if (!tokens) return null;
  return tokens.map((part, index) =>
    part.changed ? (
      <mark key={index} className={cn('word-highlight', tone)}>
        {part.token}
      </mark>
    ) : (
      <Fragment key={index}>{part.token}</Fragment>
    ),
  );
}

function LineNumber({ value }) {
  return <span className="diff-line-number">{value ?? ''}</span>;
}

function Sign({ type }) {
  return (
    <span className={cn('diff-sign', type)}>
      {type === 'add' ? '+' : type === 'del' ? '−' : ''}
    </span>
  );
}

function CodeContent({ line, tokens, tone }) {
  return (
    <span className="diff-code">
      {tokens ? <Tokens tokens={tokens} tone={tone} /> : line?.content}
      {line?.noNewline ? <span className="eof-marker"> ↵ no newline</span> : null}
    </span>
  );
}

function SplitLine({ left, right, pair }) {
  const wordDiff = useMemo(
    () =>
      left && right && left.content !== right.content
        ? computeWordDiff(left.content, right.content)
        : null,
    [left, right],
  );
  return (
    <div className={cn('split-row', pair && 'is-paired')}>
      <div
        className={cn(
          'split-cell old',
          left ? left.type : 'blank',
          right && !left && 'blank-add',
        )}
      >
        {left ? (
          <>
            <LineNumber value={left.oldLine} />
            <Sign type={left.type} />
            <CodeContent line={left} tokens={wordDiff?.left} tone="del" />
          </>
        ) : (
          <span className="blank-line" aria-hidden="true" />
        )}
      </div>
      <div
        className={cn(
          'split-cell new',
          right ? right.type : 'blank',
          left && !right && 'blank-del',
        )}
      >
        {right ? (
          <>
            <LineNumber value={right.newLine} />
            <Sign type={right.type} />
            <CodeContent line={right} tokens={wordDiff?.right} tone="add" />
          </>
        ) : (
          <span className="blank-line" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

function HunkHeader({ hunk }) {
  return (
    <div className="hunk-header">
      <span className="hunk-chevron">›</span>
      <code>
        @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
      </code>
      {hunk.section ? <span className="hunk-section">{hunk.section}</span> : null}
    </div>
  );
}

function SplitDiff({ hunks }) {
  const rows = useMemo(() => {
    const output = [];
    for (const hunk of hunks) {
      output.push({ kind: 'hunk', hunk });
      let index = 0;
      while (index < hunk.lines.length) {
        const line = hunk.lines[index];
        if (line.type === 'context') {
          output.push({ kind: 'context', line });
          index += 1;
          continue;
        }
        const deletions = [];
        const additions = [];
        while (index < hunk.lines.length && hunk.lines[index].type !== 'context') {
          const current = hunk.lines[index];
          if (current.type === 'del') deletions.push(current);
          else additions.push(current);
          index += 1;
        }
        const height = Math.max(deletions.length, additions.length);
        for (let offset = 0; offset < height; offset += 1) {
          output.push({
            kind: 'pair',
            left: deletions[offset] || null,
            right: additions[offset] || null,
            pair: Boolean(deletions[offset] && additions[offset]),
          });
        }
      }
    }
    return output;
  }, [hunks]);

  return (
    <div className="split-diff">
      <div className="split-head">
        <span className="split-head-side">旧版本</span>
        <span className="split-head-side new">新版本</span>
      </div>
      {rows.map((row, index) => {
        if (row.kind === 'hunk') return <HunkHeader key={`h-${index}`} hunk={row.hunk} />;
        if (row.kind === 'context') {
          return (
            <div className="split-row context" key={`c-${index}`}>
              <div className="split-cell old context">
                <LineNumber value={row.line.oldLine} />
                <Sign type="context" />
                <CodeContent line={row.line} />
              </div>
              <div className="split-cell new context">
                <LineNumber value={row.line.newLine} />
                <Sign type="context" />
                <CodeContent line={row.line} />
              </div>
            </div>
          );
        }
        return (
          <SplitLine key={`p-${index}`} left={row.left} right={row.right} pair={row.pair} />
        );
      })}
    </div>
  );
}

function UnifiedDiff({ hunks }) {
  return (
    <div className="unified-diff">
      {hunks.map((hunk, hunkIndex) => (
        <div className="unified-hunk" key={hunkIndex}>
          <HunkHeader hunk={hunk} />
          {hunk.lines.map((line, index) => (
            <div className={cn('unified-row', line.type)} key={index}>
              <LineNumber value={line.oldLine} />
              <LineNumber value={line.newLine} />
              <Sign type={line.type} />
              <CodeContent line={line} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function DiffSkeleton() {
  const widths = [42, 68, 55, 76, 38, 62, 48, 71, 59, 33];
  return (
    <div className="diff-skeleton">
      {widths.map((width, index) => (
        <div
          className={cn('skeleton-diff-line', index === 2 || index === 6 ? 'accent' : '')}
          key={index}
        >
          <span className="skeleton-block line-num" />
          <span className="skeleton-block" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  );
}

function patchText(diff) {
  if (diff?.patch) return diff.patch;
  if (!diff) return '';
  const lines = [`--- a/${diff.oldPath || diff.path}`, `+++ b/${diff.newPath || diff.path}`];
  for (const hunk of diff.hunks || []) {
    lines.push(hunk.header);
    for (const line of hunk.lines) {
      lines.push(
        `${line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}${line.content}`,
      );
    }
  }
  return lines.join('\n');
}

export default function DiffViewer({
  diff,
  loading,
  error,
  layout = 'split',
  onLayoutChange,
  filePath,
  context,
  onToggleContext,
  actions,
  onRetry,
  className,
  metaLabel,
  emptyTitle,
  emptyDescription,
}) {
  const [copied, setCopied] = useState(false);
  const pathInfo = splitPath(diff?.path || filePath || '');
  const status = diff
    ? diff.status === 'unchanged'
      ? { label: '=', tone: 'modify', title: '无变化' }
      : statusMeta(
          diff.status === 'added'
            ? 'A'
            : diff.status === 'deleted'
              ? 'D'
              : diff.status === 'renamed'
                ? 'R'
                : 'M',
        )
    : null;
  const fullContext = context >= 1000;

  async function handleCopy() {
    const text = patchText(diff);
    if (!text) return;
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className={cn('diff-panel', className)}>
      <header className="diff-header">
        <div className="diff-identity">
          <span className="diff-file-icon">
            <FileDiff size={15} />
          </span>
          <div className="diff-path-block">
            <div className="diff-path" title={diff?.path || filePath}>
              <span className="diff-path-dir">{pathInfo.directory}</span>
              <span className="diff-path-name">{pathInfo.name || '选择文件'}</span>
            </div>
            <div className="diff-subline">
              {status && diff?.status ? (
                <span className={cn('file-status', status.tone)}>{status.title}</span>
              ) : null}
              {diff && !diff.binary ? (
                <span className="diff-stats">
                  <span className="stat-add">+{diff.additions || 0}</span>
                  <span className="stat-del">−{diff.deletions || 0}</span>
                </span>
              ) : null}
              {metaLabel ? <span className="diff-meta-label">{metaLabel}</span> : null}
            </div>
          </div>
        </div>

        <div className="diff-actions">
          {actions}
          {diff ? (
            <button
              className={cn('copy-patch-button', copied && 'copied')}
              onClick={handleCopy}
              title="复制原始 patch"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? '已复制' : 'Patch'}</span>
            </button>
          ) : null}
          {onToggleContext ? (
            <button
              className="icon-button diff-action"
              onClick={onToggleContext}
              title={fullContext ? '收起为 3 行上下文' : '展开完整上下文'}
              aria-label={fullContext ? '收起上下文' : '展开完整上下文'}
              disabled={!diff || diff.binary || diff.isEmpty}
            >
              {fullContext ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          ) : null}
          {onLayoutChange ? (
            <div className="layout-switch" role="group" aria-label="差异视图模式">
              <button
                className={cn(layout === 'split' && 'is-active')}
                onClick={() => onLayoutChange('split')}
                title="并排对比"
                disabled={!diff || diff.binary || diff.isEmpty}
              >
                <Columns2 size={14} />
              </button>
              <button
                className={cn(layout === 'unified' && 'is-active')}
                onClick={() => onLayoutChange('unified')}
                title="统一差异"
                disabled={!diff || diff.binary || diff.isEmpty}
              >
                <Rows3 size={14} />
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {diff && !diff.binary && !diff.isEmpty ? (
        <div className="diff-meta-bar">
          <span className="diff-rev old" title={diff.oldRev}>
            {diff.labels?.old || diff.oldRev || '旧版本'}
          </span>
          <ArrowRight size={12} className="diff-arrow" />
          <span className="diff-rev new" title={diff.newRev}>
            {diff.labels?.new || diff.newRev || '新版本'}
          </span>
          <span className="diff-mode-note">
            {diff.mode === 'worktree'
              ? '工作区对照 HEAD'
              : diff.mode === 'staged'
                ? '暂存区对照 HEAD'
                : diff.mode === 'unstaged'
                  ? '工作区对照暂存区'
                  : diff.mode === 'between'
                    ? '两个历史版本'
                    : diff.mode === 'commit-to-worktree'
                      ? '历史版本对照工作区'
                      : '提交内容'}
          </span>
        </div>
      ) : null}

      <div className="diff-scroll">
        {loading ? <DiffSkeleton /> : null}
        {!loading && error ? (
          <EmptyState
            className="diff-empty"
            icon={<FileWarning size={30} />}
            title="无法读取差异"
            description={error}
            action={
              onRetry ? (
                <button className="button ghost small" onClick={onRetry}>
                  重试
                </button>
              ) : null
            }
          />
        ) : null}
        {!loading && !error && !diff ? (
          <EmptyState
            className="diff-empty"
            icon={<FileDiff size={30} />}
            title={emptyTitle || '选择一个文件查看差异'}
            description={
              emptyDescription || '从左侧选择文件，在这里查看工作区、暂存区或历史版本之间的差异。'
            }
          />
        ) : null}
        {!loading && !error && diff?.binary ? (
          <EmptyState
            className="diff-empty"
            icon={<Binary size={30} />}
            title="二进制文件"
            description="这个文件是二进制内容，Git 无法以文本形式展示差异。"
          />
        ) : null}
        {!loading && !error && diff && !diff.binary && diff.isEmpty ? (
          <EmptyState
            className="diff-empty"
            icon={<Check size={30} />}
            title="没有可显示的差异"
            description="文件内容与所选版本一致，或该路径没有产生文本变化。"
          />
        ) : null}
        {!loading && !error && diff && !diff.binary && !diff.isEmpty ? (
          layout === 'split' ? (
            <SplitDiff hunks={diff.hunks} />
          ) : (
            <UnifiedDiff hunks={diff.hunks} />
          )
        ) : null}
      </div>
    </section>
  );
}
