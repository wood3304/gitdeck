import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api } from './api.js';
import AddRepoModal from './components/AddRepoModal.jsx';
import ChangesView from './components/ChangesView.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import FileHistoryView from './components/FileHistoryView.jsx';
import HistoryView from './components/HistoryView.jsx';
import RepoRail from './components/RepoRail.jsx';
import {
  RepoHeader,
  StatusBar,
  TabBar,
  TopBar,
  Welcome,
} from './components/Shell.jsx';
import { ConfirmDialog, Toasts } from './components/common.jsx';

function WorkspaceLoading() {
  return (
    <main className="workspace-loading">
      <div className="loading-orbit">
        <span />
        <span />
        <span />
        <LoaderCircle size={22} className="spin" />
      </div>
      <p>正在准备工作台…</p>
      <small>连接本地 Git 仓库</small>
    </main>
  );
}

export default function App() {
  const [repos, setRepos] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [health, setHealth] = useState(null);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('gitdeck.theme') || 'dark';
    } catch {
      return 'dark';
    }
  });
  const [tab, setTab] = useState('changes');
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastSynced, setLastSynced] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [fileSeed, setFileSeed] = useState(() => ({
    path: '',
    commit: null,
    nonce: 0,
  }));
  const toastTimers = useRef(new Map());
  const activeRepo = useMemo(
    () => repos.find((repo) => repo.id === activeId) || null,
    [repos, activeId],
  );

  const dismissToast = useCallback((id) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) clearTimeout(timer);
    toastTimers.current.delete(id);
  }, []);

  const notify = useCallback(
    (toast) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const entry = { id, type: 'info', ...toast };
      setToasts((previous) => [...previous.slice(-3), entry]);
      const timer = setTimeout(
        () => {
          setToasts((previous) => previous.filter((item) => item.id !== id));
          toastTimers.current.delete(id);
        },
        entry.type === 'error' ? 9000 : 4500,
      );
      toastTimers.current.set(id, timer);
    },
    [],
  );

  useEffect(
    () => () => {
      for (const timer of toastTimers.current.values()) clearTimeout(timer);
    },
    [],
  );

  const loadRepos = useCallback(
    async ({ silent = false, announce = false } = {}) => {
      if (!silent) setLoadingRepos(true);
      try {
        const data = await api.listRepos();
        setRepos(data.repos || []);
        setActiveId((previous) => {
          if (data.repos?.some((repo) => repo.id === previous)) return previous;
          return data.activeRepoId || data.repos?.[0]?.id || null;
        });
        setLastSynced(Date.now());
        if (announce) {
          notify({ type: 'success', title: '代码库已刷新' });
        }
      } catch (error) {
        if (!silent) {
          notify({
            type: 'error',
            title: '无法加载代码库',
            message: error.message,
            detail: error.detail,
          });
        }
      } finally {
        if (!silent) setLoadingRepos(false);
      }
    },
    [notify],
  );

  useEffect(() => {
    loadRepos();
    api
      .health()
      .then(setHealth)
      .catch(() => {});
  }, [loadRepos]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') loadRepos({ silent: true });
    }, 25_000);
    const onFocus = () => loadRepos({ silent: true });
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadRepos]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('gitdeck.theme', theme);
    } catch {
      // Ignore storage restrictions.
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#080b12' : '#f3f5fa');
  }, [theme]);

  useEffect(() => {
    function onKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        setAddOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleRepoChanged = useCallback(
    ({ silent = false } = {}) => {
      if (!silent) setRefreshKey((value) => value + 1);
      setLastSynced(Date.now());
      loadRepos({ silent: true });
    },
    [loadRepos],
  );

  const refreshActive = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshKey((value) => value + 1);
    await loadRepos({ silent: true });
    setLastSynced(Date.now());
    setTimeout(() => setRefreshing(false), 420);
  }, [loadRepos, refreshing]);

  function selectRepo(id) {
    if (!id) return;
    setActiveId(id);
    setTab('changes');
    setFileSeed({ path: '', commit: null, nonce: 0 });
    api.setActiveRepo(id).catch((error) => {
      notify({
        type: 'error',
        title: '无法切换代码库',
        message: error.message,
        detail: error.detail,
      });
    });
    setRefreshKey((value) => value + 1);
  }

  function changeTab(nextTab) {
    if (nextTab === 'file' && !fileSeed.path) {
      let stored = '';
      try {
        stored = localStorage.getItem('gitdeck.lastFileHistoryPath') || '';
      } catch {
        stored = '';
      }
      if (stored) {
        setFileSeed((previous) => ({
          path: stored,
          commit: null,
          nonce: previous.nonce + 1,
        }));
      }
    }
    setTab(nextTab);
    setPaletteOpen(false);
  }

  function openFileHistory(path, commit = null) {
    if (!path) return;
    setFileSeed((previous) => ({
      path,
      commit,
      nonce: previous.nonce + 1,
    }));
    setTab('file');
  }

  async function revealRepo(repo, path = null) {
    try {
      await api.reveal(repo.id, path);
    } catch (error) {
      notify({
        type: 'error',
        title: '无法打开文件管理器',
        message: error.message,
        detail: error.detail,
      });
    }
  }

  async function confirmRemoveRepo() {
    if (!removeTarget) return;
    setRemoveBusy(true);
    try {
      const removedId = removeTarget.id;
      const wasActive = removedId === activeId;
      await api.removeRepo(removedId);
      notify({
        type: 'success',
        title: '已从工作台移除',
        message: `${removeTarget.name} · 仓库文件未受影响`,
      });
      if (wasActive) {
        setTab('changes');
        setFileSeed({ path: '', commit: null, nonce: 0 });
      }
      setRemoveTarget(null);
      await loadRepos({ silent: true });
      setRefreshKey((value) => value + 1);
    } catch (error) {
      notify({
        type: 'error',
        title: '移除代码库失败',
        message: error.message,
        detail: error.detail,
      });
    } finally {
      setRemoveBusy(false);
    }
  }

  async function handleRepoAdded(result) {
    setAddOpen(false);
    const nextId = result?.activeRepoId || result?.repo?.id || null;
    await loadRepos({ silent: true });
    if (nextId) setActiveId(nextId);
    setTab('changes');
    setFileSeed({ path: '', commit: null, nonce: 0 });
    setRefreshKey((value) => value + 1);
    setLastSynced(Date.now());
  }

  function toggleTheme() {
    setTheme((value) => (value === 'dark' ? 'light' : 'dark'));
  }

  const tabCounts = activeRepo?.counts || {
    total: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };

  return (
    <div className="app-frame">
      <TopBar
        activeRepo={activeRepo}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenPalette={() => setPaletteOpen(true)}
        repoCount={repos.length}
      />
      <div className="workbench">
        <RepoRail
          repos={repos}
          activeId={activeId}
          loading={loadingRepos}
          onSelect={selectRepo}
          onAdd={() => setAddOpen(true)}
          onRemove={setRemoveTarget}
          onReveal={revealRepo}
          onRefresh={refreshActive}
          refreshing={refreshing}
        />

        {activeRepo ? (
          <main className="workspace">
            <RepoHeader
              repo={activeRepo}
              refreshing={refreshing}
              onRefresh={refreshActive}
              onReveal={revealRepo}
              onRemove={setRemoveTarget}
              onChanged={handleRepoChanged}
              notify={notify}
            />
            <TabBar
              activeTab={tab}
              onChange={changeTab}
              counts={tabCounts}
              lastSynced={lastSynced}
              repo={activeRepo}
            />
            <div className="view-root">
              {tab === 'changes' ? (
                <ChangesView
                  key={`changes-${activeRepo.id}`}
                  repo={activeRepo}
                  refreshKey={refreshKey}
                  onChanged={handleRepoChanged}
                  onOpenFileHistory={openFileHistory}
                  onOpenHistory={() => changeTab('history')}
                  notify={notify}
                />
              ) : null}
              {tab === 'history' ? (
                <HistoryView
                  key={`history-${activeRepo.id}`}
                  repo={activeRepo}
                  refreshKey={refreshKey}
                  onOpenFileHistory={openFileHistory}
                  notify={notify}
                />
              ) : null}
              {tab === 'file' ? (
                <FileHistoryView
                  key={`file-${activeRepo.id}`}
                  repo={activeRepo}
                  seed={fileSeed}
                  refreshKey={refreshKey}
                  notify={notify}
                />
              ) : null}
            </div>
          </main>
        ) : loadingRepos ? (
          <WorkspaceLoading />
        ) : (
          <Welcome
            onAdd={() => setAddOpen(true)}
            onOpenPalette={() => setPaletteOpen(true)}
            health={health}
            loading={loadingRepos}
          />
        )}
      </div>

      <StatusBar repos={repos} activeRepo={activeRepo} health={health} theme={theme} />

      <Toasts toasts={toasts} onDismiss={dismissToast} />
      <AddRepoModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={handleRepoAdded}
        notify={notify}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        repos={repos}
        activeId={activeId}
        onSelectRepo={selectRepo}
        onNavigate={changeTab}
        onAddRepo={() => setAddOpen(true)}
        onRefresh={refreshActive}
        onToggleTheme={toggleTheme}
        theme={theme}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="从工作台移除代码库？"
        description={`${removeTarget?.name || ''} 只会从 GitDeck 列表中移除，磁盘上的仓库与文件不会被删除。`}
        confirmLabel="移除代码库"
        danger
        loading={removeBusy}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemoveRepo}
      />
    </div>
  );
}
