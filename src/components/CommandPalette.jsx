import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  CornerDownLeft,
  FileClock,
  FileDiff,
  GitBranch,
  History,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Sun,
} from 'lucide-react';
import { cn, repoAccent } from '../utils.js';
import { Kbd } from './common.jsx';

export default function CommandPalette({
  open,
  onClose,
  repos,
  activeId,
  onSelectRepo,
  onNavigate,
  onAddRepo,
  onRefresh,
  onToggleTheme,
  theme,
}) {
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onEscape(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open, onClose]);

  const commands = useMemo(() => {
    const list = [];
    for (const repo of repos) {
      list.push({
        id: `repo-${repo.id}`,
        group: '切换代码库',
        label: repo.name,
        meta: `${repo.branchName || repo.branch} · ${repo.path}`,
        icon: GitBranch,
        accent: repoAccent(repo.path)['--repo-color'],
        keywords: `${repo.name} ${repo.path} ${repo.branchName || ''}`.toLowerCase(),
        run: () => onSelectRepo(repo.id),
      });
    }
    list.push(
      {
        id: 'tab-changes',
        group: '导航',
        label: '本地更改',
        meta: '查看工作区状态与未提交差异',
        icon: FileDiff,
        keywords: '更改 工作区 changes diff',
        run: () => onNavigate('changes'),
      },
      {
        id: 'tab-history',
        group: '导航',
        label: '提交历史',
        meta: '浏览提交记录与逐文件差异',
        icon: History,
        keywords: '历史 提交 history log commit',
        run: () => onNavigate('history'),
      },
      {
        id: 'tab-file',
        group: '导航',
        label: '文件历史',
        meta: '追踪一个文件的版本变化',
        icon: FileClock,
        keywords: '文件 历史 file history version',
        run: () => onNavigate('file'),
      },
      {
        id: 'action-add',
        group: '操作',
        label: '打开本地代码库',
        meta: '添加另一个 Git 仓库到工作台',
        icon: Plus,
        keywords: '添加 打开 仓库 add open repo',
        run: onAddRepo,
      },
      {
        id: 'action-refresh',
        group: '操作',
        label: '刷新当前代码库',
        meta: '重新读取状态、分支与提交',
        icon: RefreshCw,
        keywords: '刷新 refresh reload',
        run: onRefresh,
      },
      {
        id: 'action-theme',
        group: '操作',
        label: theme === 'dark' ? '切换到浅色主题' : '切换到深色主题',
        meta: '更改工作台外观',
        icon: theme === 'dark' ? Sun : Moon,
        keywords: '主题 深色 浅色 theme dark light',
        run: onToggleTheme,
      },
    );
    return list;
  }, [repos, theme, onSelectRepo, onNavigate, onAddRepo, onRefresh, onToggleTheme]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.meta} ${command.keywords}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    setCursor((value) => Math.min(value, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return undefined;
    const active = listRef.current?.querySelector('.command-row.is-active');
    active?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  function execute(command) {
    if (!command) return;
    onClose();
    command.run();
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((value) => (filtered.length ? (value + 1) % filtered.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((value) =>
        filtered.length ? (value - 1 + filtered.length) % filtered.length : 0,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      execute(filtered[cursor]);
    } else if (event.key === 'Escape') {
      onClose();
    }
  }

  if (!open) return null;

  let lastGroup = '';
  return createPortal(
    <div
      className="palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="快速查找">
        <div className="palette-input-row">
          <Search size={19} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="搜索代码库、跳转视图或执行操作…"
            spellCheck={false}
          />
          <Kbd>ESC</Kbd>
        </div>
        <div className="command-results" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="command-empty">
              <Search size={22} />
              <strong>没有匹配的结果</strong>
              <span>尝试搜索代码库名称或“文件历史”</span>
            </div>
          ) : null}
          {filtered.map((command, index) => {
            const Icon = command.icon;
            const showGroup = command.group !== lastGroup;
            lastGroup = command.group;
            return (
              <div key={command.id}>
                {showGroup ? <p className="command-group">{command.group}</p> : null}
                <button
                  className={cn(
                    'command-row',
                    index === cursor && 'is-active',
                    command.id === `repo-${activeId}` && 'is-current',
                  )}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => execute(command)}
                >
                  <span
                    className="command-icon"
                    style={command.accent ? { color: command.accent } : undefined}
                  >
                    <Icon size={16} />
                  </span>
                  <span className="command-copy">
                    <strong>{command.label}</strong>
                    <span>{command.meta}</span>
                  </span>
                  {command.id === `repo-${activeId}` ? (
                    <span className="command-current">当前</span>
                  ) : null}
                  {index === cursor ? <CornerDownLeft size={14} className="command-enter" /> : null}
                </button>
              </div>
            );
          })}
        </div>
        <footer className="palette-footer">
          <span>
            <Kbd>
              <ArrowUp size={11} />
            </Kbd>
            <Kbd>
              <ArrowDown size={11} />
            </Kbd>
            导航
          </span>
          <span>
            <Kbd>
              <CornerDownLeft size={11} />
            </Kbd>
            执行
          </span>
          <span className="palette-hint">共 {filtered.length} 个结果</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
