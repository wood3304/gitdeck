export class ApiError extends Error {
  constructor(message, { status = 0, code = 'api_error', detail = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

async function request(path, options = {}) {
  const { method = 'GET', body, signal } = options;
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('无法连接 GitDeck 服务，请确认本地服务仍在运行', {
      code: 'network_error',
      detail: error.message,
    });
  }
  const contentType = response.headers.get('content-type') || '';
  let payload = null;
  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => null);
  } else {
    const text = await response.text().catch(() => '');
    payload = text ? { raw: text } : null;
  }
  if (!response.ok) {
    const error = payload?.error || {};
    throw new ApiError(error.message || `请求失败（HTTP ${response.status}）`, {
      status: response.status,
      code: error.code || 'http_error',
      detail: error.detail || payload?.raw || '',
    });
  }
  return payload;
}

const repoBase = (id) => `/repos/${encodeURIComponent(id)}`;

export const api = {
  health: () => request('/health'),

  listRepos: () => request('/repos'),
  addRepo: (path) => request('/repos', { method: 'POST', body: { path } }),
  removeRepo: (id) => request(`/repos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setActiveRepo: (id) => request('/repos/active', { method: 'POST', body: { id } }),
  repoSummary: (id) => request(`${repoBase(id)}/summary`),

  status: (id, signal) => request(`${repoBase(id)}/status`, { signal }),
  log: (id, params, signal) => request(`${repoBase(id)}/log${buildQuery(params)}`, { signal }),
  commitDetail: (id, hash, signal) =>
    request(`${repoBase(id)}/commits/${encodeURIComponent(hash)}`, { signal }),
  diff: (id, params, signal) => request(`${repoBase(id)}/diff${buildQuery(params)}`, { signal }),
  compare: (id, params, signal) =>
    request(`${repoBase(id)}/compare${buildQuery(params)}`, { signal }),
  fileHistory: (id, params, signal) =>
    request(`${repoBase(id)}/file-history${buildQuery(params)}`, { signal }),
  fileContent: (id, params, signal) =>
    request(`${repoBase(id)}/file-content${buildQuery(params)}`, { signal }),
  files: (id, query, signal) =>
    request(`${repoBase(id)}/files${buildQuery({ q: query })}`, { signal }),
  branches: (id, signal) => request(`${repoBase(id)}/branches`, { signal }),

  checkout: (id, body) => request(`${repoBase(id)}/checkout`, { method: 'POST', body }),
  stage: (id, paths) => request(`${repoBase(id)}/stage`, { method: 'POST', body: { paths } }),
  unstage: (id, paths) => request(`${repoBase(id)}/unstage`, { method: 'POST', body: { paths } }),
  discard: (id, paths) => request(`${repoBase(id)}/discard`, { method: 'POST', body: { paths } }),
  commit: (id, body) => request(`${repoBase(id)}/commit`, { method: 'POST', body }),
  fetch: (id) => request(`${repoBase(id)}/fetch`, { method: 'POST', body: {} }),
  reveal: (id, path) => request(`${repoBase(id)}/reveal`, { method: 'POST', body: { path } }),

  browse: (path, signal) => request(`/fs${buildQuery({ path })}`, { signal }),
  scan: (path, depth = 2) => request('/scan', { method: 'POST', body: { path, depth } }),
  resolve: (path, signal) => request(`/resolve${buildQuery({ path })}`, { signal }),
};
