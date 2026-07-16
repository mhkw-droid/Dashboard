'use strict';

const DEFAULT_CONFIG = {
  theme: 'dark',
  accentColor: '#38bdf8',
  settings: { cardWidth: 300, fontSize: 16, animations: true, backupCount: 10 },
  categories: []
};

const $ = (id) => document.getElementById(id);
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

class Store {
  constructor() {
    this.key = 'admin-dashboard-config';
    this.backupKey = 'admin-dashboard-backups';
    this.data = structuredClone(DEFAULT_CONFIG);
  }

  async load() {
    const saved = localStorage.getItem(this.key);
    if (saved) {
      this.data = this.normalize(JSON.parse(saved));
      return;
    }

    try {
      const response = await fetch('config.json', { cache: 'no-store' });
      if (response.ok) this.data = this.normalize(await response.json());
    } catch {
      this.data = structuredClone(DEFAULT_CONFIG);
    }
    this.save(false);
  }

  normalize(config) {
    const normalized = {
      ...structuredClone(DEFAULT_CONFIG),
      ...config,
      settings: { ...DEFAULT_CONFIG.settings, ...(config.settings || {}) },
      categories: (config.categories || []).map((category, categoryIndex) => ({
        ...category,
        id: category.id || uid('cat'),
        order: Number.isFinite(category.order) ? category.order : categoryIndex + 1,
        collapsed: Boolean(category.collapsed),
        links: (category.links || []).map((link, linkIndex) => ({
          favorite: false,
          openCount: 0,
          lastOpened: null,
          newTab: true,
          tags: [],
          ...link,
          id: link.id || uid('link'),
          order: Number.isFinite(link.order) ? link.order : linkIndex + 1
        }))
      }))
    };

    normalized.categories.sort((a, b) => a.order - b.order);
    normalized.categories.forEach((category, index) => {
      category.order = index + 1;
      category.links.sort((a, b) => a.order - b.order);
      category.links.forEach((link, linkIndex) => { link.order = linkIndex + 1; });
    });
    return normalized;
  }

  save(withBackup = true) {
    localStorage.setItem(this.key, JSON.stringify(this.data));
    if (withBackup) this.backup();
  }

  backup() {
    const backups = JSON.parse(localStorage.getItem(this.backupKey) || '[]');
    backups.unshift({
      name: `config_${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.json`,
      created: new Date().toISOString(),
      data: this.data
    });
    localStorage.setItem(this.backupKey, JSON.stringify(backups.slice(0, this.data.settings.backupCount || 10)));
  }

  export(filename, content, type = 'application/json') {
    const blob = new Blob([content], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }
}

class Dashboard {
  constructor(store) {
    this.store = store;
    this.query = '';
    this.editing = false;
    this.drag = null;
    this.pendingImport = null;
    this.pendingCategoryId = null;
    this.elements = {
      dashboard: $('dashboard'),
      search: $('searchInput'),
      stats: $('stats'),
      dialog: $('itemDialog'),
      form: $('itemForm'),
      importDialog: $('importDialog')
    };
  }

  init() {
    this.bindGlobalActions();
    this.applySettings();
    this.render();
    setInterval(() => this.renderClock(), 1000);
    this.renderClock();
  }

  bindGlobalActions() {
    this.elements.search.addEventListener('input', (event) => {
      this.query = event.target.value.trim().toLowerCase();
      this.render();
    });
    this.elements.search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.openFirstResult();
      if (event.key === 'Escape') this.clearSearch();
    });
    $('editButton').addEventListener('click', () => this.toggleEditMode());
    $('themeButton').addEventListener('click', () => this.toggleTheme());
    $('favoritesButton').addEventListener('click', () => this.showFavorites());
    $('exportButton').addEventListener('click', () => this.store.export('config.json', JSON.stringify(this.store.data, null, 2)));
    $('backupButton').addEventListener('click', () => this.downloadBackup());
    $('addCategoryButton').addEventListener('click', () => this.openCategoryDialog());
    $('settingsButton').addEventListener('click', () => this.openCategoryDialog());
    $('addLinkButton').addEventListener('click', () => this.openLinkDialog(this.firstCategoryId()));
    $('importButton').addEventListener('click', () => $('fileImport').click());
    $('fileImport').addEventListener('change', (event) => this.importFile(event.target.files[0]));
    $('cancelDialog').addEventListener('click', () => this.elements.dialog.close());
    $('cancelImport').addEventListener('click', () => this.cancelImport());
    $('mergeImport').addEventListener('click', () => this.applyImport('merge'));
    $('replaceImport').addEventListener('click', () => this.applyImport('replace'));
    this.elements.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.saveDialog();
    });
    document.addEventListener('keydown', (event) => this.shortcuts(event));
  }

  shortcuts(event) {
    const key = event.key.toLowerCase();
    if (event.ctrlKey && key === 'k') { event.preventDefault(); this.elements.search.focus(); }
    if (event.ctrlKey && key === 'n' && !event.shiftKey) { event.preventDefault(); this.openCategoryDialog(); }
    if (event.ctrlKey && event.shiftKey && key === 'n') { event.preventDefault(); this.openLinkDialog(this.firstCategoryId()); }
    if (event.ctrlKey && key === 's') { event.preventDefault(); $('exportButton').click(); }
    if (event.key === 'Escape' && this.elements.dialog.open) this.elements.dialog.close();
  }

  applySettings() {
    document.body.classList.toggle('light', this.store.data.theme === 'light');
    document.documentElement.style.setProperty('--accent', this.store.data.accentColor || '#38bdf8');
    document.documentElement.style.setProperty('--card-width', `${this.store.data.settings.cardWidth}px`);
    document.documentElement.style.setProperty('--font-size', `${this.store.data.settings.fontSize}px`);
  }

  safeUrl(url) {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:', 'file:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  render() {
    const fragment = document.createDocumentFragment();
    const categories = this.orderedCategories();
    const favorites = this.favoriteCategory();
    const visibleCategories = favorites.links.length ? [favorites, ...categories] : categories;
    let visibleLinks = 0;

    visibleCategories.forEach((category) => {
      const links = this.orderedLinks(category).filter((link) => this.matches(category, link));
      if (!links.length && this.query) return;
      visibleLinks += links.length;
      fragment.append(this.renderCategory(category, links));
    });

    this.elements.dashboard.replaceChildren(fragment);
    if (!this.elements.dashboard.children.length) this.elements.dashboard.append(this.empty('Keine Treffer gefunden.'));
    this.renderStats(visibleLinks);
  }

  orderedCategories() {
    return [...this.store.data.categories].sort((a, b) => a.order - b.order);
  }

  orderedLinks(category) {
    return [...(category.links || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  matches(category, link) {
    if (!this.query) return true;
    if (this.query === 'favorite:true') return link.favorite;
    return [category.name, category.description, link.title, link.url, link.description, ...(link.tags || [])]
      .join(' ')
      .toLowerCase()
      .includes(this.query);
  }

  favoriteCategory() {
    return {
      id: 'favorites',
      name: 'Favoriten',
      icon: '★',
      color: '#facc15',
      description: 'Schnellzugriff auf markierte Links',
      collapsed: false,
      virtual: true,
      links: this.store.data.categories
        .flatMap((category) => this.orderedLinks(category).map((link) => ({ ...link, sourceCategory: category.id })))
        .filter((link) => link.favorite)
    };
  }

  renderCategory(category, links) {
    const section = document.createElement('section');
    section.className = `category ${category.collapsed ? 'collapsed' : ''}`;
    section.style.setProperty('--cat-color', category.color);
    section.draggable = this.editing && !category.virtual;
    section.dataset.id = category.id;
    section.addEventListener('dragstart', () => { this.drag = { type: 'category', id: category.id }; });
    section.addEventListener('dragover', (event) => event.preventDefault());
    section.addEventListener('drop', () => this.dropCategory(category.id));

    const headerButton = document.createElement('div');
    headerButton.className = 'category__head';
    headerButton.append(
      this.icon(category.icon, 'category__icon'),
      this.titleBlock(category.name, category.description, links.length),
      this.categoryActions(category)
    );

    const list = document.createElement('div');
    list.className = 'links';
    list.addEventListener('dragover', (event) => event.preventDefault());
    list.addEventListener('drop', () => this.dropLinkIntoCategory(category.id));
    links.forEach((link) => list.append(this.renderLink(category, link)));

    section.append(headerButton, list);
    return section;
  }

  renderLink(category, link) {
    const card = document.createElement('a');
    card.className = 'link-card';
    card.href = this.safeUrl(link.url) ? link.url : '#';
    card.target = link.newTab ? '_blank' : '_self';
    card.rel = 'noopener noreferrer';
    card.draggable = this.editing && !category.virtual;
    card.dataset.id = link.id;
    card.addEventListener('click', (event) => {
      if (this.editing) event.preventDefault();
      else this.trackOpen(link.id);
    });
    card.addEventListener('dragstart', () => { this.drag = { type: 'link', id: link.id }; });
    card.addEventListener('dragover', (event) => event.preventDefault());
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      this.dropLinkBefore(link.id, category.virtual ? link.sourceCategory : category.id);
    });
    card.append(this.icon(link.icon || '🔗', 'link-card__icon'), this.linkText(link), this.linkActions(link));
    return card;
  }

  icon(text, className) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text || '🔗';
    return span;
  }

  titleBlock(title, description, count) {
    const wrap = document.createElement('div');
    wrap.className = 'category__title';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const meta = document.createElement('p');
    meta.className = 'muted';
    meta.textContent = `${count} Links${description ? ` • ${description}` : ''}`;
    wrap.append(heading, meta);
    return wrap;
  }

  linkText(link) {
    const wrap = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = link.title;
    const desc = document.createElement('p');
    desc.textContent = link.description || link.url;
    const tags = document.createElement('div');
    tags.className = 'tags';
    (link.tags || []).forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'tag';
      chip.textContent = tag;
      tags.append(chip);
    });
    wrap.append(title, desc, tags);
    return wrap;
  }

  categoryActions(category) {
    const wrap = document.createElement('span');
    wrap.className = 'category-actions';
    const toggle = this.small(category.collapsed ? 'Aufklappen' : 'Zuklappen', () => this.toggleCategory(category));
    wrap.append(toggle);
    if (!category.virtual) {
      const editTools = document.createElement('span');
      editTools.className = 'edit-tools';
      [
        ['＋ Link', () => this.openLinkDialog(category.id)],
        ['✎ Kategorie', () => this.openCategoryDialog(category)],
        ['🗑', () => this.removeCategory(category.id)]
      ].forEach(([label, fn]) => editTools.append(this.small(label, fn)));
      wrap.append(editTools);
    }
    return wrap;
  }

  linkActions(link) {
    const box = document.createElement('div');
    const tools = document.createElement('div');
    tools.className = 'edit-tools link-tools';
    tools.append(
      this.small('★', () => this.toggleFavorite(link.id)),
      this.moveSelect(link),
      this.small('↑', () => this.reorderLink(link.id, -1)),
      this.small('↓', () => this.reorderLink(link.id, 1)),
      this.small('⧉', () => this.duplicateLink(link.id)),
      this.small('✎', () => this.openLinkDialog(null, link)),
      this.small('🗑', () => this.removeLink(link.id))
    );
    const arrow = document.createElement('span');
    arrow.className = 'open-indicator';
    arrow.textContent = '↗';
    box.append(tools, arrow);
    return box;
  }

  moveSelect(link) {
    const select = document.createElement('select');
    select.className = 'move-select';
    select.title = 'In Kategorie verschieben';
    const current = this.findLink(link.id).category?.id;
    this.orderedCategories().forEach((category) => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      option.selected = category.id === current;
      select.append(option);
    });
    select.addEventListener('click', (event) => event.stopPropagation());
    select.addEventListener('change', () => this.moveLinkToCategory(link.id, select.value));
    return select;
  }

  small(label, fn) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini';
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      fn();
    });
    return button;
  }

  empty(message) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = message;
    return div;
  }

  renderStats(visible) {
    const totalLinks = this.store.data.categories.reduce((sum, category) => sum + category.links.length, 0);
    const favs = this.store.data.categories.flatMap((category) => category.links).filter((link) => link.favorite).length;
    this.elements.stats.replaceChildren(...[
      ['Kategorien', this.store.data.categories.length],
      ['Links', totalLinks],
      ['Favoriten', favs],
      ['Sichtbar', visible]
    ].map(([label, value]) => {
      const box = document.createElement('div');
      box.className = 'stat';
      const strong = document.createElement('strong');
      strong.textContent = value;
      const span = document.createElement('span');
      span.textContent = label;
      box.append(strong, span);
      return box;
    }));
  }

  renderClock() {
    const now = new Date();
    $('clockTime').textContent = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    $('clockDate').textContent = now.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  openCategoryDialog(category = null) {
    this.fillDialog('category', category || { id: '', name: '', icon: '🗂', color: '#38bdf8', description: '', tags: [] });
  }

  openLinkDialog(categoryId, link = null) {
    this.fillDialog('link', link || { id: '', categoryId, title: '', url: 'https://', icon: '🔗', color: '#38bdf8', description: '', tags: [] });
  }

  fillDialog(type, item) {
    $('dialogTitle').textContent = type === 'category' ? 'Kategorie bearbeiten' : 'Link bearbeiten';
    $('itemType').value = type;
    $('itemId').value = item.id || '';
    $('itemTitle').value = item.name || item.title || '';
    $('itemUrl').value = item.url || '';
    $('itemUrl').disabled = type === 'category';
    $('itemIcon').value = item.icon || '';
    $('itemColor').value = item.color || '#38bdf8';
    $('itemDescription').value = item.description || '';
    $('itemTags').value = (item.tags || []).join(', ');
    $('categorySelectField').classList.toggle('hidden', type === 'category');
    this.populateCategorySelect(item.categoryId || this.findLink(item.id).category?.id || this.firstCategoryId());
    $('formError').textContent = '';
    this.pendingCategoryId = item.categoryId;
    this.elements.dialog.showModal();
  }

  populateCategorySelect(selectedId) {
    const select = $('itemCategory');
    select.replaceChildren();
    this.orderedCategories().forEach((category) => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      option.selected = category.id === selectedId;
      select.append(option);
    });
  }

  saveDialog() {
    const type = $('itemType').value;
    const id = $('itemId').value;
    const title = $('itemTitle').value.trim();
    if (!title) return this.showFormError('Bitte einen Namen eingeben.');
    if (type === 'link' && !this.safeUrl($('itemUrl').value.trim())) {
      return this.showFormError('Bitte eine gültige http(s)- oder file-URL eingeben.');
    }

    const payload = {
      icon: $('itemIcon').value.trim(),
      color: $('itemColor').value,
      description: $('itemDescription').value.trim(),
      tags: $('itemTags').value.split(',').map((tag) => tag.trim()).filter(Boolean)
    };

    if (type === 'category') this.upsertCategory(id, { ...payload, name: title });
    else this.upsertLink(id, { ...payload, title, url: $('itemUrl').value.trim() }, $('itemCategory').value);

    this.elements.dialog.close();
    this.store.save();
    this.render();
  }

  showFormError(message) {
    $('formError').textContent = message;
  }

  upsertCategory(id, data) {
    const found = this.store.data.categories.find((category) => category.id === id);
    if (found) Object.assign(found, data);
    else this.store.data.categories.push({ id: uid('cat'), order: this.store.data.categories.length + 1, collapsed: false, links: [], ...data });
    this.reindexCategories();
  }

  upsertLink(id, data, targetCategoryId) {
    const existing = this.findLink(id);
    const category = this.store.data.categories.find((item) => item.id === targetCategoryId) || existing.category || this.store.data.categories[0];
    if (!category) return;
    if (existing.link) {
      Object.assign(existing.link, data);
      if (existing.category.id !== category.id) this.moveLinkToCategory(id, category.id, false);
      return;
    }
    category.links.push({ id: uid('link'), favorite: false, openCount: 0, lastOpened: null, newTab: true, order: category.links.length + 1, ...data });
    this.reindexLinks(category);
  }

  findLink(id) {
    for (const category of this.store.data.categories) {
      const index = category.links.findIndex((item) => item.id === id);
      if (index >= 0) return { category, link: category.links[index], index };
    }
    return {};
  }

  toggleEditMode() {
    this.editing = !this.editing;
    document.body.classList.toggle('editing', this.editing);
    $('editButton').classList.toggle('active', this.editing);
    this.render();
  }

  toggleTheme() {
    this.store.data.theme = this.store.data.theme === 'dark' ? 'light' : 'dark';
    this.store.save();
    this.applySettings();
  }

  toggleCategory(category) {
    if (category.virtual) return;
    category.collapsed = !category.collapsed;
    this.store.save();
    this.render();
  }

  clearSearch() {
    this.elements.search.value = '';
    this.query = '';
    this.render();
  }

  showFavorites() {
    this.query = 'favorite:true';
    this.elements.search.value = this.query;
    this.render();
  }

  downloadBackup() {
    this.store.backup();
    this.store.export(`config_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(this.store.data, null, 2));
  }

  toggleFavorite(id) {
    const { link } = this.findLink(id);
    if (link) link.favorite = !link.favorite;
    this.store.save();
    this.render();
  }

  duplicateLink(id) {
    const { category, link } = this.findLink(id);
    if (category && link) {
      category.links.push({ ...structuredClone(link), id: uid('link'), title: `${link.title} Kopie`, order: category.links.length + 1 });
      this.reindexLinks(category);
    }
    this.store.save();
    this.render();
  }

  removeLink(id) {
    const { category } = this.findLink(id);
    if (category) {
      category.links = category.links.filter((link) => link.id !== id);
      this.reindexLinks(category);
    }
    this.store.save();
    this.render();
  }

  removeCategory(id) {
    this.store.data.categories = this.store.data.categories.filter((category) => category.id !== id);
    this.reindexCategories();
    this.store.save();
    this.render();
  }

  dropCategory(targetId) {
    if (!this.drag || this.drag.type !== 'category' || this.drag.id === targetId) return;
    const categories = this.store.data.categories;
    const from = categories.findIndex((category) => category.id === this.drag.id);
    const to = categories.findIndex((category) => category.id === targetId);
    if (from < 0 || to < 0) return;
    categories.splice(to, 0, categories.splice(from, 1)[0]);
    this.reindexCategories();
    this.store.save();
    this.render();
  }

  dropLinkBefore(targetId, categoryId) {
    if (!this.drag || this.drag.type !== 'link' || this.drag.id === targetId) return;
    this.moveLinkToCategory(this.drag.id, categoryId, false, targetId);
    this.store.save();
    this.render();
  }

  dropLinkIntoCategory(categoryId) {
    if (!this.drag || this.drag.type !== 'link') return;
    this.moveLinkToCategory(this.drag.id, categoryId, false);
    this.store.save();
    this.render();
  }

  moveLinkToCategory(linkId, categoryId, rerender = true, beforeLinkId = null) {
    const source = this.findLink(linkId);
    const targetCategory = this.store.data.categories.find((category) => category.id === categoryId);
    if (!source.category || !source.link || !targetCategory) return;

    source.category.links.splice(source.index, 1);
    const insertIndex = beforeLinkId ? targetCategory.links.findIndex((link) => link.id === beforeLinkId) : -1;
    if (insertIndex >= 0) targetCategory.links.splice(insertIndex, 0, source.link);
    else targetCategory.links.push(source.link);
    this.reindexLinks(source.category);
    this.reindexLinks(targetCategory);

    if (rerender) {
      this.store.save();
      this.render();
    }
  }

  reorderLink(linkId, direction) {
    const { category, index } = this.findLink(linkId);
    if (!category) return;
    const target = index + direction;
    if (target < 0 || target >= category.links.length) return;
    category.links.splice(target, 0, category.links.splice(index, 1)[0]);
    this.reindexLinks(category);
    this.store.save();
    this.render();
  }

  reindexCategories() {
    this.store.data.categories.forEach((category, index) => { category.order = index + 1; });
  }

  reindexLinks(category) {
    category.links.forEach((link, index) => { link.order = index + 1; });
  }

  trackOpen(id) {
    const { link } = this.findLink(id);
    if (link) {
      link.openCount = (link.openCount || 0) + 1;
      link.lastOpened = new Date().toISOString();
      this.store.save(false);
    }
  }

  openFirstResult() {
    const first = this.elements.dashboard.querySelector('.link-card');
    if (first) first.click();
  }

  async importFile(file) {
    if (!file) return;
    const text = await file.text();
    $('fileImport').value = '';

    if (file.name.endsWith('.json')) {
      const imported = this.store.normalize(JSON.parse(text));
      this.confirmJsonImport(imported);
      return;
    }

    const doc = new DOMParser().parseFromString(text, 'text/html');
    const links = [...doc.querySelectorAll('a[href]')].map((anchor, index) => ({
      id: uid('link'),
      title: anchor.textContent.trim() || anchor.href,
      url: anchor.href,
      icon: '🔖',
      description: 'Importierter Browser-Link',
      tags: ['import'],
      favorite: false,
      openCount: 0,
      lastOpened: null,
      color: '#38bdf8',
      newTab: true,
      order: index + 1
    }));
    this.store.data.categories.push({
      id: uid('cat'),
      name: `Import ${new Date().toLocaleDateString('de-DE')}`,
      icon: '📥',
      color: '#38bdf8',
      description: `${links.length} importierte Lesezeichen`,
      order: this.store.data.categories.length + 1,
      collapsed: false,
      links
    });
    this.store.save();
    this.render();
  }

  confirmJsonImport(imported) {
    this.pendingImport = imported;
    const linkCount = imported.categories.reduce((sum, category) => sum + category.links.length, 0);
    $('importSummary').textContent = `${imported.categories.length} Kategorien und ${linkCount} Links wurden gefunden. Wie soll der Import angewendet werden?`;
    this.elements.importDialog.showModal();
  }

  cancelImport() {
    this.pendingImport = null;
    this.elements.importDialog.close();
  }

  applyImport(mode) {
    if (!this.pendingImport) return;
    if (mode === 'replace') this.store.data = this.pendingImport;
    if (mode === 'merge') this.mergeImport(this.pendingImport);
    this.pendingImport = null;
    this.elements.importDialog.close();
    this.store.save();
    this.applySettings();
    this.render();
  }

  mergeImport(imported) {
    imported.categories.forEach((incomingCategory) => {
      const category = this.uniqueCategory(incomingCategory);
      category.order = this.store.data.categories.length + 1;
      this.store.data.categories.push(category);
    });
    this.reindexCategories();
  }

  uniqueCategory(category) {
    const clone = structuredClone(category);
    if (this.store.data.categories.some((item) => item.id === clone.id)) clone.id = uid('cat');
    clone.links = clone.links.map((link, index) => ({ ...link, id: this.linkIdExists(link.id) ? uid('link') : link.id, order: index + 1 }));
    return clone;
  }

  linkIdExists(id) {
    return this.store.data.categories.some((category) => category.links.some((link) => link.id === id));
  }

  firstCategoryId() {
    return this.orderedCategories()[0]?.id;
  }
}

const store = new Store();
store.load().then(() => new Dashboard(store).init());
