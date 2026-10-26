import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  CloudUpload,
  Copy,
  FileClock,
  FileCode2,
  FileDiff,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  History,
  MoreHorizontal,
  Moon,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sun,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { api } from '../api.js';
import {
  cn,
  relativeTime,
  repoAccent,
  shortHash,
  useOutsideClick,
} from '../utils.js';
import {
  CopyButton,
  Kbd,
  Modal,
  ModalHeader,
  Spinner,
} from './common.jsx';
import BranchMenu from './BranchMenu.jsx';

export function BrandMark({ size = 32 }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }}>
      <img src="/logo.svg" alt="" draggable="false" />
      <span className="brand-mark-glow" />
    </span>
  );
}

export function TopBar({ activeRepo, theme, onToggleTheme, onOpenPalette, repoCount }) {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <BrandMark size={28} />
        <div className="brand-copy">
          <strong>GitDeck</strong>
        </div>
      </div>
      <div className="topbar-context">
        {activeRepo ? (
          <div className="breadcrumb">
            <span className="breadcrumb-muted">代码库</span>
            <ChevronRight size={12} />
            <span className="breadcrumb-current">{activeRepo.name}</span>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-branch">
              <GitBranch size={11} />
              {activeRepo.branchName || activeRepo.branch}
            </span>
          </div>
        ) : (
          <span className="breadcrumb-muted">选择一个代码库开始工作</span>
        )}
      </div>
      <div className="topbar-actions">
        <button className="command-trigger" onClick={onOpenPalette}>
          <Search size={14} />
          <span>快速查找</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        <button
          className="icon-button topbar-icon"
          onClick={onToggleTheme}
          title={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
          aria-label="切换主题"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}

function RepoMoreMenu({ repo, onClose, onReveal, onRemove }) {
  const ref = useRef(null);
  useOutsideClick(ref, onClose);
  return (
    <div className="header-popover repo-more-popover" ref={ref}>
      <button
        className="menu-item"
        onClick={() => {
          onReveal(repo);
          onClose();
        }}
      >
        <FolderOpen size={14} />
        在文件管理器中打开
      </button>
      <button
        className="menu-item"
        onClick={async () => {
          await navigator.clipboard?.writeText(repo.path).catch(() => {});
          onClose();
        }}
      >
        <Copy size={14} />
        复制仓库路径
      </button>
      <div className="menu-divider" />
      <button
        className="menu-item danger"
        onClick={() => {
          onRemove(repo);
          onClose();
        }}
      >
        <Trash2 size={14} />
        从工作台移除
      </button>
    </div>
  );
}

export function RepoHeader({
  repo,
  refreshing,
  onRefresh,
  onReveal,
  onRemove,
  onChanged,
  notify,
}) {
  const [branchOpen, setBranchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [pushRemote, setPushRemote] = useState('origin');
  const [pushError, setPushError] = useState('');
  const branchRef = useRef(null);
  const remotes = repo.remotes || [];

  useEffect(() => {
    setBranchOpen(false);
    setMoreOpen(false);
    setPushOpen(false);
    setPushError('');
  }, [repo.id]);

  async function performPush(remoteName = '', setUpstream = false) {
    if (pushing) return;
    setPushing(true);
    setPushError('');
    try {
      const result = await api.push(repo.id, {
        remote: remoteName || undefined,
        setUpstream,
      });
      const lines = String(result.output || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const meaningful = lines.filter(
        (line) =>
          /(->|new branch|Everything up-to-date|deleted)/i.test(line) &&
          !/^Done$/i.test(line),
      );
      const summary = (meaningful.length ? meaningful : lines.filter((line) => !/^Done$/i.test(line)))
        .slice(-2)
        .join(' · ');
      const target = `${result.remote || remoteName}/${result.branch || repo.branchName}`;
      notify({
        type: 'success',
        title: setUpstream ? '分支已发布' : '推送成功',
        message: summary || target,
      });
      setPushOpen(false);
      onChanged?.();
    } catch (error) {
      setPushError(error.message);
      notify({
        type: 'error',
        title: '推送失败',
        message: error.message,
        detail: error.detail,
      });
    } finally {
      setPushing(false);
    }
  }

  function handlePush() {
    if (!repo.ok) return;
    if (repo.detached) {
      notify({
        type: 'warning',
        title: '无法推送 detached HEAD',
        message: '请先切换到一个本地分支。',
      });
      return;
    }
    if (!repo.hasCommits) {
      notify({ type: 'warning', title: '当前分支还没有提交' });
      return;
    }
    if (!remotes.length) {
      notify({
        type: 'error',
        title: '未配置远程仓库',
        message: '请先在终端执行 git remote add origin <url>，然后刷新仓库。',
      });
      return;
    }
    if (repo.upstream) {
      performPush('', false);
      return;
    }
    const preferred =
      remotes.find((remote) => remote.name === 'origin')?.name || remotes[0].name;
    setPushRemote(preferred);
    setPushError('');
    setPushOpen(true);
  }

  const canPush = remotes.length > 0;

  async function handlePull() {
    if (pulling) return;
    if (!repo.upstream) {
      notify({
        type: 'warning',
        title: '当前分支没有上游分支',
        message: '请先使用「发布分支」推送并设置上游，然后刷新仓库。',
      });
      return;
    }
    setPulling(true);
    try {
      const result = await api.pull(repo.id);
      const lines = String(result.output || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const upToDate = lines.some((line) => /Already up.to.date/i.test(line));
      const summary = lines.filter((line) => !/Already up.to.date/i.test(line)).slice(-2).join(' · ');
      notify({
        type: 'success',
        title: upToDate ? '已经是最新' : '拉取成功',
        message: summary || `${result.upstream || repo.upstream} · ${result.branch || repo.branchName}`,
      });
      onChanged?.();
    } catch (error) {
      notify({
        type: 'error',
        title: '拉取失败',
        message: error.message,
        detail: error.detail,
      });
    } finally {
      setPulling(false);
    }
  }

  async function handleFetch() {
    if (fetching) return;
    setFetching(true);
    try {
      const result = await api.fetch(repo.id);
      const output = String(result.output || '')
        .split('\n')
        .filter(Boolean)
        .slice(0, 2)
        .join(' · ');
      notify({
        type: 'success',
        title: '已获取远程更新',
        message: output || '本地仓库已与远程同步',
      });
      onChanged?.();
    } catch (error) {
      notify({
        type: 'error',
        title: '获取远程更新失败',
        message: error.message,
        detail: error.detail,
      });
    } finally {
      setFetching(false);
    }
  }

  return (
    <>
      <header className="repo-header" style={repoAccent(repo.path)}>
      <div className="repo-identity">
        <div className="repo-hero-icon">
          <GitBranch size={19} />
        </div>
        <div className="repo-identity-copy">
          <div className="repo-title-row">
            <h1>{repo.name}</h1>
            {repo.detached ? <span className="mini-badge">DETACHED</span> : null}
            {repo.counts?.total > 0 ? (
              <span className="dirty-pill">
                <span className="dirty-dot" />
                {repo.counts.total} 个更改
              </span>
            ) : (
              <span className="clean-pill">
                <Check size={10} />
                已同步
              </span>
            )}
          </div>
          <div className="repo-path-row">
            <span className="repo-path" title={repo.path}>
              {repo.path}
            </span>
            <CopyButton value={repo.path} label="" className="mini-copy" />
            {repo.remote ? (
              <>
                <span className="meta-dot" />
                <span className="repo-remote" title={repo.remote}>
                  {repo.remote.replace(/^https?:\/\//, '')}
                </span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="repo-header-actions">
        <div className="branch-control" ref={branchRef}>
          <button
            className={cn('branch-button', branchOpen && 'is-open')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              setBranchOpen((value) => !value);
              setMoreOpen(false);
            }}
            disabled={!repo.ok}
          >
            <GitBranch size={14} />
            <span>{repo.branchName || repo.branch}</span>
            {repo.ahead > 0 ? (
              <span className="branch-ahead">
                <ArrowUp size={9} />
                {repo.ahead}
              </span>
            ) : null}
            {repo.behind > 0 ? (
              <span className="branch-behind">
                <ArrowDown size={9} />
                {repo.behind}
              </span>
            ) : null}
            <ChevronDown size={13} className={cn('chevron', branchOpen && 'rotate')} />
          </button>
          <BranchMenu
            open={branchOpen}
            repo={repo}
            onClose={() => setBranchOpen(false)}
            onChanged={onChanged}
            notify={notify}
          />
        </div>

        <button
          className={cn(
            'pull-button',
            repo.behind > 0 && 'has-behind',
          )}
          onClick={handlePull}
          disabled={
            pulling ||
            pushing ||
            fetching ||
            !repo.ok ||
            repo.detached ||
            !repo.hasCommits ||
            !repo.upstream
          }
          title={
            repo.upstream
              ? `从 ${repo.upstream} 拉取（仅快进）`
              : '当前分支没有上游分支，暂时无法拉取'
          }
        >
          {pulling ? <Spinner size={14} /> : <ArrowDownToLine size={14} />}
          <span>拉取</span>
          {repo.behind > 0 ? <span className="pull-count">{repo.behind}</span> : null}
        </button>

        <button
          className={cn(
            'push-button',
            repo.upstream ? 'has-upstream' : canPush && 'is-publish',
            repo.ahead > 0 && 'has-ahead',
            !canPush && 'is-unavailable',
          )}
          onClick={handlePush}
          disabled={
            pushing ||
            pulling ||
            fetching ||
            !repo.ok ||
            repo.detached ||
            !repo.hasCommits ||
            !canPush
          }
          title={
            !canPush
              ? '未配置远程仓库，请先用 git remote add 添加'
              : repo.upstream
                ? `推送 ${repo.branchName} 到 ${repo.upstream}`
                : '当前分支还没有上游分支，点击发布'
          }
        >
          {pushing ? <Spinner size={14} /> : <CloudUpload size={14} />}
          <span>{repo.upstream || !canPush ? '推送' : '发布分支'}</span>
          {repo.upstream && repo.ahead > 0 ? (
            <span className="push-count">{repo.ahead}</span>
          ) : repo.upstream ? null : canPush ? (
            <span className="push-count">NEW</span>
          ) : null}
        </button>

        <div className="header-divider" />

        <button
          className="icon-button action-icon"
          onClick={onRefresh}
          disabled={refreshing}
          title="刷新状态"
          aria-label="刷新状态"
        >
          {refreshing ? <Spinner size={15} /> : <RefreshCw size={15} />}
        </button>
        <button
          className="icon-button action-icon"
          onClick={handleFetch}
          disabled={fetching || pulling || pushing || !repo.ok}
          title="获取远程更新（git fetch --all --prune）"
          aria-label="获取远程更新"
        >
          {fetching ? <Spinner size={15} /> : <CloudDownload size={15} />}
        </button>
        <div className="more-wrap">
          <button
            className="icon-button action-icon"
            onClick={() => {
              setMoreOpen((value) => !value);
              setBranchOpen(false);
            }}
            title="更多操作"
            aria-label="更多操作"
          >
            <MoreHorizontal size={16} />
          </button>
          {moreOpen ? (
            <RepoMoreMenu
              repo={repo}
              onClose={() => setMoreOpen(false)}
              onReveal={onReveal}
              onRemove={onRemove}
            />
          ) : null}
        </div>
      </div>
      </header>

      <Modal
        open={pushOpen}
        onClose={() => {
          if (!pushing) setPushOpen(false);
        }}
        className="push-modal"
        ariaLabel="发布当前分支"
      >
        <ModalHeader
          eyebrow="PUSH BRANCH"
          title="发布当前分支"
          description={`${repo.branchName} 还没有上游分支。选择远程仓库后，将它推送并设置为跟踪分支。`}
          onClose={() => {
            if (!pushing) setPushOpen(false);
          }}
          icon={<CloudUpload size={19} />}
        />
        <div className="push-modal-body">
          <div className="push-target">
            <div className="push-target-side">
              <span>本地分支</span>
              <code>{repo.branchName}</code>
            </div>
            <ArrowRight size={16} className="push-target-arrow" />
            <div className="push-target-side target-remote">
              <span>发布到</span>
              <code>
                {pushRemote}/{repo.branchName}
              </code>
            </div>
          </div>

          <p className="push-section-label">远程仓库</p>
          <div className="remote-options">
            {remotes.map((remote) => (
              <button
                key={remote.name}
                className={cn(
                  'remote-option',
                  pushRemote === remote.name && 'is-active',
                )}
                onClick={() => setPushRemote(remote.name)}
                disabled={pushing}
              >
                <span className="remote-radio">
                  {pushRemote === remote.name ? <Check size={10} /> : null}
                </span>
                <span className="remote-option-icon">
                  <Server size={15} />
                </span>
                <span className="remote-option-copy">
                  <strong>{remote.name}</strong>
                  <code title={remote.url}>{remote.url}</code>
                </span>
              </button>
            ))}
          </div>

          {pushError ? (
            <div className="push-error">
              <TriangleAlert size={15} />
              <span>{pushError}</span>
            </div>
          ) : null}

          <p className="push-note">
            首次推送会自动执行 <code>git push --set-upstream</code>。之后可以直接点击“推送”。
          </p>
        </div>
        <footer className="push-footer">
          <span className="push-auth-note">
            <ShieldCheck size={13} />
            认证由系统 Git 凭据管理器处理
          </span>
          <div className="modal-actions inline">
            <button
              className="button ghost small"
              onClick={() => setPushOpen(false)}
              disabled={pushing}
            >
              取消
            </button>
            <button
              className="button primary small"
              onClick={() => performPush(pushRemote, true)}
              disabled={pushing || !pushRemote}
            >
              {pushing ? <Spinner size={14} /> : <CloudUpload size={14} />}
              推送并设置上游
            </button>
          </div>
        </footer>
      </Modal>
    </>
  );
}

const tabs = [
  { id: 'changes', label: '更改', icon: FileDiff },
  { id: 'history', label: '历史', icon: History },
  { id: 'file', label: '文件历史', icon: FileClock },
];

export function TabBar({
  activeTab,
  onChange,
  counts,
  lastSynced,
  repo,
  filePath,
  fileDirty,
}) {
  const changeCount = counts?.total || 0;
  const fileName = filePath ? filePath.split('/').pop() : '';
  const visibleTabs = filePath
    ? [
        ...tabs,
        {
          id: 'editor',
          label: fileName || '文件',
          icon: FileCode2,
          title: filePath,
          file: true,
        },
      ]
    : tabs;
  return (
    <div className="tabbar">
      <div className="tab-list" role="tablist" aria-label="视图">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={cn(
                'tab-button',
                tab.file && 'tab-file',
                activeTab === tab.id && 'is-active',
              )}
              onClick={() => onChange(tab.id)}
              title={tab.title || tab.label}
            >
              <Icon size={14} />
              <span className="tab-label-text">{tab.label}</span>
              {tab.id === 'changes' && changeCount > 0 ? (
                <span className="tab-badge">{changeCount}</span>
              ) : null}
              {tab.file && fileDirty ? (
                <span className="tab-dirty-dot" title="有未保存的修改" />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="tabbar-meta">
        {lastSynced ? (
          <span className="sync-label">
            <span className="sync-dot" />
            已同步 · {relativeTime(lastSynced)}
          </span>
        ) : null}
        {repo?.lastCommit ? (
          <span className="last-commit-label" title={repo.lastCommit.subject}>
            <GitCommitHorizontal size={12} />
            {shortHash(repo.lastCommit.hash)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function StatusBar({ repos, activeRepo, health, theme }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const broken = repos.filter((repo) => !repo.ok).length;
  return (
    <footer className="statusbar">
      <div className="status-left">
        <span className="status-local">
          <span className="status-led" />
          GitDeck
        </span>
        <span className="status-divider" />
        <span>{repos.length} 个代码库</span>
        {activeRepo ? (
          <>
            <span className="status-divider" />
            <span className="status-branch">
              <GitBranch size={11} />
              {activeRepo.branchName || activeRepo.branch}
            </span>
          </>
        ) : null}
        {broken ? <span className="status-broken">{broken} 个不可用</span> : null}
      </div>
      <div className="status-right">
        <span className="status-muted">UTF-8</span>
        <span className="status-divider" />
        <span className="status-muted">Git {health?.gitVersion?.replace(/\.windows\.\d+$/i, '') || '—'}</span>
        <span className="status-divider" />
        <span className={cn('status-theme', `theme-${theme}`)}>
          {theme === 'dark' ? 'DARK' : 'LIGHT'}
        </span>
        <span className="status-divider" />
        <span className="status-muted">
          {new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(now)}
        </span>
      </div>
    </footer>
  );
}

export function Welcome({ onAdd, onOpenPalette, health, loading }) {
  return (
    <main className="welcome">
      <div className="welcome-aurora" />
      <div className="welcome-inner">
        <div className="welcome-badge">
          <span className="live-dot" />
          MULTI-REPOSITORY GIT WORKBENCH
        </div>
        <h1>
          把每一次提交，
          <br />
          <span>看得更清楚。</span>
        </h1>
        <p className="welcome-sub">
          一个专注于阅读与比较的 Git 工作台。
          <br />
          多仓库切换、提交历史、文件版本与工作区差异，都在同一个界面里。
        </p>
        <div className="welcome-actions">
          <button className="button primary large" onClick={onAdd}>
            <FolderOpen size={17} />
            打开本地代码库
          </button>
          <button className="button ghost large" onClick={onOpenPalette}>
            <Search size={16} />
            快速查找
            <Kbd>Ctrl K</Kbd>
          </button>
        </div>

        <div className="welcome-features">
          <div className="feature-card">
            <div className="feature-icon accent">
              <GitBranch size={18} />
            </div>
            <strong>多仓库工作台</strong>
            <p>左侧集中管理多个仓库，无需在不同窗口之间来回切换。</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon green">
              <FileClock size={18} />
            </div>
            <strong>文件级历史</strong>
            <p>跟随重命名查看某个文件的所有版本，并比较任意两次提交。</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon amber">
              <FileDiff size={18} />
            </div>
            <strong>提交级差异</strong>
            <p>逐文件浏览提交内容，也可以随时把工作区和 HEAD 对照。</p>
          </div>
        </div>

        <div className="welcome-footer-note">
          <GitBranch size={13} />
          Powered by your Git CLI.
          {health ? <span>Git {health.gitVersion?.replace(/\.windows\.\d+$/i, '')} · {health.platform}</span> : null}
          {loading ? <Spinner size={12} /> : null}
        </div>
      </div>
      <div className="welcome-visual" aria-hidden="true">
        <div className="visual-window">
          <div className="visual-top">
            <span />
            <span />
            <span />
            <em>commit · 33a316e</em>
          </div>
          <div className="visual-graph">
            <div className="visual-row">
              <span className="visual-dot accent" />
              <div>
                <strong>feat: add context to headline metrics</strong>
                <small>林未 · 2 hours ago</small>
              </div>
              <span className="visual-pill">main</span>
            </div>
            <div className="visual-row">
              <span className="visual-dot green" />
              <div>
                <strong>fix: align activity timestamps</strong>
                <small>陈默 · yesterday</small>
              </div>
              <span className="visual-pill tag">v0.1.0</span>
            </div>
            <div className="visual-row">
              <span className="visual-dot violet" />
              <div>
                <strong>feat(chart): revenue trend</strong>
                <small>Aria Chen · 3 days ago</small>
              </div>
            </div>
          </div>
          <div className="visual-diff">
            <div className="visual-diff-line del">- const total = sum(rows);</div>
            <div className="visual-diff-line add">+ const total = sum(rows.map(normalize));</div>
            <div className="visual-diff-line add">+ const trend = sparkline(total);</div>
          </div>
        </div>
        <div className="visual-glow" />
      </div>
    </main>
  );
}
