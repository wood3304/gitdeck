import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoRoot = path.join(root, 'demo');
const force = process.argv.includes('--force');
const tmpRoot = path.join(root, '.data', 'tmp', 'seed');
fs.mkdirSync(tmpRoot, { recursive: true });
let invocation = 0;

function git(cwd, args, options = {}) {
  invocation += 1;
  const id = `${process.pid}-${invocation}`;
  const outPath = path.join(tmpRoot, `${id}.out`);
  const errPath = path.join(tmpRoot, `${id}.err`);
  const outFd = fs.openSync(outPath, 'w');
  const errFd = fs.openSync(errPath, 'w');
  let result;
  try {
    result = spawnSync('git', args, {
      cwd,
      stdio: ['ignore', outFd, errFd],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        ...(options.env || {}),
      },
    });
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
  const stdout = fs.readFileSync(outPath, 'utf8');
  const stderr = fs.readFileSync(errPath, 'utf8');
  fs.rmSync(outPath, { force: true });
  fs.rmSync(errPath, { force: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${stderr || stdout}`);
  }
  return stdout;
}

function write(repo, rel, content) {
  const target = path.join(repo, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function append(repo, rel, content) {
  fs.appendFileSync(path.join(repo, rel), content, 'utf8');
}

function initRepo(name) {
  const repo = path.join(demoRoot, name);
  if (fs.existsSync(repo)) {
    if (!force) {
      console.log(`skip ${name} (already exists; use --force to rebuild)`);
      return null;
    }
    fs.rmSync(repo, { recursive: true, force: true });
  }
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', '林未']);
  git(repo, ['config', 'user.email', 'linwei@example.com']);
  return repo;
}

function commit(repo, message, { author, email, date, addAll = true } = {}) {
  if (addAll) git(repo, ['add', '-A']);
  const env = {
    GIT_AUTHOR_NAME: author,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: author,
    GIT_COMMITTER_EMAIL: email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
  git(repo, ['commit', '-q', '-m', message], { env });
}

function tag(repo, name, message, { author, email, date }) {
  const env = {
    GIT_COMMITTER_NAME: author,
    GIT_COMMITTER_EMAIL: email,
    GIT_COMMITTER_DATE: date,
  };
  git(repo, ['tag', '-a', name, '-m', message], { env });
}

function buildAurora() {
  const repo = initRepo('aurora-dashboard');
  if (!repo) return;

  write(repo, '.gitignore', `node_modules/\ndist/\n.env\n.env.local\n.DS_Store\ncoverage/\n`);
  write(
    repo,
    'README.md',
    `# Aurora Dashboard\n\nA calm, high-signal revenue operations dashboard.\n\n## Getting started\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n## Principles\n\n- Numbers first, decoration second.\n- Every panel has one job.\n- Zero layout shift while data refreshes.\n`,
  );
  write(
    repo,
    'package.json',
    JSON.stringify(
      {
        name: 'aurora-dashboard',
        private: true,
        version: '0.1.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: { vite: '^7.0.0' },
      },
      null,
      2,
    ) + '\n',
  );
  write(
    repo,
    'vite.config.js',
    `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n  server: { port: 5174 },\n});\n`,
  );
  write(
    repo,
    'index.html',
    `<!doctype html>\n<html lang="zh-CN">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Aurora · Revenue Intelligence</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>\n`,
  );
  write(
    repo,
    'src/main.jsx',
    `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './styles.css';\n\ncreateRoot(document.getElementById('root')).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>,\n);\n`,
  );
  write(
    repo,
    'src/App.jsx',
    `import Sidebar from './components/Sidebar';\nimport MetricCard from './components/MetricCard';\nimport ActivityFeed from './components/ActivityFeed';\n\nconst metrics = [\n  { label: 'Net revenue', value: '$482,910', delta: '+12.4%' },\n  { label: 'Active accounts', value: '1,284', delta: '+3.1%' },\n  { label: 'Net churn', value: '1.8%', delta: '-0.4%' },\n];\n\nexport default function App() {\n  return (\n    <div className="shell">\n      <Sidebar />\n      <main className="main">\n        <header className="page-head">\n          <div>\n            <p className="eyebrow">Overview</p>\n            <h1>Revenue pulse</h1>\n          </div>\n          <span className="live-pill">Live</span>\n        </header>\n        <section className="metric-grid">\n          {metrics.map((metric) => (\n            <MetricCard key={metric.label} {...metric} />\n          ))}\n        </section>\n        <ActivityFeed />\n      </main>\n    </div>\n  );\n}\n`,
  );
  write(
    repo,
    'src/components/Sidebar.jsx',
    `const items = ['Overview', 'Revenue', 'Customers', 'Retention', 'Reports'];\n\nexport default function Sidebar() {\n  return (\n    <aside className="sidebar">\n      <div className="brand"><span className="brand-dot" />Aurora</div>\n      <nav>\n        {items.map((item, index) => (\n          <a key={item} className={index === 0 ? 'nav-item active' : 'nav-item'} href="#">\n            <span className="nav-marker" />\n            {item}\n          </a>\n        ))}\n      </nav>\n      <div className="sidebar-foot">\n        <div className="avatar">LW</div>\n        <div>\n          <strong>Lin Wei</strong>\n          <span>RevOps lead</span>\n        </div>\n      </div>\n    </aside>\n  );\n}\n`,
  );
  write(
    repo,
    'src/components/MetricCard.jsx',
    `export default function MetricCard({ label, value, delta }) {\n  const positive = !delta.startsWith('-');\n  return (\n    <article className="metric-card">\n      <span className="metric-label">{label}</span>\n      <strong className="metric-value">{value}</strong>\n      <span className={positive ? 'delta up' : 'delta down'}>{delta}</span>\n    </article>\n  );\n}\n`,
  );
  write(
    repo,
    'src/components/ActivityFeed.jsx',
    `const events = [\n  { who: 'Northwind', what: 'expanded to 40 seats', when: '8 min ago' },\n  { who: 'Kite Labs', what: 'upgraded to Scale', when: '26 min ago' },\n  { who: 'Mono GmbH', what: 'renewed for 12 months', when: '1 hr ago' },\n  { who: 'Halcyon', what: 'added 3 new workspaces', when: '2 hrs ago' },\n];\n\nexport default function ActivityFeed() {\n  return (\n    <section className="panel activity">\n      <div className="panel-head">\n        <h2>Recent activity</h2>\n        <button className="text-button">View all</button>\n      </div>\n      <ul>\n        {events.map((event) => (\n          <li key={event.who}>\n            <span className="event-avatar">{event.who.slice(0, 1)}</span>\n            <p><strong>{event.who}</strong> {event.what}</p>\n            <time>{event.when}</time>\n          </li>\n        ))}\n      </ul>\n    </section>\n  );\n}\n`,
  );
  write(
    repo,
    'src/styles.css',
    `:root {\n  color-scheme: dark;\n  --bg: #080b12;\n  --panel: #101522;\n  --line: rgba(255,255,255,.08);\n  --text: #edf2ff;\n  --muted: #7f8aa3;\n  --accent: #8aa4ff;\n  --up: #45d9a1;\n  --down: #ff7c92;\n  font-family: "Inter", "Segoe UI", sans-serif;\n}\n\n* { box-sizing: border-box; }\nbody { margin: 0; background: var(--bg); color: var(--text); }\na { color: inherit; text-decoration: none; }\n.shell { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }\n.sidebar { border-right: 1px solid var(--line); padding: 28px 18px; display: flex; flex-direction: column; gap: 34px; background: rgba(255,255,255,.015); }\n.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: .02em; padding: 0 10px; }\n.brand-dot { width: 10px; height: 10px; border-radius: 50%; background: linear-gradient(135deg, #9a7bff, #5fd7ff); box-shadow: 0 0 18px #7d8dff88; }\n.sidebar nav { display: flex; flex-direction: column; gap: 3px; }\n.nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 9px; color: var(--muted); font-size: 13px; }\n.nav-item:hover { background: rgba(255,255,255,.04); color: var(--text); }\n.nav-item.active { background: rgba(125,147,255,.12); color: #dfe7ff; }\n.nav-marker { width: 3px; height: 14px; border-radius: 3px; background: transparent; }\n.nav-item.active .nav-marker { background: var(--accent); }\n.sidebar-foot { margin-top: auto; display: flex; align-items: center; gap: 10px; padding: 14px 10px 0; border-top: 1px solid var(--line); font-size: 12px; }\n.sidebar-foot strong, .sidebar-foot span { display: block; }\n.sidebar-foot span { color: var(--muted); margin-top: 2px; }\n.avatar, .event-avatar { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: #24304c; color: #c6d4ff; font-size: 11px; font-weight: 700; }\n.main { padding: 38px 42px; max-width: 1400px; width: 100%; }\n.page-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 28px; }\n.eyebrow { color: var(--accent); font-size: 11px; letter-spacing: .18em; text-transform: uppercase; margin: 0 0 8px; }\nh1 { font-size: 32px; margin: 0; letter-spacing: -.03em; }\n.live-pill { color: var(--up); font-size: 11px; letter-spacing: .08em; border: 1px solid rgba(69,217,161,.3); background: rgba(69,217,161,.08); border-radius: 999px; padding: 5px 10px; }\n.metric-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }\n.metric-card { background: linear-gradient(160deg, #121929, #0e131f); border: 1px solid var(--line); border-radius: 14px; padding: 20px; display: flex; flex-direction: column; gap: 8px; }\n.metric-label { color: var(--muted); font-size: 12px; }\n.metric-value { font-size: 28px; letter-spacing: -.03em; }\n.delta { font-size: 12px; }\n.delta.up { color: var(--up); } .delta.down { color: var(--down); }\n.panel { margin-top: 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 22px; }\n.panel-head { display: flex; align-items: center; justify-content: space-between; }\n.panel h2 { font-size: 15px; margin: 0; }\n.text-button { background: none; border: 0; color: var(--accent); font-size: 12px; cursor: pointer; }\n.activity ul { list-style: none; padding: 0; margin: 18px 0 0; display: flex; flex-direction: column; }\n.activity li { display: flex; align-items: center; gap: 12px; padding: 13px 0; border-top: 1px solid var(--line); }\n.activity p { flex: 1; margin: 0; color: #b5bfd4; font-size: 13px; }\n.activity p strong { color: var(--text); }\n.activity time { color: var(--muted); font-size: 11px; }\n`,
  );

  commit(repo, 'chore: bootstrap aurora dashboard', {
    author: '林未',
    email: 'linwei@example.com',
    date: '2026-09-16T09:42:00+08:00',
  });

  write(
    repo,
    'src/components/MetricCard.jsx',
    `export default function MetricCard({ label, value, delta, hint }) {\n  const positive = !delta.startsWith('-');\n  return (\n    <article className="metric-card">\n      <span className="metric-label">{label}</span>\n      <strong className="metric-value">{value}</strong>\n      <div className="metric-foot">\n        <span className={positive ? 'delta up' : 'delta down'}>{delta}</span>\n        <span className="metric-hint">{hint}</span>\n      </div>\n    </article>\n  );\n}\n`,
  );
  write(
    repo,
    'src/App.jsx',
    `import Sidebar from './components/Sidebar';\nimport MetricCard from './components/MetricCard';\nimport ActivityFeed from './components/ActivityFeed';\n\nconst metrics = [\n  { label: 'Net revenue', value: '$482,910', delta: '+12.4%', hint: 'vs. last month' },\n  { label: 'Active accounts', value: '1,284', delta: '+3.1%', hint: '42 new logos' },\n  { label: 'Net churn', value: '1.8%', delta: '-0.4%', hint: 'best in 6 months' },\n];\n\nexport default function App() {\n  return (\n    <div className="shell">\n      <Sidebar />\n      <main className="main">\n        <header className="page-head">\n          <div>\n            <p className="eyebrow">Overview</p>\n            <h1>Revenue pulse</h1>\n          </div>\n          <span className="live-pill">Live</span>\n        </header>\n        <section className="metric-grid">\n          {metrics.map((metric) => (\n            <MetricCard key={metric.label} {...metric} />\n          ))}\n        </section>\n        <ActivityFeed />\n      </main>\n    </div>\n  );\n}\n`,
  );
  append(
    repo,
    'src/styles.css',
    `.metric-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }\n.metric-hint { color: var(--muted); font-size: 11px; }\n@media (max-width: 980px) { .metric-grid { grid-template-columns: 1fr 1fr; } }\n`,
  );

  commit(repo, 'feat: add context to headline revenue metrics', {
    author: '林未',
    email: 'linwei@example.com',
    date: '2026-09-19T14:08:00+08:00',
  });

  write(
    repo,
    'src/components/RevenueChart.jsx',
    `import { useMemo } from 'react';\n\nconst points = [18, 24, 22, 31, 29, 38, 41, 39, 48, 54, 51, 62];\n\nexport default function RevenueChart() {\n  const path = useMemo(() => {\n    return points\n      .map((value, index) => {\n        const x = (index / (points.length - 1)) * 100;\n        const y = 100 - (value / 70) * 100;\n        return \`\${index === 0 ? 'M' : 'L'}\${x.toFixed(2)},\${y.toFixed(2)}\`;\n      })\n      .join(' ');\n  }, []);\n\n  return (\n    <section className="panel chart-panel">\n      <div className="panel-head">\n        <div>\n          <h2>Recurring revenue</h2>\n          <p className="chart-sub">Trailing 12 months · normalized</p>\n        </div>\n        <span className="delta up">+18.7% YoY</span>\n      </div>\n      <div className="chart-body">\n        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Revenue trend">\n          <defs>\n            <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">\n              <stop offset="0%" stopColor="#8aa4ff" stopOpacity="0.28" />\n              <stop offset="100%" stopColor="#8aa4ff" stopOpacity="0" />\n            </linearGradient>\n          </defs>\n          <path d={\`\${path} L100,100 L0,100 Z\`} fill="url(#area)" />\n          <path d={path} fill="none" stroke="#9fb4ff" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />\n        </svg>\n      </div>\n    </section>\n  );\n}\n`,
  );
  write(
    repo,
    'src/App.jsx',
    `import Sidebar from './components/Sidebar';\nimport MetricCard from './components/MetricCard';\nimport RevenueChart from './components/RevenueChart';\nimport ActivityFeed from './components/ActivityFeed';\n\nconst metrics = [\n  { label: 'Net revenue', value: '$482,910', delta: '+12.4%', hint: 'vs. last month' },\n  { label: 'Active accounts', value: '1,284', delta: '+3.1%', hint: '42 new logos' },\n  { label: 'Net churn', value: '1.8%', delta: '-0.4%', hint: 'best in 6 months' },\n];\n\nexport default function App() {\n  return (\n    <div className="shell">\n      <Sidebar />\n      <main className="main">\n        <header className="page-head">\n          <div>\n            <p className="eyebrow">Overview</p>\n            <h1>Revenue pulse</h1>\n          </div>\n          <span className="live-pill">Live</span>\n        </header>\n        <section className="metric-grid">\n          {metrics.map((metric) => (\n            <MetricCard key={metric.label} {...metric} />\n          ))}\n        </section>\n        <RevenueChart />\n        <ActivityFeed />\n      </main>\n    </div>\n  );\n}\n`,
  );
  append(
    repo,
    'src/styles.css',
    `.chart-panel { overflow: hidden; }\n.chart-sub { color: var(--muted); font-size: 11px; margin: 5px 0 0; }\n.chart-body { height: 210px; margin-top: 16px; }\n.chart-body svg { width: 100%; height: 100%; overflow: visible; }\n`,
  );

  commit(repo, 'feat(chart): add interactive revenue trend', {
    author: 'Aria Chen',
    email: 'aria@example.com',
    date: '2026-09-24T17:26:00+08:00',
  });

  write(
    repo,
    'src/lib/format.js',
    `export function relativeTime(value, now = Date.now()) {\n  const diff = Math.max(0, now - new Date(value).getTime());\n  const minutes = Math.round(diff / 60000);\n  if (minutes < 60) return \`\${minutes} min ago\`;\n  const hours = Math.round(minutes / 60);\n  if (hours < 24) return \`\${hours} hr ago\`;\n  return \`\${Math.round(hours / 24)} d ago\`;\n}\n\nexport function formatCurrency(value) {\n  return new Intl.NumberFormat('en-US', {\n    style: 'currency',\n    currency: 'USD',\n    maximumFractionDigits: 0,\n  }).format(value);\n}\n`,
  );
  write(
    repo,
    'src/components/ActivityFeed.jsx',
    `import { relativeTime } from '../lib/format';\n\nconst events = [\n  { who: 'Northwind', what: 'expanded to 40 seats', at: '2026-10-08T10:31:00+08:00' },\n  { who: 'Kite Labs', what: 'upgraded to Scale', at: '2026-10-08T10:14:00+08:00' },\n  { who: 'Mono GmbH', what: 'renewed for 12 months', at: '2026-10-08T09:40:00+08:00' },\n  { who: 'Halcyon', what: 'added 3 new workspaces', at: '2026-10-08T08:02:00+08:00' },\n];\n\nexport default function ActivityFeed() {\n  return (\n    <section className="panel activity">\n      <div className="panel-head">\n        <h2>Recent activity</h2>\n        <button className="text-button">View all</button>\n      </div>\n      <ul>\n        {events.map((event) => (\n          <li key={event.who}>\n            <span className="event-avatar">{event.who.slice(0, 1)}</span>\n            <p><strong>{event.who}</strong> {event.what}</p>\n            <time dateTime={event.at}>{relativeTime(event.at)}</time>\n          </li>\n        ))}\n      </ul>\n    </section>\n  );\n}\n`,
  );

  commit(repo, 'fix: align activity timestamps with viewer timezone', {
    author: '陈默',
    email: 'chenmo@example.com',
    date: '2026-09-30T11:18:00+08:00',
  });

  write(
    repo,
    'package.json',
    JSON.stringify(
      {
        name: 'aurora-dashboard',
        private: true,
        version: '0.1.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: { vite: '^7.0.0' },
      },
      null,
      2,
    ) + '\n',
  );
  write(repo, 'CHANGELOG.md', `# Changelog\n\n## 0.1.0 — 2026-10-03\n\n- Revenue, account and churn metrics\n- Recurring revenue trend\n- Live activity stream\n`);
  commit(repo, 'chore: release v0.1.0', {
    author: '林未',
    email: 'linwei@example.com',
    date: '2026-10-03T19:02:00+08:00',
  });
  tag(repo, 'v0.1.0', 'Aurora 0.1.0', {
    author: '林未',
    email: 'linwei@example.com',
    date: '2026-10-03T19:04:00+08:00',
  });

  git(repo, ['switch', '-q', '-c', 'feature/command-palette']);
  write(
    repo,
    'src/components/CommandPalette.jsx',
    `import { useEffect, useMemo, useRef, useState } from 'react';\n\nconst actions = [\n  { id: 'overview', label: 'Go to overview', hint: 'G O' },\n  { id: 'revenue', label: 'Open revenue report', hint: 'G R' },\n  { id: 'customers', label: 'Search customers', hint: 'G C' },\n  { id: 'export', label: 'Export dashboard as PDF', hint: '⌘ E' },\n];\n\nexport default function CommandPalette({ open, onClose }) {\n  const [query, setQuery] = useState('');\n  const inputRef = useRef(null);\n  const results = useMemo(\n    () => actions.filter((action) => action.label.toLowerCase().includes(query.toLowerCase())),\n    [query],\n  );\n\n  useEffect(() => {\n    if (open) setTimeout(() => inputRef.current?.focus(), 30);\n    else setQuery('');\n  }, [open]);\n\n  if (!open) return null;\n\n  return (\n    <div className="palette-backdrop" onClick={onClose}>\n      <div className="palette" onClick={(event) => event.stopPropagation()}>\n        <input\n          ref={inputRef}\n          value={query}\n          onChange={(event) => setQuery(event.target.value)}\n          placeholder="Type a command or search…"\n        />\n        <div className="palette-results">\n          {results.map((action) => (\n            <button key={action.id} onClick={onClose}>\n              <span>{action.label}</span>\n              <kbd>{action.hint}</kbd>\n            </button>\n          ))}\n          {results.length === 0 && <p className="palette-empty">No matching commands</p>}\n        </div>\n      </div>\n    </div>\n  );\n}\n`,
  );
  commit(repo, 'feat: scaffold command palette overlay', {
    author: 'Aria Chen',
    email: 'aria@example.com',
    date: '2026-10-07T15:11:00+08:00',
  });

  write(
    repo,
    'src/App.jsx',
    `import { useEffect, useState } from 'react';\nimport Sidebar from './components/Sidebar';\nimport MetricCard from './components/MetricCard';\nimport RevenueChart from './components/RevenueChart';\nimport ActivityFeed from './components/ActivityFeed';\nimport CommandPalette from './components/CommandPalette';\n\nconst metrics = [\n  { label: 'Net revenue', value: '$482,910', delta: '+12.4%', hint: 'vs. last month' },\n  { label: 'Active accounts', value: '1,284', delta: '+3.1%', hint: '42 new logos' },\n  { label: 'Net churn', value: '1.8%', delta: '-0.4%', hint: 'best in 6 months' },\n];\n\nexport default function App() {\n  const [paletteOpen, setPaletteOpen] = useState(false);\n\n  useEffect(() => {\n    function onKeyDown(event) {\n      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {\n        event.preventDefault();\n        setPaletteOpen((value) => !value);\n      }\n      if (event.key === 'Escape') setPaletteOpen(false);\n    }\n    window.addEventListener('keydown', onKeyDown);\n    return () => window.removeEventListener('keydown', onKeyDown);\n  }, []);\n\n  return (\n    <div className="shell">\n      <Sidebar />\n      <main className="main">\n        <header className="page-head">\n          <div>\n            <p className="eyebrow">Overview</p>\n            <h1>Revenue pulse</h1>\n          </div>\n          <span className="live-pill">Live</span>\n        </header>\n        <section className="metric-grid">\n          {metrics.map((metric) => (\n            <MetricCard key={metric.label} {...metric} />\n          ))}\n        </section>\n        <RevenueChart />\n        <ActivityFeed />\n      </main>\n      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />\n    </div>\n  );\n}\n`,
  );
  append(
    repo,
    'src/styles.css',
    `.palette-backdrop { position: fixed; inset: 0; background: rgba(2,5,10,.68); backdrop-filter: blur(6px); display: grid; place-items: start center; padding-top: 18vh; z-index: 40; }\n.palette { width: min(620px, 90vw); background: #111725; border: 1px solid rgba(255,255,255,.12); border-radius: 15px; overflow: hidden; box-shadow: 0 40px 90px rgba(0,0,0,.55); }\n.palette input { width: 100%; background: transparent; border: 0; border-bottom: 1px solid var(--line); padding: 18px 20px; color: var(--text); font-size: 15px; outline: none; }\n.palette-results { padding: 8px; display: flex; flex-direction: column; }\n.palette-results button { display: flex; align-items: center; justify-content: space-between; background: none; border: 0; color: #c9d3ea; padding: 12px; border-radius: 9px; cursor: pointer; text-align: left; }\n.palette-results button:hover { background: rgba(255,255,255,.05); }\n.palette-results kbd { color: var(--muted); font-size: 10px; }\n.palette-empty { color: var(--muted); padding: 16px; font-size: 12px; }\n`,
  );
  commit(repo, 'feat: wire Cmd+K shortcut to palette', {
    author: 'Aria Chen',
    email: 'aria@example.com',
    date: '2026-10-08T10:44:00+08:00',
  });

  git(repo, ['switch', '-q', 'main']);
  git(repo, ['merge', '--no-ff', 'feature/command-palette', '-m', "Merge branch 'feature/command-palette'"], {
    env: {
      GIT_AUTHOR_NAME: '陈默',
      GIT_AUTHOR_EMAIL: 'chenmo@example.com',
      GIT_COMMITTER_NAME: '陈默',
      GIT_COMMITTER_EMAIL: 'chenmo@example.com',
      GIT_AUTHOR_DATE: '2026-10-09T09:31:00+08:00',
      GIT_COMMITTER_DATE: '2026-10-09T09:31:00+08:00',
    },
  });

  append(
    repo,
    'src/styles.css',
    `.nav-item { transition: background .16s ease, color .16s ease, padding .16s ease; }\n.nav-item:focus-visible, .text-button:focus-visible { outline: 2px solid rgba(138,164,255,.65); outline-offset: 2px; }\n.metric-card { transition: border-color .18s ease, transform .18s ease; }\n.metric-card:hover { border-color: rgba(138,164,255,.25); transform: translateY(-1px); }\n`,
  );
  write(
    repo,
    'src/components/Sidebar.jsx',
    `const items = ['Overview', 'Revenue', 'Customers', 'Retention', 'Reports'];\n\nexport default function Sidebar() {\n  return (\n    <aside className="sidebar">\n      <div className="brand"><span className="brand-dot" />Aurora</div>\n      <nav>\n        {items.map((item, index) => (\n          <a key={item} className={index === 0 ? 'nav-item active' : 'nav-item'} href="#">\n            <span className="nav-marker" />\n            {item}\n          </a>\n        ))}\n      </nav>\n      <div className="sidebar-foot">\n        <div className="avatar">LW</div>\n        <div>\n          <strong>Lin Wei</strong>\n          <span>RevOps lead</span>\n        </div>\n      </div>\n    </aside>\n  );\n}\n`,
  );
  commit(repo, 'style: tighten sidebar rhythm and focus rings', {
    author: '林未',
    email: 'linwei@example.com',
    date: '2026-10-12T16:05:00+08:00',
  });

  write(
    repo,
    'src/components/MetricCard.jsx',
    `import { memo } from 'react';\n\nfunction MetricCard({ label, value, delta, hint }) {\n  const positive = !delta.startsWith('-');\n  return (\n    <article className="metric-card">\n      <span className="metric-label">{label}</span>\n      <strong className="metric-value">{value}</strong>\n      <div className="metric-foot">\n        <span className={positive ? 'delta up' : 'delta down'}>{delta}</span>\n        <span className="metric-hint">{hint}</span>\n      </div>\n    </article>\n  );\n}\n\nexport default memo(MetricCard);\n`,
  );
  write(
    repo,
    'src/components/RevenueChart.jsx',
    `import { useMemo } from 'react';\n\nconst points = [18, 24, 22, 31, 29, 38, 41, 39, 48, 54, 51, 62];\n\nfunction buildPath(values) {\n  return values\n    .map((value, index) => {\n      const x = (index / (values.length - 1)) * 100;\n      const y = 100 - (value / 70) * 100;\n      return \`\${index === 0 ? 'M' : 'L'}\${x.toFixed(2)},\${y.toFixed(2)}\`;\n    })\n    .join(' ');\n}\n\nexport default function RevenueChart() {\n  const path = useMemo(() => buildPath(points), []);\n\n  return (\n    <section className="panel chart-panel">\n      <div className="panel-head">\n        <div>\n          <h2>Recurring revenue</h2>\n          <p className="chart-sub">Trailing 12 months · normalized</p>\n        </div>\n        <span className="delta up">+18.7% YoY</span>\n      </div>\n      <div className="chart-body">\n        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Revenue trend">\n          <defs>\n            <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">\n              <stop offset="0%" stopColor="#8aa4ff" stopOpacity="0.28" />\n              <stop offset="100%" stopColor="#8aa4ff" stopOpacity="0" />\n            </linearGradient>\n          </defs>\n          <path d={\`\${path} L100,100 L0,100 Z\`} fill="url(#area)" />\n          <path d={path} fill="none" stroke="#9fb4ff" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />\n        </svg>\n      </div>\n    </section>\n  );\n}\n`,
  );
  commit(repo, 'perf: memoize metric selector and chart points', {
    author: 'Aria Chen',
    email: 'aria@example.com',
    date: '2026-10-18T13:47:00+08:00',
  });

  write(
    repo,
    'package.json',
    JSON.stringify(
      {
        name: 'aurora-dashboard',
        private: true,
        version: '1.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: { vite: '^7.0.0' },
      },
      null,
      2,
    ) + '\n',
  );
  write(
    repo,
    'CHANGELOG.md',
    `# Changelog\n\n## 1.0.0 — 2026-10-20\n\n- Command palette with keyboard navigation\n- Memoized metric selectors\n- Refined focus states across navigation\n\n## 0.1.0 — 2026-10-03\n\n- Revenue, account and churn metrics\n- Recurring revenue trend\n- Live activity stream\n`,
  );
  commit(repo, 'chore(release): v1.0.0', {
    author: '陈默',
    email: 'chenmo@example.com',
    date: '2026-10-20T18:22:00+08:00',
  });
  tag(repo, 'v1.0.0', 'Aurora 1.0 — revenue intelligence', {
    author: '陈默',
    email: 'chenmo@example.com',
    date: '2026-10-20T18:26:00+08:00',
  });

  git(repo, ['switch', '-q', '-c', 'feat/dashboard-export']);
  write(
    repo,
    'src/lib/export.js',
    `function escapeCell(value) {\n  return \`"\${String(value).replaceAll('"', '""')}"\`;\n}\n\nexport function toCsv(rows, columns) {\n  const header = columns.map((column) => escapeCell(column.label)).join(',');\n  const body = rows.map((row) => columns.map((column) => escapeCell(row[column.key])).join(','));\n  return [header, ...body].join('\\n');\n}\n\nexport function downloadCsv(filename, csv) {\n  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });\n  const url = URL.createObjectURL(blob);\n  const anchor = document.createElement('a');\n  anchor.href = url;\n  anchor.download = filename;\n  anchor.click();\n  URL.revokeObjectURL(url);\n}\n`,
  );
  write(
    repo,
    'docs/export.md',
    `# Dashboard export\n\nCSV export is generated on the client so no customer data leaves the browser.\n\nColumns are declared explicitly in the export action to keep the export contract stable.\n`,
  );
  commit(repo, 'feat: add CSV export pipeline for dashboard snapshots', {
    author: '林未',
    email: 'linwei@example.com',
    date: '2026-10-24T11:36:00+08:00',
  });
  git(repo, ['switch', '-q', 'main']);

  // A deliberately mixed working tree for the changes view.
  write(
    repo,
    'src/components/MetricCard.jsx',
    `import { memo } from 'react';\n\nfunction MetricCard({ label, value, delta, hint, trend }) {\n  const positive = !delta.startsWith('-');\n  const spark = trend ?? [4, 7, 6, 9, 8, 12, 11, 14];\n  return (\n    <article className="metric-card">\n      <span className="metric-label">{label}</span>\n      <strong className="metric-value">{value}</strong>\n      <div className="metric-foot">\n        <span className={positive ? 'delta up' : 'delta down'}>{delta}</span>\n        <span className="metric-hint">{hint}</span>\n      </div>\n      <svg className="metric-spark" viewBox="0 0 80 22" aria-hidden="true">\n        <polyline\n          points={spark.map((point, index) => \`\${(index / (spark.length - 1)) * 80},\${22 - point}\`).join(' ')}\n          fill="none"\n          stroke="currentColor"\n          strokeWidth="1.5"\n        />\n      </svg>\n    </article>\n  );\n}\n\nexport default memo(MetricCard);\n`,
  );
  git(repo, ['add', 'src/components/MetricCard.jsx']);
  append(
    repo,
    'src/components/MetricCard.jsx',
    `\n// Sparkline stays decorative; the numeric delta is the accessible signal.\n`,
  );
  write(
    repo,
    'src/components/FilterBar.jsx',
    `const ranges = ['7D', '30D', '90D', 'YTD'];\n\nexport default function FilterBar({ value, onChange }) {\n  return (\n    <div className="filter-bar" role="group" aria-label="Date range">\n      {ranges.map((range) => (\n        <button\n          key={range}\n          className={range === value ? 'filter-chip active' : 'filter-chip'}\n          onClick={() => onChange(range)}\n        >\n          {range}\n        </button>\n      ))}\n    </div>\n  );\n}\n`,
  );
  write(
    repo,
    'src/App.jsx',
    `import { useEffect, useState } from 'react';\nimport Sidebar from './components/Sidebar';\nimport MetricCard from './components/MetricCard';\nimport RevenueChart from './components/RevenueChart';\nimport ActivityFeed from './components/ActivityFeed';\nimport CommandPalette from './components/CommandPalette';\nimport FilterBar from './components/FilterBar';\n\nconst metrics = [\n  { label: 'Net revenue', value: '$482,910', delta: '+12.4%', hint: 'vs. last month' },\n  { label: 'Active accounts', value: '1,284', delta: '+3.1%', hint: '42 new logos' },\n  { label: 'Net churn', value: '1.8%', delta: '-0.4%', hint: 'best in 6 months' },\n];\n\nexport default function App() {\n  const [paletteOpen, setPaletteOpen] = useState(false);\n  const [range, setRange] = useState('30D');\n\n  useEffect(() => {\n    function onKeyDown(event) {\n      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {\n        event.preventDefault();\n        setPaletteOpen((value) => !value);\n      }\n      if (event.key === 'Escape') setPaletteOpen(false);\n    }\n    window.addEventListener('keydown', onKeyDown);\n    return () => window.removeEventListener('keydown', onKeyDown);\n  }, []);\n\n  return (\n    <div className="shell">\n      <Sidebar />\n      <main className="main">\n        <header className="page-head">\n          <div>\n            <p className="eyebrow">Overview</p>\n            <h1>Revenue pulse</h1>\n          </div>\n          <div className="page-actions">\n            <FilterBar value={range} onChange={setRange} />\n            <span className="live-pill">Live</span>\n          </div>\n        </header>\n        <section className="metric-grid">\n          {metrics.map((metric) => (\n            <MetricCard key={metric.label} {...metric} />\n          ))}\n        </section>\n        <RevenueChart />\n        <ActivityFeed />\n      </main>\n      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />\n    </div>\n  );\n}\n`,
  );
  append(
    repo,
    'src/styles.css',
    `.page-actions { display: flex; align-items: center; gap: 10px; }\n.filter-bar { display: flex; gap: 2px; padding: 3px; background: rgba(255,255,255,.04); border: 1px solid var(--line); border-radius: 9px; }\n.filter-chip { border: 0; background: transparent; color: var(--muted); font-size: 11px; padding: 5px 8px; border-radius: 6px; cursor: pointer; }\n.filter-chip.active { background: #1b2438; color: #dfe7ff; }\n.metric-spark { width: 100%; height: 22px; color: rgba(138,164,255,.7); margin-top: 2px; }\n`,
  );
  write(
    repo,
    'docs/roadmap.md',
    `# Aurora roadmap\n\n## Next\n\n- Cohort retention drill-down\n- Board-ready PDF export\n- Warehouse sync health indicators\n\n## Later\n\n- Forecast scenarios\n- Account-level revenue timeline\n`,
  );

  const status = git(repo, ['status', '--short']).trim();
  console.log('built demo/aurora-dashboard');
  console.log(status ? status.split('\n').map((line) => `  ${line}`).join('\n') : '  clean');
}

function buildNebula() {
  const repo = initRepo('nebula-api');
  if (!repo) return;

  write(repo, '.gitignore', `node_modules/\n.env\ncoverage/\n*.log\n`);
  write(
    repo,
    'README.md',
    `# Nebula API\n\nUsage metering and authentication service for Nebula.\n\n\`\`\`bash\nnpm start\nnpm test\n\`\`\`\n\nAll endpoints are versioned under \`/v1\` and require a signed session token.\n`,
  );
  write(
    repo,
    'package.json',
    JSON.stringify(
      {
        name: 'nebula-api',
        private: true,
        version: '0.1.0',
        type: 'module',
        scripts: { start: 'node src/server.js', test: 'node --test' },
        engines: { node: '>=22' },
      },
      null,
      2,
    ) + '\n',
  );
  write(
    repo,
    'src/server.js',
    `import http from 'node:http';\nimport { health } from './routes/health.js';\n\nconst routes = { '/health': health };\n\nconst server = http.createServer(async (request, response) => {\n  const url = new URL(request.url, 'http://localhost');\n  const handler = routes[url.pathname];\n  if (!handler) {\n    response.writeHead(404, { 'content-type': 'application/json' });\n    response.end(JSON.stringify({ error: 'not_found' }));\n    return;\n  }\n  const result = await handler({ request, url });\n  response.writeHead(result.status ?? 200, { 'content-type': 'application/json' });\n  response.end(JSON.stringify(result.body));\n});\n\nconst port = Number(process.env.PORT || 8080);\nserver.listen(port, () => console.log(\`nebula-api listening on :\${port}\`));\n`,
  );
  write(
    repo,
    'src/routes/health.js',
    `export async function health() {\n  return {\n    status: 200,\n    body: {\n      ok: true,\n      service: 'nebula-api',\n      region: process.env.REGION || 'local',\n      now: new Date().toISOString(),\n    },\n  };\n}\n`,
  );
  write(
    repo,
    'test/health.test.js',
    `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { health } from '../src/routes/health.js';\n\ntest('health probe returns service identity', async () => {\n  const result = await health();\n  assert.equal(result.status, 200);\n  assert.equal(result.body.ok, true);\n  assert.equal(result.body.service, 'nebula-api');\n});\n`,
  );

  commit(repo, 'feat: bootstrap nebula API with health probe', {
    author: '陈默',
    email: 'chenmo@example.com',
    date: '2026-09-20T10:26:00+08:00',
  });

  write(
    repo,
    'src/lib/token.js',
    `import crypto from 'node:crypto';\n\nconst SECRET = process.env.NEBULA_SECRET || 'dev-only-secret';\n\nexport function signToken(payload, ttlSeconds = 3600) {\n  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })).toString('base64url');\n  const signature = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');\n  return \`\${body}.\${signature}\`;\n}\n\nexport function verifyToken(token) {\n  const [body, signature] = String(token || '').split('.');\n  if (!body || !signature) return null;\n  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');\n  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;\n  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));\n  return payload.exp > Date.now() ? payload : null;\n}\n`,
  );
  write(
    repo,
    'src/routes/auth.js',
    `import { signToken, verifyToken } from '../lib/token.js';\n\nexport async function issueSession({ body }) {\n  if (!body?.accountId) return { status: 400, body: { error: 'account_required' } };\n  return { status: 200, body: { token: signToken({ sub: body.accountId }) } };\n}\n\nexport async function readSession({ headers }) {\n  const payload = verifyToken(headers.authorization?.replace(/^Bearer /, ''));\n  if (!payload) return { status: 401, body: { error: 'invalid_session' } };\n  return { status: 200, body: { accountId: payload.sub } };\n}\n`,
  );
  write(
    repo,
    'src/server.js',
    `import http from 'node:http';\nimport { health } from './routes/health.js';\nimport { issueSession, readSession } from './routes/auth.js';\n\nconst routes = {\n  'GET /health': health,\n  'POST /v1/session': issueSession,\n  'GET /v1/session': readSession,\n};\n\nconst server = http.createServer(async (request, response) => {\n  const url = new URL(request.url, 'http://localhost');\n  const handler = routes[\`\${request.method} \${url.pathname}\`];\n  if (!handler) {\n    response.writeHead(404, { 'content-type': 'application/json' });\n    response.end(JSON.stringify({ error: 'not_found' }));\n    return;\n  }\n  let body;\n  if (request.method === 'POST') {\n    const chunks = [];\n    for await (const chunk of request) chunks.push(chunk);\n    body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;\n  }\n  const result = await handler({ request, url, body, headers: request.headers });\n  response.writeHead(result.status ?? 200, { 'content-type': 'application/json' });\n  response.end(JSON.stringify(result.body));\n});\n\nconst port = Number(process.env.PORT || 8080);\nserver.listen(port, () => console.log(\`nebula-api listening on :\${port}\`));\n`,
  );
  commit(repo, 'feat(auth): add signed session tokens', {
    author: '陈默',
    email: 'chenmo@example.com',
    date: '2026-09-25T16:12:00+08:00',
  });

  write(
    repo,
    'migrations/001_usage.sql',
    `CREATE TABLE usage_daily (\n  account_id TEXT NOT NULL,\n  day DATE NOT NULL,\n  requests INTEGER NOT NULL DEFAULT 0,\n  PRIMARY KEY (account_id, day)\n);\n\nCREATE INDEX usage_daily_day_idx ON usage_daily (day);\n`,
  );
  write(
    repo,
    'src/lib/usage-store.js',
    `const rows = new Map();\n\nfunction key(accountId, day) {\n  return \`\${accountId}:\${day}\`;\n}\n\nexport function recordUsage(accountId, day, count = 1) {\n  const id = key(accountId, day);\n  rows.set(id, (rows.get(id) || 0) + count);\n}\n\nexport function readUsage(accountId, day) {\n  return rows.get(key(accountId, day)) || 0;\n}\n`,
  );
  write(
    repo,
    'src/routes/usage.js',
    `import { readUsage, recordUsage } from '../lib/usage-store.js';\n\nexport async function ingestUsage({ body }) {\n  if (!body?.accountId || !body?.day) {\n    return { status: 400, body: { error: 'account_and_day_required' } };\n  }\n  recordUsage(body.accountId, body.day, body.count ?? 1);\n  return { status: 202, body: { accepted: true } };\n}\n\nexport async function getUsage({ url }) {\n  const accountId = url.searchParams.get('accountId');\n  const day = url.searchParams.get('day');\n  if (!accountId || !day) return { status: 400, body: { error: 'missing_query' } };\n  return { status: 200, body: { accountId, day, requests: readUsage(accountId, day) } };\n}\n`,
  );
  commit(repo, 'feat(usage): aggregate daily request counts', {
    author: 'Aria Chen',
    email: 'aria@example.com',
    date: '2026-10-01T12:03:00+08:00',
  });

  write(
    repo,
    'src/lib/rate-limit.js',
    `const buckets = new Map();\n\nexport function checkRateLimit(apiKey, limit = 60) {\n  const now = Date.now();\n  const bucket = buckets.get(apiKey) ?? [];\n  const recent = bucket.filter((timestamp) => now - timestamp < 60_000);\n  if (recent.length >= limit) {\n    return { allowed: false, remaining: 0, retryAfter: Math.ceil((60_000 - (now - recent[0])) / 1000) };\n  }\n  recent.push(now);\n  buckets.set(apiKey, recent);\n  return { allowed: true, remaining: limit - recent.length };\n}\n`,
  );
  write(
    repo,
    'test/rate-limit.test.js',
    `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { checkRateLimit } from '../src/lib/rate-limit.js';\n\ntest('rate limit rejects after configured threshold', () => {\n  const key = 'account-' + Math.random();\n  for (let index = 0; index < 3; index += 1) {\n    assert.equal(checkRateLimit(key, 3).allowed, true);\n  }\n  const blocked = checkRateLimit(key, 3);\n  assert.equal(blocked.allowed, false);\n  assert.equal(blocked.remaining, 0);\n});\n`,
  );
  commit(repo, 'fix(rate-limit): use sliding window per API key', {
    author: '陈默',
    email: 'chenmo@example.com',
    date: '2026-10-06T09:18:00+08:00',
  });

  write(
    repo,
    'test/token.test.js',
    `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { signToken, verifyToken } from '../src/lib/token.js';\n\ntest('token round-trips an account id', () => {\n  const token = signToken({ sub: 'acct_42' });\n  assert.equal(verifyToken(token).sub, 'acct_42');\n});\n\ntest('tampered token is rejected', () => {\n  const token = signToken({ sub: 'acct_42' });\n  assert.equal(verifyToken(token + 'x'), null);\n});\n\ntest('expired token is rejected', () => {\n  const token = signToken({ sub: 'acct_42' }, -1);\n  assert.equal(verifyToken(token), null);\n});\n`,
  );
  commit(repo, 'test: cover token rotation and expiry', {
    author: 'Aria Chen',
    email: 'aria@example.com',
    date: '2026-10-11T14:41:00+08:00',
  });

  write(
    repo,
    'Dockerfile',
    `FROM node:22-alpine\nWORKDIR /app\nCOPY package.json ./\nCOPY src ./src\nCOPY migrations ./migrations\nEXPOSE 8080\nCMD ["node", "src/server.js"]\n`,
  );
  write(repo, '.dockerignore', `node_modules\ntest\n.env\n.git\n`);
  write(
    repo,
    'package.json',
    JSON.stringify(
      {
        name: 'nebula-api',
        private: true,
        version: '0.8.0',
        type: 'module',
        scripts: { start: 'node src/server.js', test: 'node --test' },
        engines: { node: '>=22' },
      },
      null,
      2,
    ) + '\n',
  );
  commit(repo, 'chore(release): v0.8.0', {
    author: '陈默',
    email: 'chenmo@example.com',
    date: '2026-10-16T17:52:00+08:00',
  });
  tag(repo, 'v0.8.0', 'Nebula API 0.8.0', {
    author: '陈默',
    email: 'chenmo@example.com',
    date: '2026-10-16T17:55:00+08:00',
  });

  write(
    repo,
    'src/lib/usage-store.js',
    `const rows = new Map();\nlet pending = [];\nlet timer = null;\n\nfunction key(accountId, day) {\n  return \`\${accountId}:\${day}\`;\n}\n\nfunction flush() {\n  for (const { accountId, day, count } of pending) {\n    const id = key(accountId, day);\n    rows.set(id, (rows.get(id) || 0) + count);\n  }\n  pending = [];\n  timer = null;\n}\n\nexport function recordUsage(accountId, day, count = 1) {\n  pending.push({ accountId, day, count });\n  if (!timer) timer = setTimeout(flush, 250);\n}\n\nexport function readUsage(accountId, day) {\n  if (pending.length) flush();\n  return rows.get(key(accountId, day)) || 0;\n}\n\nexport function pendingWrites() {\n  return pending.length;\n}\n`,
  );
  commit(repo, 'perf: batch usage writes every 250ms', {
    author: '林未',
    email: 'linwei@example.com',
    date: '2026-10-22T10:07:00+08:00',
  });

  git(repo, ['switch', '-q', '-c', 'feat/webhooks']);
  write(
    repo,
    'src/lib/webhook-signature.js',
    `import crypto from 'node:crypto';\n\nexport function verifyStripeSignature(payload, signature, secret, toleranceSeconds = 300) {\n  const parts = Object.fromEntries(\n    String(signature || '')\n      .split(',')\n      .map((part) => part.split('='))\n      .filter((pair) => pair.length === 2),\n  );\n  if (!parts.t || !parts.v1) return false;\n  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSeconds) return false;\n  const expected = crypto.createHmac('sha256', secret).update(\`\${parts.t}.\${payload}\`).digest('hex');\n  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));\n}\n`,
  );
  write(
    repo,
    'src/routes/webhooks.js',
    `import { verifyStripeSignature } from '../lib/webhook-signature.js';\n\nexport async function stripeWebhook({ headers, rawBody }) {\n  const valid = verifyStripeSignature(rawBody, headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);\n  if (!valid) return { status: 400, body: { error: 'invalid_signature' } };\n  return { status: 200, body: { received: true } };\n}\n`,
  );
  write(
    repo,
    'test/webhook.test.js',
    `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport crypto from 'node:crypto';\nimport { verifyStripeSignature } from '../src/lib/webhook-signature.js';\n\ntest('rejects a stale signature', () => {\n  assert.equal(verifyStripeSignature('{}', 't=1,v1=deadbeef', 'secret'), false);\n});\n\ntest('accepts a freshly signed payload', () => {\n  const secret = 'whsec_test';\n  const timestamp = Math.floor(Date.now() / 1000);\n  const signature = crypto.createHmac('sha256', secret).update(\`\${timestamp}.{}\`).digest('hex');\n  assert.equal(verifyStripeSignature('{}', \`t=\${timestamp},v1=\${signature}\`, secret), true);\n});\n`,
  );
  commit(repo, 'feat(webhooks): verify Stripe signatures', {
    author: 'Aria Chen',
    email: 'aria@example.com',
    date: '2026-10-24T15:29:00+08:00',
  });
  git(repo, ['switch', '-q', 'main']);

  console.log('built demo/nebula-api');
  console.log('  clean working tree');
}

fs.mkdirSync(demoRoot, { recursive: true });
buildAurora();
buildNebula();
console.log('\nDemo repositories ready in demo/');
