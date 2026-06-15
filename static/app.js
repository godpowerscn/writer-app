const API = '/api';
const TOKEN_KEY = 'writer_token';
const USER_KEY = 'writer_user';

let state = {
  user: null, token: null,
  articles: [], folders: [], article: null,
  isDirty: false, isPreview: false,
  selectedId: null, selectedFolderId: null,
  saveTimer: null, allTags: [],
  expandedFolders: new Set(),
  fonts: [], activeFontId: null,
  activeTagId: null, activeTagName: null,
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
    await Promise.all([this.loadFolders(), this.loadArticles(), this.loadCategories(), this.loadAllTags(), this.loadFonts()]);
    this.setupDragDrop();
    this.setupKeyboard();
    this.setupContentEditable();
  },

  // ─── Drag & Drop ──────────────────────────────

  _dragState: { type: null, id: null },

  setupDragDrop() {
    const tree = $('treeView');
    if (tree._dd) return;
    tree._dd = true;

    tree.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.tree-node');
      if (!row || row.dataset.type === 'root') { e.preventDefault(); return; }
      this._dragState.type = row.dataset.type;
      this._dragState.id = row.dataset.id;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.id);
    });

    tree.addEventListener('dragend', () => {
      this._clearDropIndicators();
      this._dragState.type = null;
      this._dragState.id = null;
    });

    tree.addEventListener('dragover', (e) => {
      e.preventDefault();
      const row = e.target.closest('.tree-node');
      if (!row || row.dataset.id === this._dragState.id) return;
      // Block folder-on-article and article-on-article (different type) from showing indicators
      const dragType = this._dragState.type;
      const dropType = row.dataset.type;
      if (dragType === 'folder' && dropType === 'article') return;
      if (dragType === 'article' && dropType === 'folder') {
        // Only allow dropping INTO folder, not before/after
        this._clearDropIndicators();
        row.classList.add('drag-over');
        return;
      }
      this._clearDropIndicators();
      const rect = row.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const h = rect.height;
      if (dropType === 'root') {
        row.classList.add('drag-over');
      } else if (dropType === 'folder') {
        const t = h * 0.25;
        if (y < t) row.classList.add('drop-before');
        else if (y > h - t) row.classList.add('drop-after');
        else row.classList.add('drag-over');
      } else {
        row.classList.add(y < h / 2 ? 'drop-before' : 'drop-after');
      }
    });

    tree.addEventListener('dragleave', (e) => {
      const row = e.target.closest('.tree-node');
      if (row) row.classList.remove('drag-over', 'drop-before', 'drop-after');
    });

    tree.addEventListener('drop', (e) => this._onDrop(e));
  },

  _clearDropIndicators() {
    qa('.tree-node.dragging, .tree-node.drag-over, .tree-node.drop-before, .tree-node.drop-after', $('treeView'))
      .forEach(el => el.classList.remove('dragging', 'drag-over', 'drop-before', 'drop-after'));
  },

  async _onDrop(e) {
    e.preventDefault();
    this._clearDropIndicators();
    const drag = this._dragState;
    if (!drag.id) return;
    const dropRow = e.target.closest('.tree-node');
    if (!dropRow || dropRow.dataset.id === drag.id) return;

    try {
      const dropType = dropRow.dataset.type;
      const dropId = dropRow.dataset.id;
      const isBefore = dropRow.classList.contains('drop-before');
      const isAfter = dropRow.classList.contains('drop-after');
      const isInto = dropRow.classList.contains('drag-over');

      let moved = false;
      if (drag.type === 'folder') {
        moved = await this._dropFolder(drag.id, dropType, dropId, isBefore, isAfter, isInto);
      } else if (drag.type === 'article') {
        moved = await this._dropArticle(drag.id, dropType, dropId, isBefore, isAfter, isInto);
      }
      if (moved) {
        await Promise.all([this.loadFolders(), this.loadArticles()]);
        this.showToast('Moved', 'success');
      }
    } catch (err) {
      this.showToast('Failed to move', 'error');
    }
  },

  async _dropFolder(dragId, dropType, dropId, isBefore, isAfter, isInto) {
    if (dropType !== 'folder' && dropType !== 'root') return false;
    let newParentId;
    let insertOrder;

    if (dropType === 'root') {
      newParentId = null;
      insertOrder = 9999;
    } else if (isInto) {
      newParentId = dropId;
      const siblings = state.folders.filter(f => f.parent_id === dropId && f.id !== dragId);
      const maxOrder = siblings.reduce((m, f) => Math.max(m, f.sort_order || 0), 0);
      insertOrder = maxOrder + 1;
    } else {
      const target = state.folders.find(f => f.id === dropId);
      if (!target) return false;
      newParentId = target.parent_id;
      const siblings = state.folders.filter(f => f.parent_id === newParentId && f.id !== dragId);
      siblings.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));
      const targetIdx = siblings.findIndex(f => f.id === dropId);
      insertOrder = targetIdx >= 0 ? (isBefore ? targetIdx : targetIdx + 1) : siblings.length;
      siblings.splice(insertOrder, 0, { id: dragId });
      const items = siblings.map((f, i) => ({ id: f.id, parent_id: newParentId, sort_order: i }));
      await api('/folders/reorder', { method: 'POST', body: JSON.stringify({ items }) });
      return true;
    }

    await api(`/folders/${dragId}`, { method: 'PUT', body: JSON.stringify({ parent_id: newParentId, sort_order: insertOrder }) });
    return true;
  },

  async _dropArticle(dragId, dropType, dropId, isBefore, isAfter, isInto) {
    if (dropType !== 'folder' && dropType !== 'root' && dropType !== 'article') return false;
    let newFolderId;
    let insertOrder;

    if (dropType === 'root') {
      newFolderId = null;
      insertOrder = 9999;
    } else if (dropType === 'folder' && isInto) {
      newFolderId = dropId;
      const siblings = state.articles.filter(a => a.folder_id === dropId && a.id !== dragId);
      const maxOrder = siblings.reduce((m, a) => Math.max(m, a.sort_order || 0), 0);
      insertOrder = maxOrder + 1;
    } else {
      let target;
      if (dropType === 'folder') {
        target = { folder_id: state.folders.find(f => f.id === dropId)?.parent_id ?? null };
      } else {
        target = state.articles.find(a => a.id === dropId);
      }
      if (!target) return false;
      newFolderId = target.folder_id ?? null;
      const siblings = state.articles.filter(a => a.folder_id === (newFolderId ?? null) && a.id !== dragId);
      siblings.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (b.updated_at || '').localeCompare(a.updated_at || ''));
      const targetIdx = siblings.findIndex(a => a.id === dropId);
      insertOrder = targetIdx >= 0 ? (isBefore ? targetIdx : targetIdx + 1) : (isBefore ? 0 : siblings.length);
      siblings.splice(insertOrder, 0, { id: dragId });
      const items = siblings.map((a, i) => ({ id: a.id, folder_id: newFolderId, sort_order: i }));
      await api('/articles/reorder', { method: 'POST', body: JSON.stringify({ items }) });
      return true;
    }

    await api(`/articles/${dragId}`, { method: 'PUT', body: JSON.stringify({ folder_id: newFolderId, sort_order: insertOrder }) });
    return true;
  },

  // ─── Data Loading ──────────────────────────────────

  async loadFolders() {
    try { const r = await api('/folders'); const d = await r.json(); state.folders = d.flat ?? []; } catch (e) {}
  },
  async loadArticles() {
    try {
      const p = new URLSearchParams({ pageSize: '500' });
      if (state.activeTagId) p.set('tagId', state.activeTagId);
      const r = await api('/articles?' + p.toString());
      const d = await r.json(); state.articles = d.data ?? d; this.renderTree();
    } catch (e) {}
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
      const labelText = state.activeTagName ? 'Tag: ' + state.activeTagName : 'All Articles';
      row.innerHTML = '<span class="icon">&#128196;</span><span class="label">' + labelText + '</span><span class="meta">' + state.articles.length + '</span>';
      row.onclick = () => { state.selectedFolderId = null; if (state.activeTagId) this.clearTagFilter(); else this.loadArticles(); };
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
    row.style.paddingLeft = (depth * 20 + 8) + 'px';
    row.draggable = true;
    row.dataset.type = node.type;
    row.dataset.id = node.id;
    if (isFolder) row.dataset.parentId = node.data.parent_id || '';
    if (isArticle) row.dataset.folderId = node.data.folder_id || '';

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
    state.selectedId = id; state.isDirty = false;
    try { const r = await api(`/articles/${id}`); if (!r.ok) throw new Error(); state.article = await r.json(); this.renderEditor(); this.renderTree(); } catch (e) { this.showToast('Failed to load article', 'error'); }
  },
  _getMarkdown() {
    const editor = $('contentInput');
    if (!editor.innerHTML || editor.innerHTML === '<br>') return '';
    return this._htmlToMarkdown(editor);
  },

  _htmlToMarkdown(root) {
    const lines = [];
    const walk = (node, prefix) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (text) lines.push(text);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();
      // Collect children text first, then wrap with markers
      const childLines = [];
      const savedLines = lines;
      const childText = () => {
        const start = lines.length;
        for (const child of node.childNodes) walk(child);
        return lines.splice(start).join('').replace(/\s+/g, ' ').trim();
      };

      // Inline elements — push text directly
      if (tag === 'strong' || tag === 'b') { lines.push('**' + childText() + '**'); return; }
      if (tag === 'em' || tag === 'i') { lines.push('*' + childText() + '*'); return; }
      if (tag === 'a') {
        const href = node.getAttribute('href') || '';
        lines.push('[' + childText() + '](' + href + ')');
        return;
      }
      if (tag === 'img') {
        const src = node.getAttribute('src') || '';
        const alt = node.getAttribute('alt') || '';
        const w = node.getAttribute('width') || node.style.width || '';
        const wNum = parseInt(w);
        if (wNum > 0) {
          // Persist custom width as raw HTML (marked passes it through)
          lines.push('<img src="' + src + '" alt="' + alt + '" width="' + wNum + '">');
        } else {
          lines.push('![' + alt + '](' + src + ')');
        }
        return;
      }
      if (tag === 'code') {
        lines.push('`' + (node.textContent || '') + '`');
        return;
      }
      if (tag === 'br') { lines.push('\n'); return; }

      // Block elements — collect sub-lines then append with formatting
      const collectSubLines = () => {
        const start = lines.length;
        const subLines = [];
        let paraAccum = '';
        for (const child of node.childNodes) {
          const beforeLen = lines.length;
          walk(child);
          if (lines.length > beforeLen) {
            // Flush accumulated paragraph text
            if (paraAccum) { subLines.push(paraAccum); paraAccum = ''; }
            subLines.push(lines.splice(beforeLen).join(''));
          } else {
            // It's phrasing content — accumulate
            const text = child.textContent || '';
            if (child.nodeType === Node.TEXT_NODE && text.trim()) {
              paraAccum += text.trim() + ' ';
            }
          }
        }
        if (paraAccum) subLines.push(paraAccum.trim());
        return subLines;
      };

      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
        const level = '#'.repeat(parseInt(tag[1]));
        const t = childText();
        lines.push(level + ' ' + t);
        lines.push('');
        return;
      }
      if (tag === 'p') {
        const t = childText();
        if (t) { lines.push(t); lines.push(''); }
        return;
      }
      if (tag === 'blockquote') {
        const qLines = collectSubLines();
        for (const ql of qLines) lines.push('> ' + ql);
        lines.push('');
        return;
      }
      if (tag === 'ul' || tag === 'ol') {
        let idx = 1;
        for (const li of node.children) {
          if (li.tagName !== 'LI') continue;
          const marker = tag === 'ul' ? '-' : (idx++) + '.';
          // For list items, walk children manually
          const start = lines.length;
          for (const child of li.childNodes) walk(child);
          const itemText = lines.splice(start).join('').replace(/\s+/g, ' ').trim();
          lines.push(marker + ' ' + itemText);
        }
        lines.push('');
        return;
      }
      if (tag === 'pre') {
        const code = node.querySelector('code');
        const codeText = code ? code.textContent : node.textContent;
        lines.push('```');
        lines.push(codeText);
        lines.push('```');
        lines.push('');
        return;
      }
      if (tag === 'hr') { lines.push('---'); lines.push(''); return; }
      // div, span, unknown — pass through children
      for (const child of node.childNodes) walk(child);
    };
    walk(root, '');
    // Clean up: remove duplicate blank lines
    const result = [];
    let prevBlank = false;
    for (const line of lines) {
      const blank = line.trim() === '';
      if (blank && prevBlank) continue;
      result.push(line);
      prevBlank = blank;
    }
    return result.join('\n').trim();
  },

  async saveArticle() {
    if (!state.selectedId) return;
    const content = this._getMarkdown();
    const a = { title: $('titleInput').value, content, excerpt: content.slice(0, 200), status: $('statusSelect').value, category_id: $('categorySelect').value || null, tag_ids: state.article?.tags?.map(t => t.id) || [] };
    try { const r = await api(`/articles/${state.selectedId}`, { method: 'PUT', body: JSON.stringify(a) }); if (!r.ok) throw new Error(); state.article = await r.json(); state.isDirty = false; const idx = state.articles.findIndex(x => x.id === state.selectedId); if (idx >= 0) state.articles[idx] = { ...state.articles[idx], ...state.article }; this.renderTree(); this.renderTags(); this.showToast('Saved', 'success'); $('saveStatus').textContent = ''; } catch (e) { this.showToast('Failed to save', 'error'); }
  },
  async deleteArticle(id) {
    if (!confirm('Delete this article?')) return;
    try { await api(`/articles/${id}`, { method: 'DELETE' }); state.articles = state.articles.filter(a => a.id !== id); if (state.selectedId === id) { state.article = null; state.selectedId = null; this.renderEditor(); } this.renderTree(); this.showToast('Deleted', 'success'); } catch (e) { this.showToast('Failed to delete', 'error'); }
  },
  async search(query) {
    if (state.activeTagId) this.clearTagFilter();
    try { const p = new URLSearchParams({ search: query, pageSize: '50' }); const r = await api(`/articles?${p}`); const d = await r.json(); state.articles = d.data ?? d; this.renderTree(); } catch (e) {}
  },

  onStatusChange() { state.isDirty = true; this.autoSave(); },
  onCategoryChange() { state.isDirty = true; this.autoSave(); },
  onTitleChange() { state.isDirty = true; this.autoSave(); if (state.selectedId) { const item = state.articles.find(a => a.id === state.selectedId); if (item) item.title = $('titleInput').value || 'Untitled'; this.renderTree(); } },
  onContentChange() { if (this._isRendering) return; state.isDirty = true; this.autoSave(); this.updateWordCount(); },

  // ─── Tags ──────────────────────────────────────────

  renderTags() {
    const list = $('tagsList'); list.innerHTML = '';
    for (const tag of (state.article?.tags || [])) {
      const c = document.createElement('span'); c.className = 'tag-chip' + (state.activeTagId === tag.id ? ' active' : '');
      const label = document.createElement('span');
      label.className = 'tag-label';
      label.textContent = tag.name;
      label.onclick = (e) => { e.stopPropagation(); this.filterByTag(tag.id, tag.name); };
      label.title = 'Filter by tag: ' + tag.name;
      c.appendChild(label);
      const remove = document.createElement('span');
      remove.className = 'tag-remove';
      remove.textContent = '\u00D7';
      remove.onclick = (e) => { e.stopPropagation(); this.removeTag(tag.id); };
      c.appendChild(remove);
      list.appendChild(c);
    }
  },

  filterByTag(tagId, tagName) {
    if (state.activeTagId === tagId) { this.clearTagFilter(); return; }
    state.activeTagId = tagId;
    state.activeTagName = tagName;
    state.selectedId = null;
    state.article = null;
    this.renderEditor();
    this.loadArticles();
    this.renderTags();
    $('tagInput').placeholder = 'Filtering: ' + tagName + ' (click tag again to clear)';
  },
  clearTagFilter() {
    state.activeTagId = null;
    state.activeTagName = null;
    $('tagInput').placeholder = 'Add tag...';
    this.loadArticles();
    this.renderTags();
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

  // ─── Editor & Render ──────────────────────────────

  renderEditor() {
    if (!state.article) { $('emptyState').classList.remove('hidden'); $('editorContent').classList.add('hidden'); return; }
    $('emptyState').classList.add('hidden'); $('editorContent').classList.remove('hidden');
    $('titleInput').value = state.article.title || '';
    const md = state.article.content || '';
    this._isRendering = true;
    try {
      // Sanitize legacy =WxH image size syntax (marked doesn't support it)
      const cleanMd = md.replace(/!\[([^\]]*)\]\(([^)]*?)\s+=\d+(?:x\d*)?\)/g, '![$1]($2)');
      $('contentInput').innerHTML = cleanMd ? (window.marked ? marked.parse(cleanMd) : '') : '';
    } finally {
      this._isRendering = false;
    }
    $('statusSelect').value = state.article.status || 'draft'; $('categorySelect').value = state.article.category_id || '';
    this.renderTags(); this.updateWordCount(); state.isDirty = false; $('saveStatus').textContent = '';
  },

  updateWordCount() {
    const t = $('contentInput').textContent || '';
    const w = t.trim() ? t.trim().split(/\s+/).length : 0;
    const c = t.length;
    $('wordCount').textContent = c > 0 ? w + ' words · ' + c + ' chars' : '0 words';
  },

  autoSave() { if (state.saveTimer) clearTimeout(state.saveTimer); $('saveStatus').textContent = 'Unsaved...'; state.saveTimer = setTimeout(() => this.saveArticle(), 2000); },
  setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      const mod = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 's') { e.preventDefault(); this.saveArticle(); }
      if (mod && e.key === 'n') { e.preventDefault(); this.newArticle(); }
    });
  },
  showToast(msg, type = '') { const t = $('toast'); t.textContent = msg; t.className = 'toast ' + type + ' show'; setTimeout(() => t.classList.remove('show'), 2500); },
  escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; },

  // ─── Fonts ────────────────────────────────────────────

  async loadFonts() {
    try { const r = await api('/fonts'); const d = await r.json(); state.fonts = d.fonts ?? []; state.activeFontId = d.activeFontId; this.applyFont(); } catch (e) {}
  },
  showSettings() {
    $('settingsModal').classList.remove('hidden');
    this.renderFonts();
  },
  hideSettings() { $('settingsModal').classList.add('hidden'); },
  handleFontDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) this.handleFontFile(file);
  },
  async handleFontFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['ttf','otf','woff','woff2'].includes(ext)) { this.showToast('Unsupported format', 'error'); return; }
    if (file.size > 50 * 1024 * 1024) { this.showToast('File too large (max 50MB)', 'error'); return; }
    const name = file.name.replace(/\.[^.]+$/, '');
    const token = getToken();
    try {
      const r = await fetch('/api/fonts/stream', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/octet-stream', 'X-Font-Name': name, 'X-Font-Ext': ext, 'Content-Length': file.size.toString() },
        body: file
      });
      if (!r.ok) { let err; try { const d = await r.json(); err = d.error; } catch {}; throw new Error(err || 'Upload failed'); }
      await this.loadFonts(); this.renderFonts(); this.showToast('Font uploaded', 'success');
    } catch (e) { this.showToast(e.message, 'error'); }
  },
  async renderFonts() {
    const list = $('fontsList');
    if (!state.fonts.length) { list.innerHTML = '<div class="settings-desc" style="margin-top:8px">No custom fonts yet.</div>'; return; }
    list.innerHTML = '';
    for (const font of state.fonts) {
      const isActive = font.id === state.activeFontId;
      const el = document.createElement('div');
      el.className = 'font-item' + (isActive ? ' active' : '');
      el.innerHTML = `
        <div class="font-preview" style="font-family:var(--font-editor,monospace)">Aa</div>
        <div class="font-info">
          <div class="font-name">${this.escapeHtml(font.name)}</div>
          <div class="font-meta">${(font.file_size / 1024).toFixed(0)} KB · ${font.format}</div>
        </div>
        <div class="font-actions">
          <button class="${isActive?'active-btn':''}" onclick="app.activateFont('${font.id}')" title="${isActive?'Active':'Use this font'}">${isActive ? '&#10003;' : 'T'}</button>
          <button onclick="app.deleteFont('${font.id}')" title="Delete">&#128465;</button>
        </div>`;
      list.appendChild(el);
    }
  },
  async activateFont(id) {
    try { const r = await api('/fonts/' + id + '/activate', { method: 'PUT' }); if (r.ok) { state.activeFontId = id; this.renderFonts(); this.applyFont(); this.showToast('Font activated', 'success'); } } catch (e) { this.showToast('Failed', 'error'); }
  },
  async deactivateFont() {
    try { const r = await api('/fonts/active', { method: 'DELETE' }); if (r.ok) { state.activeFontId = null; this.renderFonts(); this.applyFont(); this.showToast('System font restored', 'success'); } } catch (e) { this.showToast('Failed', 'error'); }
  },
  async deleteFont(id) {
    if (!confirm('Delete this font?')) return;
    try { const r = await api('/fonts/' + id, { method: 'DELETE' }); if (r.ok) { if (state.activeFontId === id) state.activeFontId = null; await this.loadFonts(); this.renderFonts(); this.showToast('Font deleted', 'success'); } } catch (e) { this.showToast('Failed', 'error'); }
  },
  applyFont() {
    const root = document.documentElement;
    const existing = document.getElementById('customFontStyle');
    if (existing) existing.remove();
    root.style.removeProperty('--font-editor');
    if (!state.activeFontId) return;
    const font = state.fonts.find(f => f.id === state.activeFontId);
    if (!font) return;
    const token = getToken();
    const fontUrl = `/api/fonts/${font.id}/file?token=${token}`;
    const style = document.createElement('style');
    style.id = 'customFontStyle';
    style.textContent = '@font-face{font-family:"CustomEditorFont";src:url("' + fontUrl + '") format("' + font.format + '");font-display:swap}';
    document.head.appendChild(style);
    root.style.setProperty('--font-editor', '"CustomEditorFont"');
  },

  // ─── Data Backup ───────────────────────────────────

  async exportData() {
    const token = getToken();
    try {
      const r = await fetch('/api/data/export', {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      if (!r.ok) throw new Error('Export failed');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'writer-app-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('Data exported', 'success');
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  async importData(file) {
    if (!file) return;
    if (!confirm('Import will replace ALL current data (articles, categories, tags, folders). This cannot be undone. Continue?')) return;
    const token = getToken();
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch('/api/data/import', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: form,
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Import failed'); }
      const result = await r.json();
      this.showToast('Imported: ' + result.stats.articles + ' articles, ' + result.stats.categories + ' categories, ' + result.stats.tags + ' tags', 'success');
      // Reload all data
      await Promise.all([this.loadFolders(), this.loadArticles(), this.loadCategories(), this.loadAllTags(), this.loadFonts()]);
      this.renderEditor();
      this.hideSettings();
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  // ─── Image Insertion ────────────────────────────────

  _pendingImageFile: null,
  _imageState: {},

  showImagePicker() {
    if (!state.article) return;
    $('imageModal').classList.remove('hidden');
    this.clearImageUpload();
    this.switchImageTab('upload');
  },
  hideImagePicker() { $('imageModal').classList.add('hidden'); this.clearImageUpload(); },

  switchImageTab(tab) {
    qa('.image-tab').forEach(t => t.classList.remove('active'));
    q(`[data-imagetab="${tab}"]`).classList.add('active');
    $('imageUploadTab').classList.toggle('hidden', tab !== 'upload');
    $('imageUrlTab').classList.toggle('hidden', tab !== 'url');
  },

  handleImageDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) this.handleImageFile(file);
  },

  handleImageFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { this.showToast('Please select an image file', 'error'); return; }
    if (file.size > 20 * 1024 * 1024) { this.showToast('Image too large (max 20MB)', 'error'); return; }

    this._pendingImageFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      $('imageUploadPreview').classList.remove('hidden');
      $('imagePreviewImg').src = e.target.result;
      $('imageAltInput').value = '';
    };
    reader.readAsDataURL(file);
    $('imageDropzone').classList.add('hidden');
  },

  clearImageUpload() {
    this._pendingImageFile = null;
    this._imageState = {};
    $('imageUploadPreview').classList.add('hidden');
    $('imageDropzone').classList.remove('hidden');
    $('imagePreviewImg').src = '';
    $('imageAltInput').value = '';
    $('imageUrlInput').value = '';
    $('imageUrlAltInput').value = '';
    $('imageUrlPreview').classList.add('hidden');
    $('imageUrlPreviewImg').src = '';
  },

  async uploadImage() {
    const file = this._pendingImageFile;
    if (!file) return;
    const alt = $('imageAltInput').value.trim() || '';

    const token = getToken();
    try {
      const r = await fetch('/api/images/stream', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/octet-stream',
          'X-Image-Name': file.name,
          'X-Image-Mime': file.type,
          'X-Image-Alt': alt,
          'Content-Length': file.size.toString(),
        },
        body: file,
      });
      if (!r.ok) { let err; try { const d = await r.json(); err = d.error; } catch {}; throw new Error(err || 'Upload failed'); }
      const img = await r.json();
      const imgUrl = `/api/images/${img.id}/file?token=${token}`;
      this.insertHTML('<img src="' + imgUrl + '" alt="' + this.escapeHtml(alt) + '" style="max-width:100%" />');
      this.hideImagePicker();
      this.showToast('Image inserted', 'success');
    } catch (e) { this.showToast(e.message, 'error'); }
  },

  previewImageUrl(url) {
    const preview = $('imageUrlPreview');
    const img = $('imageUrlPreviewImg');
    if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/'))) {
      preview.classList.remove('hidden');
      img.src = url;
    } else {
      preview.classList.add('hidden');
      img.src = '';
    }
  },

  insertImageFromUrl() {
    const url = $('imageUrlInput').value.trim();
    if (!url) { this.showToast('Please enter an image URL', 'error'); return; }
    const alt = $('imageUrlAltInput').value.trim() || '';
    this.insertHTML('<img src="' + this.escapeHtml(url) + '" alt="' + this.escapeHtml(alt) + '" style="max-width:100%" />');
    this.hideImagePicker();
    this.showToast('Image inserted', 'success');
  },

  insertHTML(html) {
    const editor = $('contentInput');
    editor.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const frag = range.createContextualFragment(html);
      range.insertNode(frag);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editor.insertAdjacentHTML('beforeend', html);
    }
    this.onContentChange();
  },

  insertMarkdown(md) {
    const html = window.marked ? marked.parse(md) : md;
    this.insertHTML(html);
  },

  // ─── Content Editable & Image Resize ──────────────

  _selectedImg: null,

  setupContentEditable() {
    const editor = $('contentInput');
    editor.addEventListener('click', (e) => this._onEditorClick(e));
    document.addEventListener('click', (e) => {
      if (this._selectedImg && !e.target.closest('#contentInput')) this._deselectImage();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._selectedImg) this._deselectImage();
    });
    editor.addEventListener('scroll', () => { if (this._selectedImg) this._positionOverlay(); });
  },

  _onEditorClick(e) {
    const img = e.target.closest('img');
    if (img) {
      e.preventDefault();
      this._selectImage(img);
      return;
    }
    if (this._selectedImg) this._deselectImage();
  },

  _selectImage(img) {
    this._deselectImage();
    this._selectedImg = img;
    img.classList.add('selected-img');
    this._positionOverlay();
    $('imageResizeOverlay').classList.remove('hidden');
    // Attach resize drag to handle
    const handle = $('resizeHandleSE');
    handle.onmousedown = (e) => this._startResize(e, img);
  },

  _deselectImage() {
    if (this._selectedImg) {
      this._selectedImg.classList.remove('selected-img');
      this._selectedImg = null;
    }
    $('imageResizeOverlay').classList.add('hidden');
  },

  _positionOverlay() {
    const img = this._selectedImg;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const overlay = $('imageResizeOverlay');
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  },

  _startResize(e, img) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = img.getBoundingClientRect().width;
    const startH = img.getBoundingClientRect().height;

    const onMove = (ev) => {
      const newW = Math.max(50, startW + (ev.clientX - startX));
      const ratio = startH / startW;
      const newH = Math.round(newW * ratio);
      img.style.width = newW + 'px';
      img.style.height = newH + 'px';
      this._positionOverlay();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      state.isDirty = true;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  },
};

document.addEventListener('DOMContentLoaded', () => authUI.init());
