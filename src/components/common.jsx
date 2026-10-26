import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Info,
  LoaderCircle,
  TriangleAlert,
  X,
  XCircle,
} from 'lucide-react';
import { cn, copyText } from '../utils.js';

export function Kbd({ children, className }) {
  return <kbd className={cn('kbd', className)}>{children}</kbd>;
}

export function Spinner({ size = 16, className }) {
  return <LoaderCircle size={size} className={cn('spin', className)} aria-hidden="true" />;
}

export function Modal({
  open,
  onClose,
  children,
  className,
  width,
  closeOnBackdrop = true,
  ariaLabel,
}) {
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        className={cn('modal-card', className)}
        style={width ? { width } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalHeader({ eyebrow, title, description, onClose, icon }) {
  return (
    <header className="modal-head">
      <div className="modal-head-copy">
        {icon ? <div className="modal-icon">{icon}</div> : null}
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
          {description ? <p className="modal-description">{description}</p> : null}
        </div>
      </div>
      <button className="icon-button" onClick={onClose} aria-label="关闭">
        <X size={17} />
      </button>
    </header>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  detail,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  loading = false,
  onConfirm,
  onClose,
}) {
  return (
    <Modal open={open} onClose={onClose} className="confirm-card" ariaLabel={title}>
      <div className={cn('confirm-signal', danger ? 'danger' : 'neutral')}>
        {danger ? <TriangleAlert size={22} /> : <Info size={22} />}
      </div>
      <h2>{title}</h2>
      <p className="confirm-description">{description}</p>
      {detail ? <pre className="confirm-detail">{detail}</pre> : null}
      <div className="modal-actions">
        <button className="button ghost" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </button>
        <button
          className={cn('button', danger ? 'danger' : 'primary')}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? <Spinner size={15} /> : null}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

const toastIcons = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertCircle,
  info: Info,
};

export function Toasts({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return createPortal(
    <div className="toast-stack" role="region" aria-label="通知">
      {toasts.map((toast) => {
        const Icon = toastIcons[toast.type] || Info;
        return (
          <div key={toast.id} className={cn('toast', `toast-${toast.type}`)}>
            <div className="toast-icon">
              <Icon size={17} />
            </div>
            <div className="toast-copy">
              <strong>{toast.title}</strong>
              {toast.message ? <p>{toast.message}</p> : null}
              {toast.detail ? (
                <details>
                  <summary>查看详情</summary>
                  <pre>{toast.detail}</pre>
                </details>
              ) : null}
            </div>
            <button
              className="toast-close"
              onClick={() => onDismiss(toast.id)}
              aria-label="关闭通知"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

export function CopyButton({ value, label = '复制', className, onCopied }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  async function handleCopy(event) {
    event.stopPropagation();
    const ok = await copyText(value);
    if (!ok) return;
    setCopied(true);
    onCopied?.();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }
  return (
    <button
      className={cn('copy-button', className, copied && 'copied')}
      onClick={handleCopy}
      title={copied ? '已复制' : label}
      aria-label={label}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {label ? <span>{copied ? '已复制' : label}</span> : null}
    </button>
  );
}

export function EmptyState({ icon, title, description, action, className, compact = false }) {
  return (
    <div className={cn('empty-state', compact && 'compact', className)}>
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = 'neutral', className, dot = false }) {
  return (
    <span className={cn('badge', `badge-${tone}`, className)}>
      {dot ? <span className="badge-dot" /> : null}
      {children}
    </span>
  );
}

export function SectionLabel({ children, trailing, className }) {
  return (
    <div className={cn('section-label', className)}>
      <span>{children}</span>
      {trailing}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = '搜索',
  shortcut,
  autoFocus = false,
  className,
  onKeyDown,
  inputRef,
}) {
  return (
    <label className={cn('search-input', className)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
        <path d="m16.5 16.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
      {value ? (
        <button
          type="button"
          className="search-clear"
          onClick={() => onChange('')}
          aria-label="清空搜索"
        >
          <X size={12} />
        </button>
      ) : shortcut ? (
        <Kbd>{shortcut}</Kbd>
      ) : null}
    </label>
  );
}

export function DropdownChevron({ open }) {
  return <ChevronDown size={13} className={cn('dropdown-chevron', open && 'is-open')} />;
}
