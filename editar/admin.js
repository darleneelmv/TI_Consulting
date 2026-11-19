/* Panel de edición — TI Consulting
 * Los cambios se guardan como commits en el repositorio de GitHub (data/site.json + imágenes),
 * y GitHub Pages republica el sitio en ~1 minuto.
 * El token de GitHub se guarda cifrado (AES-GCM + PBKDF2) en data/admin.json con la contraseña del equipo. */
(function () {
  'use strict';

  /* ---------- Configuración del repositorio ---------- */
  const CONFIG = {
    owner: 'darleneelmv',
    repo: 'TI_Consulting',
    branch: 'main',
    dataPath: 'data/site.json',
    authPath: 'data/admin.json',
    uploadsDir: 'assets/uploads',
  };
  // Si el sitio se publica en otro usuario/repo de GitHub Pages, se detecta solo.
  (function detect() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!m) return;
    CONFIG.owner = m[1];
    const seg = location.pathname.split('/').filter(Boolean);
    if (seg.length && seg[0].toLowerCase() !== 'editar') CONFIG.repo = seg[0];
    else CONFIG.repo = m[1] + '.github.io';
  })();

  /* ---------- Utilidades ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64FromBytes = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const bytesFromB64 = (b64) => Uint8Array.from(atob(String(b64).replace(/\s/g, '')), (c) => c.charCodeAt(0));
  const utf8ToB64 = (str) => b64FromBytes(enc.encode(str));
  const b64ToUtf8 = (b64) => dec.decode(bytesFromB64(b64));
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) {} },
  };
  const TOKEN_KEY = 'tic-admin-token';

  function toast(msg, type = '', ms = 4200) {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms);
  }
  function confirmBox(text, yesLabel = 'Sí, continuar') {
    return new Promise((resolve) => {
      $('#modalText').textContent = text;
      $('#modalYes').textContent = yesLabel;
      $('#modal').hidden = false;
      const done = (v) => { $('#modal').hidden = true; $('#modalYes').onclick = $('#modalNo').onclick = null; resolve(v); };
      $('#modalYes').onclick = () => done(true);
      $('#modalNo').onclick = () => done(false);
    });
  }
  function normUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
    return 'https://' + u;
  }
  function initials(name) { return String(name || '?').trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
  function avatar(name) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#dbe8f6"/><circle cx="200" cy="160" r="70" fill="#a9c3e0"/><path d="M60 400c10-90 70-140 140-140s130 50 140 140z" fill="#a9c3e0"/><text x="200" y="182" font-family="Arial,sans-serif" font-size="64" font-weight="700" fill="#fff" text-anchor="middle">${esc(initials(name))}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ---------- Cifrado ---------- */
  async function deriveKey(password, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptToken(token, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const iterations = 310000;
    const key = await deriveKey(password, salt, iterations);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token)));
    return { v: 1, kdf: 'PBKDF2-SHA256', cipher: 'AES-256-GCM', iterations, salt: b64FromBytes(salt), iv: b64FromBytes(iv), data: b64FromBytes(ct), actualizado: new Date().toISOString() };
  }
  async function decryptToken(auth, password) {
    const key = await deriveKey(password, bytesFromB64(auth.salt), auth.iterations);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytesFromB64(auth.iv) }, key, bytesFromB64(auth.data));
    return dec.decode(pt);
  }

  /* ---------- GitHub API ---------- */
  const gh = {
    token: null,
    async req(path, opts = {}, token = this.token) {
      const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
      if (token) headers.Authorization = 'Bearer ' + token;
      if (opts.body) headers['Content-Type'] = 'application/json';
      let res;
      try {
        res = await fetch('https://api.github.com' + path, { ...opts, headers, cache: 'no-store' });
      } catch (e) {
        const err = new Error('Sin conexión con GitHub. Revisa tu internet.'); err.status = 0; throw err;
      }
      if (!res.ok) {
        let body = {}; try { body = await res.json(); } catch (e) {}
        const err = new Error(body.message || ('Error ' + res.status)); err.status = res.status; err.body = body; throw err;
      }
      return res.status === 204 ? null : res.json();
    },
    path(p) { return `/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}`; },
    async getFile(p, token) {
      try {
        const j = await this.req(this.path(p) + '?ref=' + encodeURIComponent(CONFIG.branch) + '&t=' + Date.now(), {}, token);
        return { sha: j.sha, content: b64ToUtf8(j.content) };
      } catch (e) { if (e.status === 404) return null; throw e; }
    },
    putFile(p, b64, message, sha, token) {
      const body = { message, content: b64, branch: CONFIG.branch };
      if (sha) body.sha = sha;
      return this.req(this.path(p), { method: 'PUT', body: JSON.stringify(body) }, token);
    },
  };
  function friendlyError(e) {
    if (e.status === 401) return 'El token de GitHub no es válido o ya venció. Renuévalo en la pestaña "Acceso".';
    if (e.status === 403) return 'El token no tiene permiso de escritura (Contents: Read and write) en el repositorio.';
    if (e.status === 404) return 'No se encontró el repositorio ' + CONFIG.owner + '/' + CONFIG.repo + ' con este token.';
    if (e.status === 409 || e.status === 422) return 'Otra persona guardó al mismo tiempo. Intenta publicar de nuevo.';
    return e.message || 'Ocurrió un error inesperado.';
  }

  /* ---------- Estado ---------- */
  const state = {
    auth: null, authSha: null,
    base: null,    // datos tal como están publicados
    data: null,    // datos con cambios locales
    pending: new Map(),   // ruta -> base64 de imágenes por subir
    previews: new Map(),  // ruta -> dataURL para vista previa
    editing: null,
  };
  const isDirty = () => state.pending.size > 0 || !same(state.base, state.data);

  function imgSrc(path, name) {
    if (!path) return avatar(name);
    if (/^(https?:|data:)/.test(path)) return path;
    if (state.previews.has(path)) return state.previews.get(path);
    return '../' + path;
  }
  // Si Pages todavía no publica una imagen recién subida, se toma directo del repositorio.
  document.addEventListener('error', (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.fallback) return;
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('../')) return;
    img.dataset.fallback = '1';
    img.src = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${src.slice(3)}`;
  }, true);

  /* ---------- Arranque: login / configuración ---------- */
  async function loadAuth() {
    try {
      const f = await gh.getFile(CONFIG.authPath, null);
      if (f) { const j = JSON.parse(f.content); if (j && j.data) return { auth: j, sha: f.sha }; }
      else return null;
    } catch (e) { /* API sin acceso (p. ej. límite); probamos la copia publicada */ }
    try {
      const r = await fetch('../' + CONFIG.authPath + '?v=' + Date.now(), { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j && j.data) return { auth: j, sha: null }; }
    } catch (e) {}
    return null;
  }

  function showAuth(which) {
    $('#authView').hidden = false;
    $('#appView').hidden = true;
    $('#loadingBox').hidden = which !== 'loading';
    $('#loginBox').hidden = which !== 'login';
    $('#setupBox').hidden = which !== 'setup';
    if (which === 'login') setTimeout(() => $('#loginPw').focus(), 50);
  }

  async function boot() {
    $$('.repo-name').forEach((el) => (el.textContent = CONFIG.owner + '/' + CONFIG.repo));
    const params = new URLSearchParams({ name: 'Panel ' + CONFIG.repo, description: 'Edición del sitio desde /editar', target_name: CONFIG.owner, expires_in: 'none', contents: 'write' });
    $('#tokenLink').href = 'https://github.com/settings/personal-access-tokens/new?' + params;

    const saved = store.get(TOKEN_KEY);
    if (saved) {
      gh.token = saved;
      try { await enterApp(); return; } catch (e) { store.del(TOKEN_KEY); gh.token = null; }
    }
    showAuth('loading');
    const a = await loadAuth();
    if (a) { state.auth = a.auth; state.authSha = a.sha; showAuth('login'); }
    else showAuth('setup');
  }

  $$('.eye').forEach((b) => b.addEventListener('click', () => {
    const i = b.previousElementSibling; i.type = i.type === 'password' ? 'text' : 'password';
  }));

  $('#loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter || $('#loginForm button[type=submit]');
    const err = $('#loginErr'); err.hidden = true;
    btn.classList.add('loading');
    try {
      let token;
      try { token = await decryptToken(state.auth, $('#loginPw').value); }
      catch (e) { throw new Error('Contraseña incorrecta.'); }
      gh.token = token;
      store.set(TOKEN_KEY, token);
      await enterApp();
    } catch (e) {
      err.textContent = e.status !== undefined ? friendlyError(e) : e.message; err.hidden = false;
      $('#loginPw').select();
    } finally { btn.classList.remove('loading'); }
  });

  $('#setupForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter || $('#setupForm button[type=submit]');
    const err = $('#setupErr'); err.hidden = true;
    const token = $('#setupToken').value.trim();
    const pw = $('#setupPw').value, pw2 = $('#setupPw2').value;
    if (pw !== pw2) { err.textContent = 'Las contraseñas no coinciden.'; err.hidden = false; return; }
    btn.classList.add('loading');
    try {
      await gh.req(`/repos/${CONFIG.owner}/${CONFIG.repo}`, {}, token);
      const existing = await gh.getFile(CONFIG.authPath, token);
      if (existing) {
        const ok = await confirmBox('El panel ya estaba configurado. ¿Reemplazar la contraseña anterior por esta nueva?', 'Reemplazar');
        if (!ok) return;
      }
      const auth = await encryptToken(token, pw);
      const res = await gh.putFile(CONFIG.authPath, utf8ToB64(JSON.stringify(auth, null, 2) + '\n'), 'Configura acceso al panel /editar', existing && existing.sha, token);
      state.auth = auth; state.authSha = res.content.sha;
      gh.token = token; store.set(TOKEN_KEY, token);
      await enterApp();
      toast('¡Listo! Comparte la contraseña con tu equipo.', 'ok', 6000);
    } catch (e) {
      err.textContent = friendlyError(e); err.hidden = false;
    } finally { btn.classList.remove('loading'); }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    if (isDirty() && !(await confirmBox('Tienes cambios sin publicar. Si sales se perderán. ¿Salir de todos modos?', 'Salir'))) return;
    store.del(TOKEN_KEY); gh.token = null;
    state.base = state.data = null; state.pending.clear();
    location.reload();
  });

  /* ---------- Carga de datos ---------- */
  async function fetchRemote() {
    const f = await gh.getFile(CONFIG.dataPath);
    if (!f) return { sha: null, data: { empresa: {}, miembros: [] } };
    return { sha: f.sha, data: JSON.parse(f.content) };
  }

  async function enterApp() {
    const r = await fetchRemote();
    r.data.empresa = r.data.empresa || {};
    r.data.miembros = r.data.miembros || [];
    state.base = clone(r.data);
    state.data = clone(r.data);
    $('#authView').hidden = true;
    $('#appView').hidden = false;
    renderAll();
  }

  /* ---------- Render ---------- */
  function applyTheme() {
    const e = state.data.empresa;
    document.documentElement.style.setProperty('--primary', e.colorPrimario || '#0b5cad');
    document.documentElement.style.setProperty('--accent', e.colorAcento || '#1fb6e8');
    $('#tbName').textContent = e.nombre || 'Mi empresa';
    $('#tbLogo').src = imgSrc(e.logo || 'assets/logo.svg');
  }

  function renderAll() {
    applyTheme();
    renderTiles();
    renderCompany();
    updateDirty();
  }

  function updateDirty() {
    const base = new Map(state.base.miembros.map((m) => [m.id, m]));
    let n = state.data.miembros.filter((m) => !same(base.get(m.id), m)).length;
    n += state.base.miembros.filter((m) => !state.data.miembros.some((x) => x.id === m.id)).length;
    if (!same(state.base.empresa, state.data.empresa)) n++;
    const orderChanged = state.base.miembros.map((m) => m.id).join() !== state.data.miembros.map((m) => m.id).join();
    if (n === 0 && orderChanged) n = 1;
    const dirty = isDirty();
    $('#publishBtn').disabled = !dirty;
    $('#pendingCount').hidden = !dirty;
    $('#pendingCount').textContent = Math.max(n, dirty ? 1 : 0);
  }

  function renderTiles() {
    const base = new Map(state.base.miembros.map((m) => [m.id, m]));
    $('#tiles').innerHTML = state.data.miembros.map((m, i) => {
      const flags = [];
      const b = base.get(m.id);
      if (!b) flags.push('<span class="flag new">Nuevo</span>');
      if (m.visible === false) flags.push('<span class="flag off">Oculto</span>');
      if (!normUrl(m.portafolio)) flags.push('<span class="flag warn">Sin enlace</span>');
      return `<button class="tile ${b && !same(b, m) ? 'dirty' : ''}" draggable="true" data-id="${esc(m.id)}">
        <img src="${esc(imgSrc(m.foto, m.nombre))}" alt="" style="object-position:50% ${+m.fotoPos || 30}%">
        <span class="t-flags">${flags.join('')}</span><span class="num">${i + 1}</span>
        <div class="t-body"><div class="t-name">${esc(m.nombre || 'Sin nombre')}</div><div class="t-spec">${esc(m.especialidad || '—')}</div></div>
      </button>`;
    }).join('');
  }

  // abrir / arrastrar tiles
  let dragId = null;
  $('#tiles').addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t) openMember(t.dataset.id); });
  $('#tiles').addEventListener('dragstart', (e) => { const t = e.target.closest('.tile'); if (!t) return; dragId = t.dataset.id; t.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
  $('#tiles').addEventListener('dragend', () => { dragId = null; $$('.tile').forEach((t) => t.classList.remove('dragging', 'over')); });
  $('#tiles').addEventListener('dragover', (e) => {
    const t = e.target.closest('.tile'); if (!t || !dragId) return;
    e.preventDefault(); $$('.tile.over').forEach((x) => x !== t && x.classList.remove('over')); t.classList.add('over');
  });
  $('#tiles').addEventListener('drop', (e) => {
    const t = e.target.closest('.tile'); if (!t || !dragId) return;
    e.preventDefault();
    const list = state.data.miembros;
    const from = list.findIndex((m) => m.id === dragId), to = list.findIndex((m) => m.id === t.dataset.id);
    if (from < 0 || to < 0 || from === to) return;
    list.splice(to, 0, list.splice(from, 1)[0]);
    renderTiles(); updateDirty();
  });

  $('#addMember').addEventListener('click', () => {
    const id = 'm' + Date.now().toString(36);
    state.data.miembros.push({ id, visible: true, nombre: 'Nuevo integrante', especialidad: '', email: '', telefono: '', extras: [], portafolio: '', foto: '', fotoPos: 30 });
    renderTiles(); updateDirty(); openMember(id);
  });

  /* ---------- Editor de integrante ---------- */
  function memberById(id) { return state.data.miembros.find((m) => m.id === id); }

  function previewCardHTML(m) {
    const lines = [];
    if (m.email) lines.push(`<li>e-mail: ${esc(m.email)}</li>`);
    if (m.telefono) lines.push(`<li>Teléfono: ${esc(m.telefono)}</li>`);
    (m.extras || []).forEach((x) => { if (x.etiqueta || x.valor) lines.push(`<li>${x.etiqueta ? esc(x.etiqueta) + ': ' : ''}${esc(x.valor)}</li>`); });
    return `<h3>${esc(m.nombre || 'Sin nombre')}</h3>${m.especialidad ? `<p class="role">${esc(m.especialidad)}</p>` : ''}<ul>${lines.join('')}</ul>`;
  }

  function openMember(id) {
    const m = memberById(id); if (!m) return;
    state.editing = id;
    m.extras = m.extras || [];
    $('#drawerTitle').textContent = 'Editar: ' + (m.nombre || 'integrante');
    $('#drawerBody').innerHTML = `
      <div class="photo-col">
        <div class="preview-card">
          <div class="pc-media" id="photoDrop" title="Cambiar foto">
            <img id="mPhoto" src="${esc(imgSrc(m.foto, m.nombre))}" alt="" style="object-position:50% ${+m.fotoPos || 30}%">
            <div class="overlay">📷 Clic o arrastra<br>una foto aquí</div>
          </div>
          <div class="pc-body" id="mPreview">${previewCardHTML(m)}</div>
        </div>
        <input type="file" id="mFile" accept="image/*" hidden>
        <div class="photo-actions">
          <button class="btn small" type="button" id="mPhotoBtn">Cambiar foto</button>
          <button class="btn small ghost" type="button" id="mPhotoDel">Quitar</button>
        </div>
        <label class="range">Encuadre vertical de la foto
          <input type="range" min="0" max="100" value="${+m.fotoPos || 30}" id="mPos">
        </label>
      </div>
      <div class="form-col">
        <div class="box">
          <label class="field"><span>Enlace del portafolio <span class="hint">(a dónde lleva su tarjeta)</span></span>
            <div class="link-row"><input data-m="portafolio" value="${esc(m.portafolio)}" placeholder="https://…" inputmode="url"><button class="btn small" type="button" id="mTest">Probar ↗</button></div>
          </label>
          <label class="field"><span>Nombre completo</span><input data-m="nombre" value="${esc(m.nombre)}"></label>
          <label class="field"><span>Especialidad / área</span><input data-m="especialidad" value="${esc(m.especialidad)}"></label>
          <div class="row2">
            <label class="field"><span>E-mail</span><input data-m="email" type="email" value="${esc(m.email)}"></label>
            <label class="field"><span>Teléfono</span><input data-m="telefono" value="${esc(m.telefono)}"></label>
          </div>
          <div class="field"><span>Datos adicionales <span class="hint">(ej. Ubicación, LinkedIn, Ext.)</span></span>
            <div class="extras" id="mExtras"></div>
            <button class="btn small" type="button" id="mAddExtra">＋ Agregar dato</button>
          </div>
          <label class="switch"><input type="checkbox" id="mVisible" ${m.visible !== false ? 'checked' : ''}> Mostrar en el sitio</label>
        </div>
        <div class="drawer-actions">
          <div style="display:flex;gap:8px">
            <button class="btn small" type="button" id="mUp" title="Mover antes">↑ Antes</button>
            <button class="btn small" type="button" id="mDown" title="Mover después">↓ Después</button>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn small danger" type="button" id="mDelete">Eliminar</button>
            <button class="btn small primary" type="button" data-close>Listo</button>
          </div>
        </div>
        <p class="hint" style="margin-top:14px">Los cambios se guardan aquí al momento. Para que se vean en el sitio, pulsa <b>Publicar cambios</b> arriba.</p>
      </div>`;
    renderExtras(m);
    $('#drawerWrap').hidden = false;

    const refresh = () => { $('#mPreview').innerHTML = previewCardHTML(m); renderTiles(); updateDirty(); };
    $$('[data-m]', $('#drawerBody')).forEach((inp) => inp.addEventListener('input', () => {
      m[inp.dataset.m] = inp.value;
      if (inp.dataset.m === 'nombre') $('#drawerTitle').textContent = 'Editar: ' + (inp.value || 'integrante');
      refresh();
    }));
    $('[data-m="portafolio"]').addEventListener('blur', (e) => { const v = normUrl(e.target.value); if (v !== e.target.value) { e.target.value = v; m.portafolio = v; refresh(); } });
    $('#mTest').onclick = () => { const u = normUrl(m.portafolio); if (u) window.open(u, '_blank', 'noopener'); else toast('Primero escribe el enlace.'); };
    $('#mVisible').onchange = (e) => { m.visible = e.target.checked; refresh(); };
    $('#mPos').oninput = (e) => { m.fotoPos = +e.target.value; $('#mPhoto').style.objectPosition = `50% ${m.fotoPos}%`; refresh(); };
    $('#mAddExtra').onclick = () => { m.extras.push({ etiqueta: '', valor: '' }); renderExtras(m); refresh(); const ins = $$('#mExtras input'); ins[ins.length - 2] && ins[ins.length - 2].focus(); };
    $('#mExtras').oninput = (e) => {
      const row = e.target.closest('.extra'); if (!row) return;
      m.extras[+row.dataset.i][e.target.dataset.k] = e.target.value; refresh();
    };
    $('#mExtras').onclick = (e) => {
      const b = e.target.closest('[data-del]'); if (!b) return;
      m.extras.splice(+b.dataset.del, 1); renderExtras(m); refresh();
    };
    const pick = () => $('#mFile').click();
    $('#photoDrop').onclick = pick; $('#mPhotoBtn').onclick = pick;
    $('#mFile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) setMemberPhoto(m, f); };
    dropZone($('#photoDrop'), (f) => setMemberPhoto(m, f));
    $('#mPhotoDel').onclick = () => { dropPending(m.foto); m.foto = ''; $('#mPhoto').src = imgSrc('', m.nombre); refresh(); };
    $('#mUp').onclick = () => move(m.id, -1);
    $('#mDown').onclick = () => move(m.id, 1);
    $('#mDelete').onclick = async () => {
      if (!(await confirmBox(`¿Eliminar a "${m.nombre}" del sitio? Se quitará al publicar los cambios.`, 'Eliminar'))) return;
      dropPending(m.foto);
      state.data.miembros = state.data.miembros.filter((x) => x.id !== m.id);
      closeDrawer(); renderTiles(); updateDirty();
    };
  }

  function renderExtras(m) {
    $('#mExtras').innerHTML = m.extras.map((x, i) => `
      <div class="extra" data-i="${i}">
        <input data-k="etiqueta" value="${esc(x.etiqueta)}" placeholder="Etiqueta (ej. Ubicación)">
        <input data-k="valor" value="${esc(x.valor)}" placeholder="Valor">
        <button class="btn small ghost" type="button" data-del="${i}" title="Quitar">✕</button>
      </div>`).join('');
  }

  function move(id, dir) {
    const list = state.data.miembros, i = list.findIndex((m) => m.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    renderTiles(); updateDirty();
    toast(`Ahora está en la posición ${j + 1}.`, '', 1800);
  }

  function closeDrawer() { $('#drawerWrap').hidden = true; state.editing = null; }
  $('#drawerWrap').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDrawer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawerWrap').hidden && $('#modal').hidden) closeDrawer(); });

  /* ---------- Imágenes ---------- */
  function dropZone(el, onFile) {
    el.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); el.classList.add('over'); } });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) onFile(f); });
  }
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen. Prueba con JPG o PNG.')); };
      img.src = url;
    });
  }
  async function processImage(file, { max = 900, keepAlpha = false } = {}) {
    if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
    if (file.size > 20 * 1024 * 1024) throw new Error('La imagen pesa más de 20 MB.');
    if (file.type === 'image/svg+xml') {
      const text = await file.text();
      const b64 = utf8ToB64(text);
      return { b64, dataUrl: 'data:image/svg+xml;base64,' + b64, ext: 'svg' };
    }
    const img = await loadImage(file);
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    if (!keepAlpha) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const type = keepAlpha ? 'image/png' : 'image/jpeg';
    const dataUrl = cv.toDataURL(type, 0.86);
    return { b64: dataUrl.split(',')[1], dataUrl, ext: keepAlpha ? 'png' : 'jpg' };
  }
  function slug(s) { return String(s || 'img').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'img'; }
  function dropPending(path) { if (path && state.pending.has(path)) { state.pending.delete(path); state.previews.delete(path); } }
  function addPending(prefix, r) {
    const path = `${CONFIG.uploadsDir}/${prefix}-${Date.now().toString(36)}.${r.ext}`;
    state.pending.set(path, r.b64);
    state.previews.set(path, r.dataUrl);
    return path;
  }
  async function setMemberPhoto(m, file) {
    try {
      const r = await processImage(file, { max: 900 });
      dropPending(m.foto);
      m.foto = addPending(slug(m.nombre), r);
      if (state.editing === m.id) $('#mPhoto').src = r.dataUrl;
      renderTiles(); updateDirty();
      toast('Foto lista. Pulsa "Publicar cambios" para subirla.', 'ok', 2600);
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------- Empresa ---------- */
  function renderCompany() {
    const e = state.data.empresa;
    $$('[data-e]').forEach((inp) => {
      const k = inp.dataset.e;
      if (inp.type === 'color') inp.value = e[k] || (k === 'colorPrimario' ? '#0b5cad' : '#1fb6e8');
      else inp.value = e[k] || '';
    });
    $('#logoPreview').src = imgSrc(e.logo || 'assets/logo.svg');
  }
  $$('[data-e]').forEach((inp) => inp.addEventListener('input', () => {
    state.data.empresa[inp.dataset.e] = inp.value;
    applyTheme(); updateDirty();
  }));
  $('#logoDrop').addEventListener('click', () => $('#logoFile').click());
  $('#logoFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) setLogo(f); });
  dropZone($('#logoDrop'), setLogo);
  async function setLogo(file) {
    try {
      const r = await processImage(file, { max: 600, keepAlpha: true });
      dropPending(state.data.empresa.logo);
      state.data.empresa.logo = addPending('logo', r);
      renderCompany(); applyTheme(); updateDirty();
      toast('Logo listo. Pulsa "Publicar cambios" para subirlo.', 'ok', 2600);
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------- Pestañas ---------- */
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.panel').forEach((p) => (p.hidden = p.dataset.panel !== t.dataset.tab));
  }));

  /* ---------- Publicar (con fusión para no pisar cambios de otros) ---------- */
  function mergeData(base, local, remote) {
    const out = clone(remote);
    out.empresa = out.empresa || {};
    const be = base.empresa || {}, le = local.empresa || {};
    for (const k of new Set([...Object.keys(be), ...Object.keys(le)])) {
      if (!same(le[k], be[k])) { if (le[k] === undefined) delete out.empresa[k]; else out.empresa[k] = clone(le[k]); }
    }
    const bm = new Map(base.miembros.map((m) => [m.id, m]));
    const lm = new Map(local.miembros.map((m) => [m.id, m]));
    const rlist = (out.miembros || []).filter((m) => !(bm.has(m.id) && !lm.has(m.id)));
    const rm = new Map(rlist.map((m) => [m.id, m]));
    for (const m of local.miembros) { const b = bm.get(m.id); if (!b || !same(b, m)) rm.set(m.id, clone(m)); }
    let order;
    if (base.miembros.map((m) => m.id).join() !== local.miembros.map((m) => m.id).join()) {
      order = local.miembros.map((m) => m.id);
      rlist.forEach((m) => { if (!order.includes(m.id)) order.push(m.id); });
    } else {
      order = rlist.map((m) => m.id);
      local.miembros.forEach((m) => { if (!order.includes(m.id)) order.push(m.id); });
    }
    out.miembros = order.filter((id) => rm.has(id)).map((id) => rm.get(id));
    return out;
  }
  window.__mergeData = mergeData; // para pruebas

  $('#publishBtn').addEventListener('click', async () => {
    const btn = $('#publishBtn');
    btn.classList.add('loading');
    try {
      // 1) subir imágenes nuevas
      for (const [path, b64] of [...state.pending]) {
        await gh.putFile(path, b64, 'Imagen desde /editar: ' + path.split('/').pop());
        state.pending.delete(path);
      }
      // 2) fusionar con lo último publicado y guardar
      let merged;
      for (let attempt = 0; ; attempt++) {
        const remote = await fetchRemote();
        merged = mergeData(state.base, state.data, remote.data);
        try {
          await gh.putFile(CONFIG.dataPath, utf8ToB64(JSON.stringify(merged, null, 2) + '\n'), 'Actualiza el sitio desde /editar', remote.sha);
          break;
        } catch (e) {
          if ((e.status === 409 || e.status === 422) && attempt < 3) continue;
          throw e;
        }
      }
      state.base = clone(merged);
      state.data = clone(merged);
      renderAll();
      toast('✔ Publicado. El sitio se actualiza en 1–2 minutos.', 'ok', 6000);
    } catch (e) {
      toast(friendlyError(e), 'err', 8000);
      updateDirty();
    } finally { btn.classList.remove('loading'); }
  });

  window.addEventListener('beforeunload', (e) => { if (state.data && isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- Acceso ---------- */
  $('#accessForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter || $('#accessForm button[type=submit]');
    const newToken = $('#accToken').value.trim();
    const pw = $('#accPw').value, pw2 = $('#accPw2').value;
    if (pw !== pw2) { toast('Las contraseñas no coinciden.', 'err'); return; }
    btn.classList.add('loading');
    try {
      const token = newToken || gh.token;
      if (newToken) await gh.req(`/repos/${CONFIG.owner}/${CONFIG.repo}`, {}, newToken);
      const existing = await gh.getFile(CONFIG.authPath, token);
      const auth = await encryptToken(token, pw);
      await gh.putFile(CONFIG.authPath, utf8ToB64(JSON.stringify(auth, null, 2) + '\n'), 'Actualiza acceso al panel /editar', existing && existing.sha, token);
      gh.token = token; store.set(TOKEN_KEY, token); state.auth = auth;
      ev.target.reset();
      toast('Acceso actualizado. Comparte la nueva contraseña con el equipo.', 'ok', 6000);
    } catch (e) { toast(friendlyError(e), 'err', 8000); }
    finally { btn.classList.remove('loading'); }
  });

  $('#backupBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `respaldo-sitio-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#restoreBtn').addEventListener('click', () => $('#restoreFile').click());
  $('#restoreFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j || !Array.isArray(j.miembros)) throw new Error('El archivo no es un respaldo válido.');
      if (!(await confirmBox('Esto reemplazará los datos actuales por los del respaldo (al publicar). ¿Continuar?', 'Restaurar'))) return;
      state.data = { empresa: j.empresa || {}, miembros: j.miembros };
      renderAll();
      toast('Respaldo cargado. Revisa y pulsa "Publicar cambios".', 'ok');
    } catch (err) { toast(err.message || 'No se pudo leer el respaldo.', 'err'); }
  });

  if (!window.crypto || !crypto.subtle) {
    document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">Abre el panel desde la dirección https:// del sitio.</p>';
    return;
  }
  boot().catch((e) => { showAuth('setup'); $('#setupErr').textContent = friendlyError(e); $('#setupErr').hidden = false; });
})();
