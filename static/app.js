const API = '/api';

let state = {
  articles: [],
  article: null,
  isDirty: false,
  isPreview: false,
  selectedId: null,
  saveTimer: null,
};

const $ = (id) => document.getElementById(id);

// ─── App initialization ─────────────────────────────

const app = {
  async init() {
    await this.loadArticles();
    this.setupKeyboard();
    this.setupAutoSave();
  },

  // ─── Articles ──────────────────────────────────────

  async loadArticles() {
    try {
      const res = await fetch(`${API}/articles`);
      const data = await res.json();
      state.articles = data.data ?? data;
      this.renderList();
    } catch (e) {
      this.showToast('Failed to load articles', 'error');
    }
  },

  async loadCategories() {
    try {
      const res = await fetch(`${API}/categories`);
      const categories = await res.json();
      const select = $('categorySelect');
      select.innerHTML = '<option value="">No Category</option>';
      for (const cat of categories) {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        select.appendChild(opt);
      }
    } catch (e) { /* ignore */ }
  },

  async newArticle() {
    try {
      const res = await fetch(`${API}/articles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '', content: '' }),
      });
      const article = await res.json();
      state.articles.unshift(article);
      this.renderList();
      this.selectArticle(article.id);
    } catch (e) {
      this.showToast('Failed to create article', 'error');
    }
  },

  async selectArticle(id) {
    state.selectedId = id;
    state.isDirty = false;
    state.isPreview = false;
    $('previewBtn').classList.remove('active');
    $('preview').classList.add('hidden');
    $('contentInput').classList.remove('hidden');

    try {
      const res = await fetch(`${API}/articles/${id}`);
      if (!res.ok) throw new Error('Not found');
      state.article = await res.json();
      this.renderEditor();
      this.renderList();
    } catch (e) {
      this.showToast('Failed to load article', 'error');
    }
  },

  async saveArticle() {
    if (!state.selectedId) return;

    const article = {
      title: $('titleInput').value,
      content: $('contentInput').value,
      excerpt: $('contentInput').value.slice(0, 200),
      status: $('statusSelect').value,
      category_id: $('categorySelect').value || null,
    };

    try {
      const res = await fetch(`${API}/articles/${state.selectedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(article),
      });
      if (!res.ok) throw new Error('Save failed');
      state.article = await res.json();
      state.isDirty = false;
      const idx = state.articles.findIndex((a) => a.id === state.selectedId);
      if (idx >= 0) {
        state.articles[idx] = { ...state.articles[idx], ...state.article };
      }
      this.renderList();
      this.showToast('Saved', 'success');
      $('saveStatus').textContent = '';
    } catch (e) {
      this.showToast('Failed to save', 'error');
    }
  },

  async deleteArticle(id) {
    if (!confirm('Delete this article?')) return;
    try {
      const res = await fetch(`${API}/articles/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      state.articles = state.articles.filter((a) => a.id !== id);
      if (state.selectedId === id) {
        state.article = null;
        state.selectedId = null;
        this.renderEditor();
      }
      this.renderList();
      this.showToast('Deleted', 'success');
    } catch (e) {
      this.showToast('Failed to delete', 'error');
    }
  },

  async search(query) {
    try {
      const params = new URLSearchParams({ search: query, pageSize: '50' });
      const res = await fetch(`${API}/articles?${params}`);
      const data = await res.json();
      state.articles = data.data ?? data;
      this.renderList();
    } catch (e) { /* ignore */ }
  },

  // ─── Status & Category ────────────────────────────

  async onStatusChange() {
    state.isDirty = true;
    this.autoSave();
  },

  async onCategoryChange() {
    state.isDirty = true;
    this.autoSave();
  },

  onTitleChange() {
    state.isDirty = true;
    this.autoSave();
    const input = $('titleInput');
    if (state.selectedId) {
      const item = state.articles.find((a) => a.id === state.selectedId);
      if (item) item.title = input.value || 'Untitled';
      this.renderList();
    }
  },

  onContentChange() {
    state.isDirty = true;
    this.autoSave();
    this.updateWordCount();
  },

  // ─── Preview ──────────────────────────────────────

  togglePreview() {
    state.isPreview = !state.isPreview;
    $('previewBtn').classList.toggle('active', state.isPreview);
    if (state.isPreview) {
      $('preview').classList.remove('hidden');
      $('contentInput').classList.add('hidden');
      if (window.marked) {
        $('preview').innerHTML = marked.parse($('contentInput').value);
      } else {
        $('preview').textContent = $('contentInput').value;
      }
    } else {
      $('preview').classList.add('hidden');
      $('contentInput').classList.remove('hidden');
    }
  },

  // ─── Renderers ────────────────────────────────────

  renderList() {
    const list = $('articleList');
    list.innerHTML = '';
    for (const article of state.articles) {
      const div = document.createElement('div');
      div.className = `article-item${article.id === state.selectedId ? ' active' : ''}`;
      const title = article.title || 'Untitled';
      const date = new Date(article.updated_at).toLocaleDateString('zh-CN', {
        month: 'short', day: 'numeric',
      });
      div.innerHTML = `
        <div class="article-title">${this.escapeHtml(title)}</div>
        <div class="article-meta">
          <span class="article-date">${date}</span>
          ${article.status === 'published' ? '<span class="article-status published">Published</span>' : '<span class="article-status">Draft</span>'}
        </div>
      `;
      div.onclick = () => {
        if (state.isDirty) {
          if (!confirm('You have unsaved changes. Discard them?')) return;
        }
        this.selectArticle(article.id);
      };
      list.appendChild(div);
    }
  },

  renderEditor() {
    const article = state.article;
    if (!article) {
      $('emptyState').classList.remove('hidden');
      $('editorContent').classList.add('hidden');
      return;
    }
    $('emptyState').classList.add('hidden');
    $('editorContent').classList.remove('hidden');

    $('titleInput').value = article.title || '';
    $('contentInput').value = article.content || '';
    $('statusSelect').value = article.status || 'draft';

    if ($('categorySelect').options.length <= 1) {
      this.loadCategories();
    }
    $('categorySelect').value = article.category_id || '';

    this.updateWordCount();
    state.isDirty = false;
    $('saveStatus').textContent = '';
  },

  updateWordCount() {
    const text = $('contentInput').value;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    $('wordCount').textContent = chars > 0 ? `${words} words · ${chars} characters` : '0 words';
  },

  // ─── Auto-save ────────────────────────────────────

  setupAutoSave() {},

  autoSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    $('saveStatus').textContent = 'Unsaved changes...';
    state.saveTimer = setTimeout(() => {
      this.saveArticle();
    }, 2000);
  },

  // ─── Keyboard shortcuts ───────────────────────────

  setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      const isMac = navigator.platform.includes('Mac');
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && e.key === 's') {
        e.preventDefault();
        this.saveArticle();
      }
      if (mod && e.key === 'p') {
        e.preventDefault();
        this.togglePreview();
      }
      if (mod && e.key === 'n') {
        e.preventDefault();
        this.newArticle();
      }
    });
  },

  // ─── Utility ──────────────────────────────────────

  showToast(msg, type = '') {
    const toast = $('toast');
    toast.textContent = msg;
    toast.className = 'toast ' + type + ' show';
    setTimeout(() => toast.classList.remove('show'), 2500);
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};

// ─── Start ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => app.init());
