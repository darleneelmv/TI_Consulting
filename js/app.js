/* TI Consulting — sitio público. Los datos viven en data/site.json y se editan desde /editar */
(function () {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }
  function avatar(name, i) {
    const hues = [[211, 196], [205, 188], [220, 190], [200, 175]];
    const [a, b] = hues[i % hues.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a},70%,92%)"/><stop offset="1" stop-color="hsl(${b},70%,82%)"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="200" cy="160" r="70" fill="hsl(${a},45%,70%)"/><path d="M60 400c10-90 70-140 140-140s130 50 140 140z" fill="hsl(${a},45%,70%)"/><text x="200" y="182" font-family="Sora,Arial,sans-serif" font-size="64" font-weight="700" fill="#fff" text-anchor="middle">${esc(initials(name))}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function normUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
    return 'https://' + u;
  }

  async function loadData() {
    const res = await fetch('data/site.json?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudo cargar data/site.json');
    return res.json();
  }

  function applyCompany(e) {
    const root = document.documentElement.style;
    if (e.colorPrimario) root.setProperty('--primary', e.colorPrimario);
    if (e.colorAcento) root.setProperty('--accent', e.colorAcento);
    document.querySelectorAll('[data-bind]').forEach((el) => {
      const v = e[el.dataset.bind];
      if (v !== undefined) el.textContent = v;
    });
    if (e.logo) {
      document.querySelectorAll('[data-bind-logo]').forEach((img) => (img.src = e.logo));
      document.getElementById('favicon').href = e.logo;
    }
    document.title = [e.nombre, e.lema].filter(Boolean).join(' · ');
    document.getElementById('year').textContent = new Date().getFullYear();

    const cta = [];
    if (e.email) cta.push(`<a class="btn btn-primary" href="mailto:${esc(e.email)}">${esc(e.email)}</a>`);
    if (e.telefono) cta.push(`<a class="btn btn-ghost" href="tel:${esc(e.telefono.replace(/[^\d+]/g, ''))}">${esc(e.telefono)}</a>`);
    if (e.direccion) cta.push(`<span class="btn btn-ghost">${esc(e.direccion)}</span>`);
    document.getElementById('ctaActions').innerHTML = cta.join('') || '<a class="btn btn-primary" href="#equipo">Ver al equipo</a>';

    const links = [];
    if (e.linkedin) links.push(`<a href="${esc(normUrl(e.linkedin))}" target="_blank" rel="noopener">LinkedIn</a>`);
    if (e.instagram) links.push(`<a href="${esc(normUrl(e.instagram))}" target="_blank" rel="noopener">Instagram</a>`);
    if (e.facebook) links.push(`<a href="${esc(normUrl(e.facebook))}" target="_blank" rel="noopener">Facebook</a>`);
    if (e.email) links.push(`<a href="mailto:${esc(e.email)}">${esc(e.email)}</a>`);
    document.getElementById('footerLinks').innerHTML = links.join('');
  }

  function cardHTML(m, i) {
    const url = normUrl(m.portafolio);
    const img = m.foto || avatar(m.nombre, i);
    const pos = Number.isFinite(+m.fotoPos) ? +m.fotoPos : 30;
    const lines = [];
    if (m.email) lines.push(`<li>e-mail: ${esc(m.email)}</li>`);
    if (m.telefono) lines.push(`<li>Teléfono: ${esc(m.telefono)}</li>`);
    (m.extras || []).forEach((x) => {
      if (x && (x.etiqueta || x.valor)) lines.push(`<li>${x.etiqueta ? esc(x.etiqueta) + ': ' : ''}${esc(x.valor)}</li>`);
    });
    const inner = `
      <div class="card-media">
        <img src="${esc(img)}" alt="${esc(m.nombre)}" loading="lazy" style="object-position:50% ${pos}%">
        ${url ? `<span class="card-cta">Ver portafolio <i>→</i></span>` : `<span class="badge-soon">Portafolio próximamente</span>`}
      </div>
      <div class="card-body">
        <h3>${esc(m.nombre)}</h3>
        ${m.especialidad ? `<p class="role">${esc(m.especialidad)}</p>` : ''}
        <ul>${lines.join('')}</ul>
      </div>`;
    return url
      ? `<a class="card link reveal" href="${esc(url)}" target="_blank" rel="noopener" data-i="${i}" aria-label="Ver portafolio de ${esc(m.nombre)}">${inner}</a>`
      : `<div class="card reveal" data-i="${i}">${inner}</div>`;
  }

  let members = [];
  let activeChip = '';

  function renderGrid() {
    const q = document.getElementById('q').value.trim().toLowerCase();
    const list = members.filter((m) => {
      const hay = `${m.nombre} ${m.especialidad}`.toLowerCase();
      return (!q || hay.includes(q)) && (!activeChip || m.especialidad === activeChip);
    });
    const grid = document.getElementById('grid');
    grid.innerHTML = list.map((m) => cardHTML(m, members.indexOf(m))).join('');
    document.getElementById('empty').hidden = list.length > 0;
    grid.querySelectorAll('.card').forEach((c, k) => {
      c.style.setProperty('--d', k % 4);
      observe(c);
      if (finePointer && !reduced && c.classList.contains('link')) tilt(c);
    });
  }

  function renderChips() {
    const specs = [...new Set(members.map((m) => m.especialidad).filter(Boolean))];
    const chips = document.getElementById('chips');
    if (specs.length < 2) { chips.innerHTML = ''; return; }
    chips.innerHTML = [`<button class="chip active" data-v="">Todos</button>`]
      .concat(specs.map((s) => `<button class="chip" data-v="${esc(s)}">${esc(s)}</button>`)).join('');
    chips.addEventListener('click', (ev) => {
      const b = ev.target.closest('.chip');
      if (!b) return;
      activeChip = b.dataset.v;
      chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
      renderGrid();
    });
    document.getElementById('marquee').innerHTML = [...specs, ...specs].map((s) => `<span>${esc(s)}</span>`).join('');
  }

  function tilt(card) {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.classList.add('tilting');
      card.style.setProperty('--ry', ((x - 0.5) * 8).toFixed(2) + 'deg');
      card.style.setProperty('--rx', ((0.5 - y) * 8).toFixed(2) + 'deg');
      card.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
      card.style.setProperty('--my', (y * 100).toFixed(1) + '%');
    });
    card.addEventListener('pointerleave', () => {
      card.classList.remove('tilting');
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    });
  }

  /* reveal on scroll */
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => entries.forEach((en) => {
        if (en.isIntersecting) {
          const t = en.target; t.classList.add('in'); io.unobserve(t);
          if (t.classList.contains('card')) setTimeout(() => t.classList.add('done'), 1300);
        }
      }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    : null;
  function observe(el) { io ? io.observe(el) : el.classList.add('in', 'done'); }
  document.querySelectorAll('.reveal').forEach(observe);

  /* counters */
  function countUp(el, to) {
    if (!to) { el.closest('.stat').hidden = true; return; }
    el.closest('.stat').hidden = false;
    if (reduced) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 1400;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* nav + progress */
  const nav = document.getElementById('nav');
  const bar = document.querySelector('.progress');
  function onScroll() {
    nav.classList.toggle('scrolled', window.scrollY > 40);
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.setProperty('--p', h > 0 ? (scrollY / h).toFixed(4) : 0);
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* hero network animation */
  function network() {
    const cv = document.getElementById('net');
    if (!cv || reduced) return;
    const ctx = cv.getContext('2d');
    let w, h, pts = [], mouse = { x: -999, y: -999 }, running = true;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    function size() {
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(90, (w * h) / 16000));
      pts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35, r: Math.random() * 1.6 + .6 }));
    }
    size();
    addEventListener('resize', size);
    cv.parentElement.parentElement.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    });
    cv.parentElement.parentElement.addEventListener('pointerleave', () => { mouse.x = mouse.y = -999; });
    new IntersectionObserver(([en]) => { running = en.isIntersecting; if (running) requestAnimationFrame(draw); }).observe(cv);
    function draw() {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        const dx = mouse.x - p.x, dy = mouse.y - p.y, d = Math.hypot(dx, dy);
        if (d < 160) { p.x += dx * .006; p.y += dy * .006; }
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i], b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 130) {
            ctx.strokeStyle = `rgba(140,200,255,${(1 - d / 130) * .28})`;
            ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
        const md = Math.hypot(mouse.x - pts[i].x, mouse.y - pts[i].y);
        if (md < 170) {
          ctx.strokeStyle = `rgba(120,220,255,${(1 - md / 170) * .5})`;
          ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
        }
      }
      for (const p of pts) {
        ctx.fillStyle = 'rgba(200,235,255,.85)';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  }
  network();

  document.getElementById('q').addEventListener('input', renderGrid);

  loadData().then((data) => {
    const e = data.empresa || {};
    applyCompany(e);
    members = (data.miembros || []).filter((m) => m.visible !== false);
    renderChips();
    renderGrid();
    countUp(document.querySelector('[data-count="miembros"]'), members.length);
    countUp(document.querySelector('[data-count="especialidades"]'), new Set(members.map((m) => m.especialidad).filter(Boolean)).size);
    countUp(document.querySelector('[data-count="portafolios"]'), members.filter((m) => normUrl(m.portafolio)).length);
  }).catch((err) => {
    console.error(err);
    document.getElementById('grid').innerHTML = '';
    const empty = document.getElementById('empty');
    empty.hidden = false;
    empty.textContent = 'No se pudo cargar la información. Intenta recargar la página.';
  });
})();
