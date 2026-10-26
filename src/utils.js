import { useEffect, useRef, useState } from 'react';

export function cn(...values) {
  return values.filter(Boolean).join(' ');
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const dayFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const monthDayFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
});

export function parseDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value) {
  const date = parseDate(value);
  return date ? dateFormatter.format(date) : '—';
}

export function formatDay(value) {
  const date = parseDate(value);
  return date ? dayFormatter.format(date) : '—';
}

export function relativeTime(value) {
  const date = parseDate(value);
  if (!date) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return '刚刚';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} 分钟前`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时前`;
  if (seconds < 86400 * 7) return `${Math.round(seconds / 86400)} 天前`;
  if (date.getFullYear() === new Date().getFullYear()) return monthDayFormatter.format(date);
  return dayFormatter.format(date);
}

export function relativeOrDate(value) {
  const date = parseDate(value);
  if (!date) return '—';
  const days = Math.abs(Date.now() - date.getTime()) / 86400000;
  return days < 7 ? relativeTime(date) : formatDay(date);
}

export function timeAgoShort(value) {
  const date = parseDate(value);
  if (!date) return '';
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortHash(hash = '', length = 7) {
  return String(hash).slice(0, length);
}

export function splitPath(filePath = '') {
  const normalized = String(filePath).replaceAll('\\', '/');
  const index = normalized.lastIndexOf('/');
  if (index < 0) return { directory: '', name: normalized };
  return {
    directory: normalized.slice(0, index + 1),
    name: normalized.slice(index + 1),
  };
}

export function fileExtension(filePath = '') {
  const name = splitPath(filePath).name;
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase();
}

export function getInitial(name = '') {
  const trimmed = String(name).trim();
  if (!trimmed) return '?';
  const first = Array.from(trimmed)[0];
  return first.toUpperCase();
}

export function hashHue(value = '') {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

export function repoAccent(value = '') {
  const hue = hashHue(value);
  return {
    '--repo-hue': hue,
    '--repo-color': `hsl(${hue} 72% 67%)`,
    '--repo-color-soft': `hsla(${hue}, 72%, 67%, .14)`,
    '--repo-color-line': `hsla(${hue}, 72%, 67%, .28)`,
  };
}

export function statusMeta(code) {
  switch (code) {
    case 'A':
      return { label: 'A', tone: 'add', title: '新增' };
    case 'M':
      return { label: 'M', tone: 'modify', title: '修改' };
    case 'D':
      return { label: 'D', tone: 'delete', title: '删除' };
    case 'R':
      return { label: 'R', tone: 'rename', title: '重命名' };
    case 'C':
      return { label: 'C', tone: 'copy', title: '复制' };
    case 'U':
      return { label: 'U', tone: 'conflict', title: '冲突' };
    case '?':
      return { label: '?', tone: 'untracked', title: '未跟踪' };
    case 'T':
      return { label: 'T', tone: 'modify', title: '类型变更' };
    default:
      return { label: code || 'M', tone: 'modify', title: '变更' };
  }
}

export function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useOutsideClick(ref, handler, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    function onPointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) handler(event);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [ref, handler, active]);
}

export function usePrevious(value) {
  const ref = useRef();
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

export async function copyText(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the selection-based fallback.
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    document.body.removeChild(textarea);
    return false;
  }
}

export function refTone(kind) {
  return `ref-${kind || 'branch'}`;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
