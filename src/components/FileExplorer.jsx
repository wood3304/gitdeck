import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderTree,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';
import { api } from '../api.js';
import { cn } from '../utils.js';
import { Spinner } from './common.jsx';

function fileIcon(name) {
  const extension = name.split('.').pop()?.toLowerCase();
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte'].includes(extension)) {
    return FileCode2;
  }
  if (extension === 'json') return FileJson;
  if (['md', 'mdx', 'txt', 'log'].includes(extension)) return FileText;
  return File;
}

function ancestorsOf(filePath) {
  const parts = String(filePath || '').split('/');
  const ancestors = [];
  for (let index = 1; index < parts.length; index += 1) {
    ancestors.push(parts.slice(0, index).join('/'));
  }
  return ancestors;
}

function TreeNode({
  node,
  depth,
  expanded,
  selectedPath,
  onToggle,
  onOpenFile,
  onOpenFileHistory,
}) {
  const isDirectory = node.type === 'dir';
  const open = expanded.has(node.path);
  const selected = !isDirectory && selectedPath === node.path;
  const Icon = isDirectory
    ? open
      ? FolderOpen
      : Folder
    : fileIcon(node.name);

  return (
    <>
      <div
        className={cn(
          'file-tree-row',
          isDirectory && 'is-dir',
          selected && 'is-selected',
        )}
        style={{ '--tree-depth': depth }}
        role="button"
        tabIndex={0}
        title={node.path}
        onClick={() => {
          if (isDirectory) onToggle(node.path);
          else onOpenFile(node.path);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (isDirectory) onToggle(node.path);
            else onOpenFile(node.path);
          }
        }}
      >
        <span className={cn('tree-chevron', open && 'is-open')}>
          {isDirectory ? (
            open ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )
          ) : null}
        </span>
        <span className={cn('tree-icon', isDirectory && 'folder')}>
          <Icon size={14} />
        </span>
        <span className="tree-name">{node.name}</span>
        {!isDirectory ? (
          <button
            className="tree-history-button"
            title="查看文件历史"
            aria-label={`查看 ${node.name} 的文件历史`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenFileHistory(node.path);
            }}
          >
            <Clock3 size={12} />
          </button>
        ) : null}
      </div>
      {isDirectory && open
        ? node.children.map((child) => (
            <TreeNode
              key={`${child.type}:${child.path}`}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              onOpenFileHistory={onOpenFileHistory}
            />
          ))
        : null}
    </>
  );
}

export default function FileExplorer({
  repo,
  selectedPath,
  refreshKey,
  onOpenFile,
  onOpenFileHistory,
}) {
  const [tree, setTree] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const [filter, setFilter] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const initializedRepo = useRef(null);

  useEffect(() => {
    setExpanded(new Set());
    setFilter('');
    setTree([]);
    setFiles([]);
    initializedRepo.current = null;
  }, [repo?.id]);

  useEffect(() => {
    if (!repo?.ok) {
      setTree([]);
      setFiles([]);
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api
      .tree(repo.id, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        const nextTree = data.tree || [];
        setTree(nextTree);
        setFiles(data.files || []);
        setExpanded((previous) => {
          if (initializedRepo.current === repo.id) return previous;
          initializedRepo.current = repo.id;
          const initial = new Set();
          for (const node of nextTree) {
            if (node.type === 'dir') initial.add(node.path);
          }
          for (const ancestor of ancestorsOf(selectedPath)) initial.add(ancestor);
          return initial;
        });
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [repo?.id, repo?.ok, refreshKey, refreshToken]);

  useEffect(() => {
    if (!selectedPath) return;
    const ancestors = ancestorsOf(selectedPath);
    if (!ancestors.length) return;
    setExpanded((previous) => {
      let changed = false;
      const next = new Set(previous);
      for (const ancestor of ancestors) {
        if (!next.has(ancestor)) {
          next.add(ancestor);
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [selectedPath]);

  const filteredFiles = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return [];
    return files.filter((file) => file.toLowerCase().includes(needle)).slice(0, 250);
  }, [files, filter]);

  function toggleDirectory(path) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <section className="file-explorer" aria-label="文件目录">
      <header className="file-explorer-head">
        <div className="file-explorer-title">
          <FolderTree size={14} />
          <span>文件</span>
          <span className="file-explorer-count">{files.length}</span>
        </div>
        <button
          className="icon-button explorer-refresh"
          onClick={() => setRefreshToken((value) => value + 1)}
          title="刷新文件目录"
          aria-label="刷新文件目录"
        >
          <RefreshCw size={13} />
        </button>
      </header>

      <div className="file-explorer-repo" title={repo?.path}>
        <FolderGit2 size={12} />
        <span>{repo?.name || '未选择代码库'}</span>
      </div>

      <div className="explorer-filter">
        <Search size={12} />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="筛选文件…"
          aria-label="筛选文件"
          spellCheck={false}
        />
        {filter ? (
          <button
            className="explorer-filter-clear"
            onClick={() => setFilter('')}
            aria-label="清除筛选"
          >
            <X size={11} />
          </button>
        ) : null}
      </div>

      <div className="file-tree-scroll">
        {loading ? (
          <div className="explorer-state">
            <Spinner size={15} />
            正在读取文件目录…
          </div>
        ) : null}

        {!loading && error ? (
          <div className="explorer-state is-error">
            <TriangleAlert size={15} />
            <span>{error}</span>
            <button
              className="button ghost small"
              onClick={() => setRefreshToken((value) => value + 1)}
            >
              重试
            </button>
          </div>
        ) : null}

        {!loading && !error && filter ? (
          <div className="file-filter-results">
            {filteredFiles.length === 0 ? (
              <div className="explorer-state">没有匹配的文件</div>
            ) : (
              filteredFiles.map((file) => {
                const name = file.split('/').pop();
                const Icon = fileIcon(name);
                return (
                  <div
                    key={file}
                    className={cn('file-tree-row is-filtered', selectedPath === file && 'is-selected')}
                    title={file}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenFile(file)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') onOpenFile(file);
                    }}
                  >
                    <span className="tree-chevron" />
                    <span className="tree-icon">
                      <Icon size={14} />
                    </span>
                    <span className="tree-name">
                      <span className="filter-dir">{file.slice(0, Math.max(0, file.length - name.length))}</span>
                      {name}
                    </span>
                    <button
                      className="tree-history-button"
                      title="查看文件历史"
                      aria-label={`查看 ${name} 的文件历史`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenFileHistory(file);
                      }}
                    >
                      <Clock3 size={12} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        ) : null}

        {!loading && !error && !filter && tree.length === 0 ? (
          <div className="explorer-state">这个代码库暂时没有可显示的文件</div>
        ) : null}

        {!loading && !error && !filter
          ? tree.map((node) => (
              <TreeNode
                key={`${node.type}:${node.path}`}
                node={node}
                depth={0}
                expanded={expanded}
                selectedPath={selectedPath}
                onToggle={toggleDirectory}
                onOpenFile={onOpenFile}
                onOpenFileHistory={onOpenFileHistory}
              />
            ))
          : null}
      </div>
    </section>
  );
}
