import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Clock3,
  FileCode2,
  FileWarning,
  RotateCcw,
  Save,
} from 'lucide-react';
import { api } from '../api.js';
import { cn } from '../utils.js';
import { EmptyState, Spinner } from './common.jsx';

const LANGUAGE_LABELS = {
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  json: 'JSON',
  md: 'Markdown',
  mdx: 'MDX',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  vue: 'Vue',
  svelte: 'Svelte',
  py: 'Python',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  sh: 'Shell',
  yml: 'YAML',
  yaml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  sql: 'SQL',
};

function languageOf(name) {
  const extension = String(name || '').split('.').pop()?.toLowerCase();
  return LANGUAGE_LABELS[extension] || '纯文本';
}

function formatBytes(value) {
  const size = Number(value) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function draftStorageKey(repoId, path) {
  return `gitdeck.draft.${repoId}.${path}`;
}

function readDraft(repoId, path) {
  try {
    return sessionStorage.getItem(draftStorageKey(repoId, path));
  } catch {
    return null;
  }
}

function writeDraft(repoId, path, content) {
  try {
    sessionStorage.setItem(draftStorageKey(repoId, path), content);
  } catch {
    // Ignore storage restrictions.
  }
}

function clearDraft(repoId, path) {
  try {
    sessionStorage.removeItem(draftStorageKey(repoId, path));
  } catch {
    // Ignore storage restrictions.
  }
}

export default function FileEditorView({
  repo,
  path,
  onOpenFileHistory,
  onChanged,
  onDirtyChange,
  notify,
}) {
  const [file, setFile] = useState(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draftRestored, setDraftRestored] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const gutterRef = useRef(null);
  const textareaRef = useRef(null);
  const draftRef = useRef('');
  const dirtyRef = useRef(false);
  const fileRef = useRef(null);
  const draftTimer = useRef(null);

  const dirty = Boolean(file?.editable && draft !== file.content);
  const lineCount = useMemo(() => {
    if (!draft) return 1;
    return draft.split('\n').length;
  }, [draft]);
  const gutterText = useMemo(() => {
    const visible = Math.min(lineCount, 20000);
    const lines = [];
    for (let index = 1; index <= visible; index += 1) lines.push(String(index));
    if (lineCount > visible) lines.push('…');
    return lines.join('\n');
  }, [lineCount]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    fileRef.current = file;
  }, [file]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  useEffect(() => {
    if (!dirty) return undefined;
    function onBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!file?.editable) return undefined;
    if (draft === file.content) {
      clearDraft(repo.id, path);
      return undefined;
    }
    window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      writeDraft(repo.id, path, draft);
    }, 220);
    return () => window.clearTimeout(draftTimer.current);
  }, [draft, file?.content, file?.editable, path, repo.id]);

  useEffect(
    () => () => {
      if (dirtyRef.current && fileRef.current?.editable) {
        writeDraft(repo.id, path, draftRef.current);
      }
    },
    [path, repo.id],
  );

  useEffect(() => {
    if (!path) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setDraftRestored(false);
    setFile(null);

    api
      .readWorkingFile(repo.id, path, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setFile(data);
        const stored = readDraft(repo.id, path);
        if (data.editable && stored !== null && stored !== data.content) {
          setDraft(stored);
          setDraftRestored(true);
        } else {
          setDraft(data.content || '');
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [path, reloadToken, repo.id]);

  async function handleSave() {
    if (!file || !dirty || saving || !file.editable) return;
    setSaving(true);
    setError('');
    try {
      const result = await api.saveWorkingFile(repo.id, {
        path,
        content: draft,
        eol: file.eol,
        baseMtimeMs: file.mtimeMs,
      });
      setFile(result.file);
      setDraft(result.file.content || '');
      setDraftRestored(false);
      dirtyRef.current = false;
      clearDraft(repo.id, path);
      onDirtyChange?.(false);
      onChanged?.();
      notify?.({
        type: 'success',
        title: '文件已保存',
        message: path,
      });
      textareaRef.current?.focus();
    } catch (err) {
      setError(err.message);
      notify?.({
        type: 'error',
        title: '保存文件失败',
        message: err.message,
        detail: err.detail,
      });
    } finally {
      setSaving(false);
    }
  }

  function handleRevert() {
    if (!file) return;
    setDraft(file.content || '');
    setDraftRestored(false);
    setError('');
    dirtyRef.current = false;
    clearDraft(repo.id, path);
    onDirtyChange?.(false);
    textareaRef.current?.focus();
  }

  function handleReload() {
    clearDraft(repo.id, path);
    setReloadToken((value) => value + 1);
  }

  function handleEditorKeyDown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      handleSave();
      return;
    }
    if (event.key === 'Tab' && file?.editable) {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const next = `${draft.slice(0, start)}  ${draft.slice(end)}`;
      setDraft(next);
      requestAnimationFrame(() => {
        target.selectionStart = start + 2;
        target.selectionEnd = start + 2;
      });
    }
  }

  function syncGutter(event) {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = event.currentTarget.scrollTop;
    }
  }

  if (!path) {
    return (
      <EmptyState
        icon={<FileCode2 size={24} />}
        title="选择一个文件"
        description="从左侧文件目录选择文件，即可在这里查看和编辑。"
      />
    );
  }

  return (
    <section className="editor-view" aria-label="文件编辑器">
      <header className="editor-toolbar">
        <div className="editor-file-identity">
          <span className="editor-file-icon">
            <FileCode2 size={15} />
          </span>
          <div>
            <div className="editor-file-path" title={path}>
              <span className="editor-dir">{path.slice(0, Math.max(0, path.length - (path.split('/').pop() || '').length))}</span>
              <strong>{path.split('/').pop()}</strong>
            </div>
            <div className="editor-file-sub">
              {file ? (
                <>
                  <span>{languageOf(file.name)}</span>
                  <span className="meta-dot" />
                  <span>{formatBytes(file.size)}</span>
                  <span className="meta-dot" />
                  <span>{file.eol === '\r\n' ? 'CRLF' : 'LF'}</span>
                  {file.editable ? null : (
                    <>
                      <span className="meta-dot" />
                      <span className="editor-readonly-label">只读</span>
                    </>
                  )}
                </>
              ) : (
                <span>正在读取文件…</span>
              )}
            </div>
          </div>
          {dirty ? (
            <span className="editor-dirty-badge">
              <span />
              未保存
            </span>
          ) : null}
        </div>

        <div className="editor-actions">
          <button
            className="button ghost small"
            onClick={() => onOpenFileHistory?.(path)}
            title="查看该文件的提交历史"
          >
            <Clock3 size={13} />
            文件历史
          </button>
          <button
            className="button ghost small"
            onClick={handleRevert}
            disabled={!dirty || saving}
            title="放弃未保存的修改"
          >
            <RotateCcw size={13} />
            撤销
          </button>
          <button
            className="button primary small"
            onClick={handleSave}
            disabled={!dirty || saving || !file?.editable}
            title="保存文件（Ctrl/Cmd+S）"
          >
            {saving ? <Spinner size={13} /> : <Save size={13} />}
            保存
          </button>
        </div>
      </header>

      {draftRestored ? (
        <div className="editor-banner is-info">
          <Check size={14} />
          <span>已恢复上次未保存的草稿。</span>
          <button className="button ghost small" onClick={handleRevert}>
            放弃草稿
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="editor-banner is-error">
          <AlertCircle size={14} />
          <span>{error}</span>
          <button className="button ghost small" onClick={handleReload}>
            重新读取
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="editor-loading">
          <Spinner size={18} />
          正在读取文件…
        </div>
      ) : null}

      {!loading && file && !file.editable ? (
        <div className="editor-uneditable">
          <EmptyState
            icon={<FileWarning size={24} />}
            title={file.binary ? '二进制文件' : '文件过大'}
            description={
              file.binary
                ? '该文件包含二进制内容，GitDeck 暂不支持编辑。'
                : `文件超过 ${formatBytes(file.maxBytes)}，仅显示前 ${formatBytes(
                    Math.min(file.size, file.maxBytes),
                  )}，不能直接编辑。`
            }
            action={
              file.truncated && file.content ? (
                <button className="button ghost small" onClick={handleReload}>
                  重新读取
                </button>
              ) : null
            }
          />
          {file.truncated && file.content ? (
            <pre className="editor-readonly-preview">{file.content}</pre>
          ) : null}
        </div>
      ) : null}

      {!loading && file?.editable ? (
        <div className={cn('editor-shell', dirty && 'is-dirty')}>
          <div className="editor-gutter" ref={gutterRef} aria-hidden="true">
            <pre>{gutterText}</pre>
          </div>
          <textarea
            ref={textareaRef}
            className="editor-textarea"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onScroll={syncGutter}
            onKeyDown={handleEditorKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            aria-label={`编辑 ${path}`}
          />
        </div>
      ) : null}

      <footer className="editor-footer">
        <span>
          <span className={cn('editor-dot', dirty && 'is-dirty')} />
          {dirty ? '有未保存的修改' : '已与磁盘同步'}
        </span>
        <span className="editor-shortcut">
          <kbd>Ctrl</kbd>
          <span>+</span>
          <kbd>S</kbd>
          <span>保存</span>
        </span>
      </footer>
    </section>
  );
}
