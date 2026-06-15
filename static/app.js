const API = '/api';
const TOKEN_KEY = 'writer_token';
const USER_KEY = 'writer_user';

let state = {
  user: null, token: null,
  articles: [], folders: [], article: null,
  isDirty: false, isPreview: false,
  selectedId: null, selectedFolderId: null,
  saveTimer: null, allTags: [],
  expandedFolders: new Set(), // folder ids that are expanded
};

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } }
function setUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }
function clearAuth() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }

function $(id) { return document.getElementById(id); }
function q(sel, ctx) { return (ctx || document).querySelector(sel); }
function qa(sel, ctx) { return (ctx || document).querySelectorAll(sel); }

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
    qa('.auth-tab').forEach(t => t.classList.remove('active'));
    q(`[data-tab="${tab}"]`).classList.add('active');
    $('loginForm').classList.toggle('hidden', tab !== 'login');
    $('registerForm').classList.toggle('hidden', tab !== 'register');
    $('loginError').textContent = ''; $('registerError').textContent = '';
  },
  async login(e) {
    e.preventDefault(); const form = e.target;
    const btn = form.querySelector('.btn-auth'); btn.disabled = true; btn.textContent = 'Signing in...';
    try {
      const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: form[0].value, password: form[1].value }) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Login failed'); }
      const d = await r.json();
      state.token = d.token; state.user = d.user; setToken(d.token); setUser(d.user);
      this.showApp();
    } catch (err) { $('loginError').textContent = err.message; }
    btn.disabled = false; btn.textContent = 'Sign In';
  },
  async register(e) {
    e.preventDefault(); const form = e.target;
    const btn = form.querySelector('.btn-auth'); btn.disabled = true; btn.textContent = 'Creating account...';
    try {
      const r = await api('/auth/register', { method: 'POST', body: JSON.stringify({ username: form[0].value, email: form[1].value, password: form[2].value }) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Registration failed'); }
      const d = await r.json();
      state.token = d.token; state.user = d.user; setToken(d.token); setUser(d.user);
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

  // ─── Data Loading ──────────────────────────────────

  async loadFolders() {
    try { const r = await api('/folders'); const d = await r.json(); state.folders = d.flat ?? []; } catch (e) {}
  },
  async loadArticles() {
    try { const r = await api('/articles?pageSize=500'); const d = await r.json(); state.articles = d.data ?? d; this.renderTree(); } catch (e) {}
  },
  async loadCategories() {
    try { const r = await api('/categories'); const d = await r.json(); const s = $('categorySelect'); s.innerHTML = '<option value="">No Category</option>'; for (const c of d) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; s.appendChild(o); } } catch (e) {}
  },
  async loadAllTags() { try { state.allTags = await (await api('/tags')).json(); } catch (e) {} },

  // ─── Tree Builder ──────────────────────────────────

  makeFolderNode(folder, children) {
    return { type: 'folder', id: folder.id, name: folder.name, data: folder, children, count: folder.article_count ?? 0 };
  },
  makeArticleNode(article) {
    return { type: 'article', id: article.id, name: article.title || 'Untitled', data: article };
  },

  buildTreeData() {
    const folderMap = {};
    for (const f of state.folders) { folderMap[f.id] = f; }

    // Build article map by folder_id
    const articlesByFolder = {};
    const uncategorized = [];
    for (const a of state.articles) {
      if (a.folder_id) {
        if (!articlesByFolder[a.folder_id]) articlesByFolder[a.folder_id] = [];
        articlesByFolder[a.folder_id].push(a);
      } else {
        uncategorized.push(a);
      }
    }

    // Build folder tree with articles
    function buildFolderChildren(folderId) {
      const children = [];
      const childFolders = state.folders.filter(f => f.parent_id === folderId);
      for (const cf of childFolders) {
        const grandChildren = buildFolderChildren(cf.id);
        children.push(app.makeFolderNode(cf, grandChildren));
      }
      const folderArticles = articlesByFolder[folderId] || [];
      for (const a of folderArticles) {
        children.push(app.makeArticleNode(a));
      }
      return children;
    }

    const topFolders = state.folders.filter(f => !f.parent_id);
    const rootChildren = [];
    for (const tf of topFolders) {
      const sub = buildFolderChildren(tf.id);
      rootChildren.push(app.makeFolderNode(tf, sub));
    }

    // Sort: folders first, then articles
    for (const child of rootChildren) {
      if (child.children) {
        child.children.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      }
    }

    const root = { type: 'root', id: '__all__', name: 'All Articles', children: rootChildren, uncategorized };

    // Add uncategorized articles under a heading
    if (uncategorized.length > 0) {
      uncategorized.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
      for (const a of uncategorized) {
        root.children.push(app.makeArticleNode(a));
      }
    }

    return root;
  },

  // ─── Tree Rendering ───────────────────────────────

  renderTree() {
    const tree = this.buildTreeData();
    const container = $('treeView');
    container.innerHTML = '';
    this._renderNode(tree, container, 0);
    this._scrollToActive();
  },

  _renderNode(node, container, depth) {
    if (node.type === 'root') {
      const row = document.createElement('div');
      row.className = 'tree-node root';
      row.style.paddingLeft = '6px';
      row.innerHTML = '<span class="icon">&#128196;</span><span class="label">All Articles</span><span class="meta">' + state.articles.length + '</span>';
      row.onclick = () => { state.selectedFolderId = null; this.loadArticles(); };
      container.appendChild(row);

      const childWrap = document.createElement('div');
      childWrap.className = 'tree-children open';
      container.appendChild(childWrap);

      // First show folder children
      let hasFolderChild = false;
      for (const child of node.children) {
        if (child.type === 'folder') {
          hasFolderChild = true;
          this._renderNode(child, childWrap, depth + 1);
        }
      }

      // Then show root-level articles (uncategorized)
      for (const child of node.children) {
        if (child.type === 'article') {
          this._renderNode(child, childWrap, depth + 1);
        }
      }
      return;
    }

    const isFolder = node.type === 'folder';
    const isArticle = node.type === 'article';
    const isActive = isArticle
      ? node.id === state.selectedId
      : isFolder && node.id === state.selectedFolderId;
    const isExpanded = isFolder && state.expandedFolders.has(node.id);
    const hasChildren = isFolder && node.children && node.children.length > 0;

    const row = document.createElement('div');
    row.className = 'tree-node ' + node.type + (isActive ? ' active' : '');
    row.style.paddingLeft = (depth * 16 + 6) + 'px';
    row.dataset.id = node.id;

    // Toggle arrow
    const toggle = document.createElement('span');
    if (isFolder && hasChildren) {
      toggle.className = 'toggle' + (isExpanded ? ' expanded' : '');
      toggle.textContent = '\u25B6';
      toggle.onclick = (e) => { e.stopPropagation(); this.toggleFolder(node.id); };
    } else {
      toggle.className = 'toggle spacer';
      toggle.textContent = '\u25B6';
    }
    row.appendChild(toggle);

    // Icon
    const icon = document.createElement('span');
    icon.className = 'icon';
    if (isFolder) {
      icon.textContent = isExpanded ? '\uD83D\uDCC2' : '\uD83D\uDCC1';  // open/closed folder
    } else {
      icon.textContent = '\uD83D\uDCC4';  // document
    }
    row.appendChild(icon);

    // Label
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = node.name;
    row.appendChild(label);

    // Meta
    if (isFolder && node.count > 0) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = node.count;
      row.appendChild(meta);
    }

    if (isArticle) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = node.data.status === 'published' ? 'Published' : 'Draft';
      row.appendChild(meta);
    }

    // Actions (folders only)
    if (isFolder) {
      const acts = document.createElement('span');
      acts.className = 'node-actions';
      acts.innerHTML = '<button onclick="event.stopPropagation();app.renameFolder(\'' + node.id + '\')" title="Rename">\u270E</button><button onclick="event.stopPropagation();app.deleteFolderConfirm(\'' + node.id + '\')" title="Delete">\u2715</button>';
      row.appendChild(acts);
    }

    // Click handler
    if (isFolder) {
      row.onclick = () => {
        state.selectedFolderId = node.id;
        this.loadArticles();
      };
    } else if (isArticle) {
      row.onclick = () => this.selectArticle(node.id);
    }

    container.appendChild(row);

    // Children
    if (isFolder) {
      const childWrap = document.createElement('div');
      childWrap.className = 'tree-children' + (isExpanded ? ' open' : '');
      container.appendChild(childWrap);
      if (isExpanded && node.children) {
        for (const child of node.children) {
          this._renderNode(child, childWrap, depth + 1);
        }
      }
    }
  },

  toggleFolder(id) {
    if (state.expandedFolders.has(id)) {
      state.expandedFolders.delete(id);
    } else {
      state.expandedFolders.add(id);
    }
    this.renderTree();
  },

  _scrollToActive() {
    const active = q('.tree-node.active', $('treeView'));
    if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },

  // ─── Folder Operations ────────────────────────────

  async newFolder() {
    const name = prompt('Folder name:'); if (!name) return;
    try {
      const r = await api('/folders', { method: 'POST', body: JSON.stringify({ name, parent_id: state.selectedFolderId || null }) });
      if (r.ok) { await this.loadFolders(); this.renderTree(); this.showToast('Folder created', 'success'); }
    } catch (e) { this.showToast('Failed', 'error'); }
  },
  async renameFolder(id) {
    const folder = state.folders.find(f => f.id === id);
    const name = prompt('New name:', folder?.name || ''); if (!name) return;
    try { const r = await api(`/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }); if (r.ok) { await this.loadFolders(); this.renderTree(); this.showToast('Renamed', 'success'); } } catch (e) { this.showToast('Failed', 'error'); }
  },
  async deleteFolderConfirm(id) {
    const folder = state.folders.find(f => f.id === id);
    if (!confirm(`Delete folder "${folder?.name}"?`)) return;
    try { const r = await api(`/folders/${id}`, { method: 'DELETE' }); if (r.ok) { if (state.selectedFolderId === id) state.selectedFolderId = null; state.expandedFolders.delete(id); await this.loadFolders(); await this.loadArticles(); this.showToast('Deleted', 'success'); } } catch (e) { this.showToast('Failed', 'error'); }
  },

  showFolderPicker() {
    $('folderModal').classList.remove('hidden');
    const list = $('folderPickerList'); list.innerHTML = '<div class="folder-picker-item" onclick="app.moveToFolder(null)">No folder</div>';
    for (const f of state.folders) {
      const d = document.createElement('div'); d.className = 'folder-picker-item'; d.textContent = f.name; d.onclick = () => this.moveToFolder(f.id); list.appendChild(d);
    }
  },
  hideFolderPicker() { $('folderModal').classList.add('hidden'); },
  async moveToFolder(folderId) {
    if (!state.selectedId) return;
    try { const r = await api(`/articles/${state.selectedId}`, { method: 'PUT', body: JSON.stringify({ folder_id: folderId }) }); if (r.ok) { state.article = await r.json(); state.isDirty = false; await this.loadFolders(); await this.loadArticles(); this.hideFolderPicker(); this.showToast('Moved', 'success'); } } catch (e) { this.showToast('Failed', 'error'); }
  },

  // ─── Article Operations ──────────────────────────

  async newArticle() {
    try {
      const body = {}; if (state.selectedFolderId) body.folder_id = state.selectedFolderId;
      const r = await api('/articles', { method: 'POST', body: JSON.stringify(body) });
      const a = await r.json(); state.articles.unshift(a); this.renderTree(); this.selectArticle(a.id);
    } catch (e) { this.showToast('Failed to create article', 'error'); }
  },
  async selectArticle(id) {
    if (state.isDirty && !confirm('You have unsaved changes. Discard them?')) return;
    state.selectedId = id; state.isDirty = false; state.isPreview = false;
    $('previewBtn').classList.remove('active'); $('preview').classList.add('hidden'); $('contentInput').classList.remove('hidden');
    try { const r = await api(`/articles/${id}`); if (!r.ok) throw new Error(); state.article = await r.json(); this.renderEditor(); this.renderTree(); } catch (e) { this.showToast('Failed to load article', 'error'); }
  },
  async saveArticle() {
    if (!state.selectedId) return;
    const a = { title: $('titleInput').value, content: $('contentInput').value, excerpt: $('contentInput').value.slice(0, 200), status: $('statusSelect').value, category_id: $('categorySelect').value || null, tag_ids: state.article?.tags?.map(t => t.id) || [] };
    try { const r = await api(`/articles/${state.selectedId}`, { method: 'PUT', body: JSON.stringify(a) }); if (!r.ok) throw new Error(); state.article = await r.json(); state.isDirty = false; const idx = state.articles.findIndex(x => x.id === state.selectedId); if (idx >= 0) state.articles[idx] = { ...state.articles[idx], ...state.article }; this.renderTree(); this.renderTags(); this.showToast('Saved', 'success'); $('saveStatus').textContent = ''; } catch (e) { this.showToast('Failed to save', 'error'); }
  },
  async deleteArticle(id) {
    if (!confirm('Delete this article?')) return;
    try { await api(`/articles/${id}`, { method: 'DELETE' }); state.articles = state.articles.filter(a => a.id !== id); if (state.selectedId === id) { state.article = null; state.selectedId = null; this.renderEditor(); } this.renderTree(); this.showToast('Deleted', 'success'); } catch (e) { this.showToast('Failed to delete', 'error'); }
  },
  async search(query) {
    try { const p = new URLSearchParams({ search: query, pageSize: '50' }); const r = await api(`/articles?${p}`); const d = await r.json(); state.articles = d.data ?? d; this.renderTree(); } catch (e) {}
  },

  onStatusChange() { state.isDirty = true; this.autoSave(); },
  onCategoryChange() { state.isDirty = true; this.autoSave(); },
  onTitleChange() { state.isDirty = true; this.autoSave(); if (state.selectedId) { const item = state.articles.find(a => a.id === state.selectedId); if (item) item.title = $('titleInput').value || 'Untitled'; this.renderTree(); } },
  onContentChange() { state.isDirty = true; this.autoSave(); this.updateWordCount(); },

  // ─── Tags ──────────────────────────────────────────

  renderTags() {
    const list = $('tagsList'); list.innerHTML = '';
    for (const tag of (state.article?.tags || [])) {
      const c = document.createElement('span'); c.className = 'tag-chip';
      c.innerHTML = this.escapeHtml(tag.name) + '<span class="tag-remove" onclick="app.removeTag(\'' + tag.id + '\')">&times;</span>';
      list.appendChild(c);
    }
  },
  async onTagKeydown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault(); const inp = $('tagInput'); const name = inp.value.trim(); if (!name) return; inp.value = '';
    let tag = state.allTags.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (!tag) {
      const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]/g, '');
      try { const r = await api('/tags', { method: 'POST', body: JSON.stringify({ name, slug }) }); if (r.ok) tag = await r.json(); else return; } catch (e) { return; }
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

  // ─── Editor ───────────────────────────────────────

  renderEditor() {
    if (!state.article) { $('emptyState').classList.remove('hidden'); $('editorContent').classList.add('hidden'); return; }
    $('emptyState').classList.add('hidden'); $('editorContent').classList.remove('hidden');
    $('titleInput').value = state.article.title || ''; $('contentInput').value = state.article.content || '';
    $('statusSelect').value = state.article.status || 'draft'; $('categorySelect').value = state.article.category_id || '';
    this.renderTags(); this.updateWordCount(); state.isDirty = false; $('saveStatus').textContent = '';
  },
  updateWordCount() {
    const t = $('contentInput').value; const w = t.trim() ? t.trim().split(/\s+/).length : 0; const c = t.length;
    $('wordCount').textContent = c > 0 ? w + ' words · ' + c + ' chars' : '0 words';
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
  showToast(msg, type = '') { const t = $('toast'); t.textContent = msg; t.className = 'toast ' + type + ' show'; setTimeout(() => t.classList.remove('show'), 2500); },
  escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; },
};

document.addEventListener('DOMContentLoaded', () => authUI.init());
