const API = '/api';
const TOKEN_KEY = 'writer_token';
const USER_KEY = 'writer_user';

let state = {
  user: null, token: null,
  articles: [], folders: [], article: null,
  isDirty: false, isPreview: false,
  selectedId: null, selectedFolderId: null,
  saveTimer: null, allTags: [],
};

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}
function setUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }
function clearAuth() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }

function $(id) { return document.getElementById(id); }

async function api(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (res.status === 401) { clearAuth(); authUI.showAuth(); throw new Error('Unauthorized'); }
  return res;
}

// ─── Auth ─────────────────────────────────────────────

const authUI = {
  init() {
    const token = getToken(), user = getUser();
    if (token && user) { state.token = token; state.user = user; this.showApp(); }
    else this.showAuth();
  },
  showAuth() { $('authScreen').classList.remove('hidden'); $('app').classList.add('hidden'); },
  showApp() {
    $('authScreen').classList.add('hidden'); $('app').classList.remove('hidden');
    $('userInfo').textContent = state.user?.username || '';
    app.init();
  },
  switchTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    $('loginForm').classList.toggle('hidden', tab !== 'login');
    $('registerForm').classList.toggle('hidden', tab !== 'register');
    $('loginError').textContent = ''; $('registerError').textContent = '';
  },
  async login(e) {
    e.preventDefault(); const form = e.target;
    const btn = form.querySelector('.btn-auth'); btn.disabled = true; btn.textContent = 'Signing in...';
    try {
      const res = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: form[0].value, password: form[1].value }) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Login failed'); }
      const data = await res.json();
      state.token = data.token; state.user = data.user;
      setToken(data.token); setUser(data.user);
      this.showApp();
    } catch (err) { $('loginError').textContent = err.message; }
    btn.disabled = false; btn.textContent = 'Sign In';
  },
  async register(e) {
    e.preventDefault(); const form = e.target;
    const btn = form.querySelector('.btn-auth'); btn.disabled = true; btn.textContent = 'Creating account...';
    try {
      const res = await api('/auth/register', { method: 'POST', body: JSON.stringify({ username: form[0].value, email: form[1].value, password: form[2].value }) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Registration failed'); }
      const data = await res.json();
      state.token = data.token; state.user = data.user;
      setToken(data.token); setUser(data.user);
      this.showApp();
    } catch (err) { $('registerError').textContent = err.message; }
    btn.disabled = false; btn.textContent = 'Create Account';
  },
  logout() { clearAuth(); state.user = null; state.token = null; this.showAuth(); },
};

// ─── Main App ─────────────────────────────────────────

const app = {
  state,
  async init() {
    await Promise.all([this.loadFolders(), this.loadArticles(), this.loadCategories(), this.loadAllTags()]);
    this.setupKeyboard();
  },

  // ─── Folders ──────────────────────────────────────

  async loadFolders() {
    try {
      const res = await api('/folders'); const data = await res.json();
      state.folders = data.flat ?? [];
      this.renderFolderTree(data.tree ?? []);
    } catch (e) {}
  },
  renderFolderTree(tree, container) {
    container = container || $('folderTree'); container.innerHTML = '';
    const allItem = document.createElement('div');
    allItem.className = `folder-item${!state.selectedFolderId ? ' active' : ''}`;
    allItem.innerHTML = '<span class="folder-icon">&#128196;</span><span class="folder-name">All Articles</span>';
    allItem.onclick = () => { state.selectedFolderId = null; this.loadArticles(); this.renderFolderTree(); };
    container.appendChild(allItem);
    this._renderFolderNodes(tree, container, 0);
  },
  _renderFolderNodes(nodes, container, depth) {
    for (const node of nodes) {
      const div = document.createElement('div');
      div.className = `folder-item${node.id === state.selectedFolderId ? ' active' : ''}`;
      div.style.paddingLeft = `${8 + depth * 16}px`;
      const hasChildren = node.children && node.children.length > 0;
      div.innerHTML = `<span class="folder-icon">${hasChildren ? '&#128193;' : '&#128196;'}</span><span class="folder-name">${this.escapeHtml(node.name)}</span><span class="folder-count">${node.article_count ?? 0}</span><span class="folder-item-actions"><button onclick="event.stopPropagation();app.renameFolder('${node.id}')" title="Rename">&#9998;</button><button onclick="event.stopPropagation();app.deleteFolderConfirm('${node.id}')" title="Delete">&#10005;</button></span>`;
      div.onclick = () => { state.selectedFolderId = node.id; this.loadArticles(); this.renderFolderTree(); };
      container.appendChild(div);
      if (hasChildren) this._renderFolderNodes(node.children, container, depth + 1);
    }
  },
  async newFolder() {
    const name = prompt('Folder name:'); if (!name) return;
    try {
      const res = await api('/folders', { method: 'POST', body: JSON.stringify({ name, parent_id: state.selectedFolderId || null }) });
      if (res.ok) { await this.loadFolders(); this.showToast('Folder created', 'success'); }
    } catch (e) { this.showToast('Failed', 'error'); }
  },
  async renameFolder(id) {
    const folder = state.folders.find(f => f.id === id);
    const name = prompt('New name:', folder?.name || ''); if (!name) return;
    try { const res = await api(`/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }); if (res.ok) { await this.loadFolders(); this.showToast('Renamed', 'success'); } } catch (e) { this.showToast('Failed', 'error'); }
  },
  async deleteFolderConfirm(id) {
    const folder = state.folders.find(f => f.id === id);
    if (!confirm(`Delete folder "${folder?.name}"?`)) return;
    try { const res = await api(`/folders/${id}`, { method: 'DELETE' }); if (res.ok) { if (state.selectedFolderId === id) state.selectedFolderId = null; await this.loadFolders(); await this.loadArticles(); this.showToast('Deleted', 'success'); } } catch (e) { this.showToast('Failed', 'error'); }
  },
  showFolderPicker() {
    $('folderModal').classList.remove('hidden');
    const list = $('folderPickerList'); list.innerHTML = '<div class="folder-picker-item" onclick="app.moveToFolder(null)">No folder</div>';
    for (const f of state.folders) {
      const div = document.createElement('div'); div.className = 'folder-picker-item';
      div.textContent = f.name; div.onclick = () => this.moveToFolder(f.id); list.appendChild(div);
    }
  },
  hideFolderPicker() { $('folderModal').classList.add('hidden'); },
  async moveToFolder(folderId) {
    if (!state.selectedId) return;
    try { const res = await api(`/articles/${state.selectedId}`, { method: 'PUT', body: JSON.stringify({ folder_id: folderId }) }); if (res.ok) { state.article = await res.json(); state.isDirty = false; await this.loadFolders(); await this.loadArticles(); this.hideFolderPicker(); this.showToast('Moved', 'success'); } } catch (e) { this.showToast('Failed', 'error'); }
  },

  // ─── Articles ──────────────────────────────────────

  async loadArticles() {
    try {
      const params = new URLSearchParams({ pageSize: '100' });
      if (state.selectedFolderId) params.set('folderId', state.selectedFolderId);
      const res = await api(`/articles?${params}`); const data = await res.json();
      state.articles = data.data ?? data; this.renderList();
    } catch (e) {}
  },
  async loadCategories() {
    try { const res = await api('/categories'); const cats = await res.json(); const select = $('categorySelect'); select.innerHTML = '<option value="">No Category</option>'; for (const cat of cats) { const opt = document.createElement('option'); opt.value = cat.id; opt.textContent = cat.name; select.appendChild(opt); } } catch (e) {}
  },
  async loadAllTags() { try { const res = await api('/tags'); state.allTags = await res.json(); } catch (e) {} },
  async newArticle() {
    try {
      const body = {}; if (state.selectedFolderId) body.folder_id = state.selectedFolderId;
      const res = await api('/articles', { method: 'POST', body: JSON.stringify(body) });
      const article = await res.json(); state.articles.unshift(article); this.renderList(); this.selectArticle(article.id);
    } catch (e) { this.showToast('Failed to create article', 'error'); }
  },
  async selectArticle(id) {
    if (state.isDirty && !confirm('You have unsaved changes. Discard them?')) return;
    state.selectedId = id; state.isDirty = false; state.isPreview = false;
    $('previewBtn').classList.remove('active'); $('preview').classList.add('hidden'); $('contentInput').classList.remove('hidden');
    try { const res = await api(`/articles/${id}`); if (!res.ok) throw new Error(); state.article = await res.json(); this.renderEditor(); this.renderList(); } catch (e) { this.showToast('Failed to load article', 'error'); }
  },
  async saveArticle() {
    if (!state.selectedId) return;
    const article = { title: $('titleInput').value, content: $('contentInput').value, excerpt: $('contentInput').value.slice(0, 200), status: $('statusSelect').value, category_id: $('categorySelect').value || null, tag_ids: state.article?.tags?.map(t => t.id) || [] };
    try { const res = await api(`/articles/${state.selectedId}`, { method: 'PUT', body: JSON.stringify(article) }); if (!res.ok) throw new Error(); state.article = await res.json(); state.isDirty = false; const idx = state.articles.findIndex(a => a.id === state.selectedId); if (idx >= 0) state.articles[idx] = { ...state.articles[idx], ...state.article }; this.renderList(); this.renderTags(); this.showToast('Saved', 'success'); $('saveStatus').textContent = ''; } catch (e) { this.showToast('Failed to save', 'error'); }
  },
  async deleteArticle(id) {
    if (!confirm('Delete this article?')) return;
    try { await api(`/articles/${id}`, { method: 'DELETE' }); state.articles = state.articles.filter(a => a.id !== id); if (state.selectedId === id) { state.article = null; state.selectedId = null; this.renderEditor(); } this.renderList(); this.showToast('Deleted', 'success'); } catch (e) { this.showToast('Failed to delete', 'error'); }
  },
  async search(query) {
    try { const params = new URLSearchParams({ search: query, pageSize: '50' }); const res = await api(`/articles?${params}`); const data = await res.json(); state.articles = data.data ?? data; this.renderList(); } catch (e) {}
  },

  onStatusChange() { state.isDirty = true; this.autoSave(); },
  onCategoryChange() { state.isDirty = true; this.autoSave(); },
  onTitleChange() { state.isDirty = true; this.autoSave(); if (state.selectedId) { const item = state.articles.find(a => a.id === state.selectedId); if (item) item.title = $('titleInput').value || 'Untitled'; this.renderList(); } },
  onContentChange() { state.isDirty = true; this.autoSave(); this.updateWordCount(); },

  // ─── Tags ──────────────────────────────────────────

  renderTags() {
    const list = $('tagsList'); list.innerHTML = '';
    for (const tag of (state.article?.tags || [])) {
      const chip = document.createElement('span'); chip.className = 'tag-chip';
      chip.innerHTML = `${this.escapeHtml(tag.name)}<span class="tag-remove" onclick="app.removeTag('${tag.id}')">&times;</span>`;
      list.appendChild(chip);
    }
  },
  async onTagKeydown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault(); const input = $('tagInput'); const name = input.value.trim(); if (!name) return; input.value = '';
    let tag = state.allTags.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (!tag) {
      const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]/g, '');
      try { const res = await api('/tags', { method: 'POST', body: JSON.stringify({ name, slug }) }); if (res.ok) tag = await res.json(); else return; } catch (e) { return; }
      state.allTags.push(tag);
    }
    const tags = state.article?.tags || [];
    if (tags.some(t => t.id === tag.id)) return;
    tags.push(tag); state.article.tags = tags; state.isDirty = true; this.renderTags(); this.autoSave();
  },
  removeTag(tagId) {
    if (!state.article?.tags) return;
    state.article.tags = state.article.tags.filter(t => t.id !== tagId);
    state.isDirty = true; this.renderTags(); this.autoSave();
  },

  // ─── Preview ──────────────────────────────────────

  togglePreview() {
    state.isPreview = !state.isPreview;
    $('previewBtn').classList.toggle('active', state.isPreview);
    if (state.isPreview) {
      $('preview').classList.remove('hidden'); $('contentInput').classList.add('hidden');
      $('preview').innerHTML = window.marked ? marked.parse($('contentInput').value) : $('contentInput').value;
    } else { $('preview').classList.add('hidden'); $('contentInput').classList.remove('hidden'); }
  },

  // ─── Renderers ────────────────────────────────────

  renderList() {
    const list = $('articleList'); list.innerHTML = '';
    for (const article of state.articles) {
      const div = document.createElement('div'); div.className = `article-item${article.id === state.selectedId ? ' active' : ''}`;
      div.innerHTML = `<div class="article-title">${this.escapeHtml(article.title || 'Untitled')}</div><div class="article-meta"><span>${new Date(article.updated_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</span>${article.status === 'published' ? '<span class="article-status published">Published</span>' : '<span class="article-status">Draft</span>'}</div>`;
      div.onclick = () => this.selectArticle(article.id); list.appendChild(div);
    }
  },
  renderEditor() {
    if (!state.article) { $('emptyState').classList.remove('hidden'); $('editorContent').classList.add('hidden'); return; }
    $('emptyState').classList.add('hidden'); $('editorContent').classList.remove('hidden');
    $('titleInput').value = state.article.title || ''; $('contentInput').value = state.article.content || '';
    $('statusSelect').value = state.article.status || 'draft'; $('categorySelect').value = state.article.category_id || '';
    this.renderTags(); this.updateWordCount(); state.isDirty = false; $('saveStatus').textContent = '';
  },
  updateWordCount() {
    const text = $('contentInput').value; const words = text.trim() ? text.trim().split(/\s+/).length : 0; const chars = text.length;
    $('wordCount').textContent = chars > 0 ? `${words} words · ${chars} chars` : '0 words';
  },

  autoSave() { if (state.saveTimer) clearTimeout(state.saveTimer); $('saveStatus').textContent = 'Unsaved...'; state.saveTimer = setTimeout(() => this.saveArticle(), 2000); },
  setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      const mod = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 's') { e.preventDefault(); this.saveArticle(); }
      if (mod && e.key === 'p') { e.preventDefault(); this.togglePreview(); }
      if (mod && e.key === 'n') { e.preventDefault(); this.newArticle(); }
    });
  },
  showToast(msg, type = '') { const toast = $('toast'); toast.textContent = msg; toast.className = 'toast ' + type + ' show'; setTimeout(() => toast.classList.remove('show'), 2500); },
  escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; },
};

document.addEventListener('DOMContentLoaded', () => authUI.init());
