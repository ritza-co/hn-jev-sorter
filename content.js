(() => {
  if (window.__hnSorter) { window.__hnSorter.toggle(); return; }

  const PALETTE = ['#ff5d5d', '#ffa63d', '#f5d547', '#5fd38d', '#3cc8e8', '#6f8cff', '#b77dff', '#ff6fb5', '#9fb3c8', '#4fe0c0', '#ff8a65', '#c5e15a'];
  const SUGGESTED = [
    { name: 'Astroturfing accusations', description: 'Accuses the company, other commenters, or the votes of being shills, bots, paid marketing, or astroturfing' },
    { name: "It's overhyped", description: 'Says it is hype, a bubble, overvalued, or will not live up to the claims' },
    { name: 'Technical skepticism', description: 'Doubts the technology works or is novel, or says competitors and alternatives are as good or better' },
    { name: 'Impressed / bullish', description: 'Praises the product, team, or deal, or is optimistic about its future' },
    { name: 'Money & business', description: 'Discusses valuation, investors, funding, revenue, or business model on its merits' },
    { name: 'Personal experience', description: "Describes the commenter's own use of the product or similar tools" },
    { name: 'Jokes & snark', description: 'Mainly a joke, pun, sarcasm, or a one-line quip' },
    { name: 'Off topic', description: 'A tangent unrelated to the story or to the comment it replies to' }
  ];
  const OTHER = { id: 'other', name: 'Other', description: 'None of the other categories fit', color: '#8a8f98' };
  const CONCURRENCY = 6, LAUNCH_GAP = 115, FLIGHT_MS = 1050, PILE_STEP = 2, PILE_MAX = 11;

  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'category';
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const bez = (a, b, c, d, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };
  const bezD = (a, b, c, d, t) => { const u = 1 - t; return 3 * u * u * (b - a) + 6 * u * t * (c - b) + 3 * t * t * (d - c); };

  function withIds(list) {
    const used = new Set(['other']);
    return list.map((c, i) => {
      let id = slug(c.name), n = 2;
      while (used.has(id)) id = `${slug(c.name)}_${n++}`;
      used.add(id);
      return { id, name: c.name, description: c.description, color: PALETTE[i % PALETTE.length] };
    });
  }

  // ---------- page data ----------
  function readThread() {
    const title = document.querySelector('.titleline > a')?.textContent || document.title;
    const site = document.querySelector('.sitestr')?.textContent || '';
    const story = document.querySelector('.fatitem .toptext')?.innerText.trim() || '';
    const rows = [...document.querySelectorAll('tr.athing.comtr')];
    const stack = [], comments = [];
    for (const row of rows) {
      const depth = Number(row.querySelector('td.ind')?.getAttribute('indent')) || 0;
      const textEl = row.querySelector('.commtext');
      stack[depth] = textEl ? textEl.innerText.trim() : '';
      stack.length = depth + 1;
      if (!textEl || !stack[depth]) continue;
      comments.push({
        id: row.id, row, depth,
        box: row.querySelector('td.default') || row,
        author: row.querySelector('.hnuser')?.textContent || 'anon',
        age: row.querySelector('.age a')?.textContent || '',
        text: stack[depth],
        parent: depth > 0 ? (stack[depth - 1] || '').slice(0, 600) : ''
      });
    }
    let state = `Hacker News thread: "${title}"${site ? ` (${site})` : ''}.`;
    if (story) state += `\nStory text: ${story.slice(0, 1200)}`;
    return { state, comments };
  }

  // ---------- shell ----------
  const host = el('div');
  host.id = 'hn-sorter-host';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
  const root = host.attachShadow({ mode: 'open' });
  const style = el('style');
  style.textContent = CSS();
  root.append(style);

  const bar = el('div', 'bar');
  const head = el('div', 'head');
  const brand = el('div', 'brand');
  brand.append(el('span', 'logo', '▲'), el('span', 'title', 'HN Jev Sorter'), el('span', 'by', 'Jev by TypeSafe · real time'));
  const status = el('div', 'status', 'Ready');
  const progress = el('div', 'progress'); const fill = el('div', 'fill'); progress.append(fill);
  const runBtn = el('button', 'btn primary', 'Run');
  const followBtn = el('button', 'btn ghost on', 'Follow');
  followBtn.title = 'Scroll the page along with the sort';
  const editBtn = el('button', 'btn ghost', 'Edit buckets');
  const keyBtn = el('button', 'btn ghost', 'API key');
  const closeBtn = el('button', 'btn icon', '✕');
  closeBtn.title = 'Close';
  head.append(brand, status, progress, followBtn, keyBtn, editBtn, runBtn, closeBtn);
  const buckets = el('div', 'buckets');
  bar.append(head, buckets);

  const editor = el('div', 'editor');
  const keyCard = el('div', 'keycard');
  const pop = el('div', 'pop');
  const flights = el('div', 'flights');
  root.append(flights, bar, editor, keyCard, pop);
  document.documentElement.append(host);

  let categories = [], bucketEls = new Map(), running = false, runToken = 0, follow = true;
  let usage = { input: 0, output: 0 }, visible = true;
  const bodyPad = document.body.style.paddingTop;

  function setPad() {
    document.body.style.transition = 'padding-top .45s cubic-bezier(.2,.8,.2,1)';
    document.body.style.paddingTop = visible ? `${bar.offsetHeight + 8}px` : bodyPad;
  }

  // ---------- buckets ----------
  function allCats() { return [...categories, OTHER]; }

  function renderBuckets() {
    buckets.textContent = '';
    bucketEls.clear();
    for (const cat of allCats()) {
      const b = el('div', 'bucket');
      b.style.setProperty('--c', cat.color);
      const top = el('div', 'btop');
      const count = el('span', 'count', '0');
      top.append(el('span', 'bname', cat.name), count);
      const pile = el('div', 'pile');
      pile.append(el('div', 'floor'));
      b.append(top, pile);
      b.addEventListener('mouseenter', () => openPop(cat.id));
      b.addEventListener('mouseleave', schedulePopClose);
      b.addEventListener('click', () => { pinned = pinned === cat.id ? null : cat.id; openPop(cat.id); });
      buckets.append(b);
      bucketEls.set(cat.id, { b, count, pile, n: 0, cat, items: [] });
    }
    requestAnimationFrame(setPad);
  }

  function pileTarget(id) {
    const { pile, n } = bucketEls.get(id);
    const r = pile.getBoundingClientRect();
    const h = Math.min(n, PILE_MAX) * PILE_STEP;
    return { x: r.left + r.width / 2, y: r.bottom - 14 - h, w: r.width * .78 };
  }

  function land(id, item) {
    const entry = bucketEls.get(id);
    entry.n++;
    entry.items.push(item);
    entry.count.textContent = entry.n;
    entry.count.animate([{ transform: 'scale(1.6)', color: '#fff' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1.4)' });
    const card = el('div', 'mini');
    card.style.setProperty('--r', `${(Math.random() - .5) * 7}deg`);
    card.style.setProperty('--y', `${-Math.min(entry.n - 1, PILE_MAX) * PILE_STEP}px`);
    card.append(el('b', '', item.author), el('i', '', item.text.slice(0, 60)));
    entry.pile.append(card);
    const minis = entry.pile.querySelectorAll('.mini');
    if (minis.length > PILE_MAX + 1) minis[0].remove();
    entry.pile.querySelectorAll('.mini').forEach((m, i, all) => {
      m.style.setProperty('--y', `${-Math.min(i, PILE_MAX) * PILE_STEP}px`);
      m.style.opacity = String(clamp(.35 + (i / all.length) * .65, .35, 1));
    });
    card.style.opacity = '1';
    const y = -Math.min(entry.pile.querySelectorAll('.mini').length - 1, PILE_MAX) * PILE_STEP, rot = card.style.getPropertyValue('--r');
    card.animate([
      { transform: `translate(-50%, ${y - 14}px) rotate(${rot}) scale(1.12)`, filter: 'brightness(1.8)' },
      { transform: `translate(-50%, ${y}px) rotate(${rot}) scale(1)`, filter: 'brightness(1)' }
    ], { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
    entry.b.animate([
      { transform: 'translateY(0) scale(1)' }, { transform: 'translateY(3px) scale(.97)', offset: .3 }, { transform: 'translateY(-2px) scale(1.03)', offset: .65 }, { transform: 'none' }
    ], { duration: 420, easing: 'ease-out' });
    entry.b.classList.remove('glow'); void entry.b.offsetWidth; entry.b.classList.add('glow');
    if (popId === id) fillPop(id);
  }

  // ---------- flight ----------
  function inView(r) { return r.height > 0 && r.top >= bar.offsetHeight && r.top <= innerHeight - 60; }

  function launch(item, cat) {
    const src = item.box.getBoundingClientRect();
    const fromPage = src.height > 0 && src.bottom > bar.offsetHeight && src.top < innerHeight;
    const width = clamp(fromPage ? src.width : 460, 260, 560);
    const card = el('div', 'fly');
    card.style.setProperty('--c', cat.color);
    card.style.width = `${width}px`;
    const h = el('div', 'fhead');
    h.append(el('b', '', item.author), el('span', '', item.age), el('em', '', cat.name));
    card.append(h, el('div', 'ftext', item.text));
    flights.append(card);
    const ch = card.offsetHeight;
    const x0 = fromPage ? src.left + width / 2 : clamp(src.left || innerWidth / 2, 20, innerWidth - width - 20) + width / 2;
    const y0 = fromPage ? src.top + Math.min(ch, src.height) / 2 : innerHeight + ch / 2 + 20;
    const t = pileTarget(cat.id);
    const dir = t.x < x0 ? -1 : 1;
    const c1 = { x: x0 - dir * 140, y: y0 - 30 };
    const c2 = { x: t.x - dir * 60, y: t.y + 260 };
    const endScale = t.w / width;
    const frames = [{ offset: 0, transform: `translate(${x0 - width / 2}px, ${y0 - ch / 2}px) scale(1)`, opacity: fromPage ? 1 : 0 }];
    frames.push({ offset: .1, transform: `translate(${x0 - width / 2}px, ${y0 - ch / 2 - 8}px) scale(1.04) rotate(${-dir * 1.5}deg)`, opacity: 1 });
    const N = 26;
    for (let i = 1; i <= N; i++) {
      const p = ease(i / N);
      const x = bez(x0, c1.x, c2.x, t.x, p), y = bez(y0, c1.y, c2.y, t.y, p);
      const vx = bezD(x0, c1.x, c2.x, t.x, p);
      const s = 1.04 + (endScale - 1.04) * Math.pow(p, .75);
      const rot = clamp(vx / 90, -14, 14) * (1 - p * p);
      frames.push({
        offset: .1 + .9 * (i / N),
        transform: `translate(${x - width / 2}px, ${y - ch / 2}px) rotate(${rot}deg) scale(${s})`,
        opacity: i / N > .9 ? 1 - (i / N - .9) * 6 : 1
      });
    }
    const anim = card.animate(frames, { duration: FLIGHT_MS, easing: 'linear', fill: 'forwards' });
    [55, 110].forEach((delay, i) => {
      const g = el('div', 'trail');
      g.style.setProperty('--c', cat.color);
      g.style.width = `${width}px`; g.style.height = `${ch}px`; g.style.opacity = '0';
      flights.insertBefore(g, card);
      const a = g.animate(frames.map(f => ({ offset: f.offset, transform: f.transform, opacity: Math.min(Number(f.opacity), 1) * (i ? .22 : .4) * (f.offset < .1 ? 0 : 1) })), { duration: FLIGHT_MS, delay, easing: 'linear', fill: 'forwards' });
      a.finished.then(() => g.remove());
    });
    mark(item, cat);
    const token = runToken;
    anim.finished.then(() => { card.remove(); if (token === runToken) land(cat.id, item); });
  }

  function mark(item, cat) {
    item.box.classList.add('hns-marked');
    item.box.style.setProperty('--hns', cat.color);
    let tag = item.box.querySelector('.hns-tag');
    if (!tag) { tag = el('span', 'hns-tag'); item.box.querySelector('.comhead')?.append(tag); }
    tag.textContent = `${cat.name} · ${Math.round(item.p * 100)}%`;
    tag.style.background = cat.color;
    item.box.animate([{ backgroundColor: `${cat.color}55` }, { backgroundColor: 'transparent' }], { duration: 900, easing: 'ease-out' });
  }

  // ---------- follow scroll ----------
  let scrollTarget = null;
  function followTo(item) {
    if (!follow) return;
    const r = item.box.getBoundingClientRect();
    if (!r.height) return;
    scrollTarget = clamp(scrollY + r.top - (bar.offsetHeight + (innerHeight - bar.offsetHeight) * .38), 0, document.documentElement.scrollHeight - innerHeight);
  }
  (function scrollLoop() {
    if (scrollTarget != null && follow) {
      const d = scrollTarget - scrollY;
      if (Math.abs(d) < 1) scrollTarget = null; else scrollTo(0, scrollY + d * .16);
    }
    requestAnimationFrame(scrollLoop);
  })();
  const stopFollow = e => { if (e.composedPath().includes(host)) return; if (running && follow) { follow = false; scrollTarget = null; followBtn.classList.remove('on'); } };
  addEventListener('wheel', stopFollow, { passive: true });
  addEventListener('touchmove', stopFollow, { passive: true });
  followBtn.onclick = () => { follow = !follow; followBtn.classList.toggle('on', follow); if (!follow) scrollTarget = null; };

  // ---------- run ----------
  function setStatus(text, err) { status.textContent = text; status.classList.toggle('err', !!err); }

  async function run() {
    if (running) { running = false; runToken++; runBtn.textContent = 'Run'; setStatus('Stopped'); return; }
    const { apiKey } = await chrome.storage.local.get('apiKey');
    if (!apiKey) { openKeyCard(true); return; }
    const { state, comments } = readThread();
    if (!comments.length) { setStatus('No comments on this page', true); return; }
    reset();
    const token = ++runToken;
    running = true; runBtn.textContent = 'Stop';
    if (!followBtn.classList.contains('on')) { follow = true; followBtn.classList.add('on'); }
    const cats = allCats().map(({ id, name, description }) => ({ id, name, description }));
    let next = 0, done = 0, failed = 0, launched = 0, started = performance.now();
    const ready = new Map();
    const total = comments.length;
    const update = () => {
      fill.style.width = `${(launched / total) * 100}%`;
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      setStatus(`${launched}/${total} sorted · ${done} classified in ${secs}s${failed ? ` · ${failed} failed` : ''} · ${(usage.input + usage.output).toLocaleString()} tokens`, failed && !done);
    };
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (next < total && token === runToken) {
        const i = next++, item = comments[i];
        let res;
        try { res = await chrome.runtime.sendMessage({ type: 'HNS_CLASSIFY', state, comment: item.text.slice(0, 1800), parent: item.parent, categories: cats }); }
        catch (e) { res = { ok: false, error: e.message }; }
        if (token !== runToken) return;
        if (res.ok) {
          done++;
          usage.input += res.usage?.input_tokens || 0; usage.output += res.usage?.output_tokens || 0;
          const id = res.answer.choice in Object.fromEntries(cats.map(c => [c.id])) ? res.answer.choice : 'other';
          ready.set(i, { id, p: res.answer.probabilities?.[id] ?? res.answer.confidence ?? 0 });
        } else { failed++; ready.set(i, { error: res.error }); setStatus(res.error, true); }
        update();
      }
    });
    // launcher: thread order, one swoosh every LAUNCH_GAP ms
    let cursor = 0, waitSince = 0;
    await new Promise(resolve => {
      const tick = () => {
        if (token !== runToken) return resolve();
        if (cursor >= total) return resolve();
        const item = comments[cursor];
        followTo(item);
        if (ready.has(cursor)) {
          const r = ready.get(cursor);
          if (r.error) { cursor++; return setTimeout(tick, 0); }
          const rect = item.box.getBoundingClientRect();
          if (!waitSince) waitSince = performance.now();
          if (!follow || !rect.height || inView(rect) || performance.now() - waitSince > 300) {
            item.p = r.p;
            const cat = allCats().find(c => c.id === r.id);
            launch(item, cat);
            launched++; cursor++; waitSince = 0; update();
            return setTimeout(tick, LAUNCH_GAP);
          }
        }
        setTimeout(tick, 30);
      };
      tick();
    });
    await Promise.all(workers);
    if (token !== runToken) return;
    running = false; runBtn.textContent = 'Run again';
    setTimeout(() => { if (token === runToken) setStatus(`Done · ${launched} comments in ${((performance.now() - started) / 1000).toFixed(1)}s${failed ? ` · ${failed} failed` : ''} · ${(usage.input + usage.output).toLocaleString()} tokens`, failed && !launched); }, FLIGHT_MS);
  }

  function reset() {
    runToken++;
    usage = { input: 0, output: 0 };
    fill.style.width = '0';
    flights.textContent = '';
    document.querySelectorAll('.hns-marked').forEach(n => { n.classList.remove('hns-marked'); n.querySelector('.hns-tag')?.remove(); });
    renderBuckets();
    closePop(true);
  }

  // ---------- popover ----------
  let popId = null, pinned = null, popTimer = 0;
  pop.addEventListener('mouseenter', () => clearTimeout(popTimer));
  pop.addEventListener('mouseleave', schedulePopClose);
  function schedulePopClose() { clearTimeout(popTimer); popTimer = setTimeout(() => { if (!pinned) closePop(); }, 220); }
  function closePop(force) { if (force) pinned = null; popId = null; pop.classList.remove('open'); }
  function openPop(id) {
    clearTimeout(popTimer);
    if (pinned && pinned !== id) return;
    popId = id;
    fillPop(id);
    const r = bucketEls.get(id).b.getBoundingClientRect();
    const w = Math.min(460, innerWidth - 24);
    pop.style.left = `${clamp(r.left + r.width / 2 - w / 2, 12, innerWidth - w - 12)}px`;
    pop.style.top = `${r.bottom + 10}px`;
    pop.style.width = `${w}px`;
    pop.style.setProperty('--c', bucketEls.get(id).cat.color);
    pop.classList.add('open');
  }
  function fillPop(id) {
    const { cat } = bucketEls.get(id);
    const landed = [...bucketEls.get(id).items].sort((a, b) => b.p - a.p);
    const keepScroll = pop.querySelector('.plist')?.scrollTop || 0;
    pop.textContent = '';
    const ph = el('div', 'phead');
    ph.append(el('span', 'pdot'), el('b', '', cat.name), el('span', 'pcount', `${landed.length} comment${landed.length === 1 ? '' : 's'}`));
    if (pinned === id) { const x = el('button', 'btn icon small', '✕'); x.onclick = e => { e.stopPropagation(); closePop(true); }; ph.append(x); }
    pop.append(ph, el('div', 'pdesc', cat.description));
    const list = el('div', 'plist');
    if (!landed.length) list.append(el('div', 'empty', running ? 'Nothing here yet…' : 'Empty. Press Run to sort.'));
    for (const r of landed) {
      const row = el('div', 'pitem');
      const meta = el('div', 'pmeta');
      const conf = el('span', 'conf'); const cf = el('span'); cf.style.width = `${Math.round(r.p * 100)}%`; conf.append(cf);
      meta.append(el('b', '', r.author), el('span', '', r.age), conf, el('span', 'pct', `${Math.round(r.p * 100)}%`));
      row.append(meta, el('div', 'ptext', r.text));
      row.onclick = () => {
        follow = false; followBtn.classList.remove('on'); scrollTarget = null;
        r.box.scrollIntoView({ behavior: 'smooth', block: 'center' });
        r.box.animate([{ backgroundColor: `${cat.color}66` }, { backgroundColor: 'transparent' }], { duration: 1600, delay: 350, easing: 'ease-out' });
      };
      list.append(row);
    }
    pop.append(list);
    list.scrollTop = keepScroll;
  }

  // ---------- editor ----------
  let draft = [];
  function openEditor() {
    if (editor.classList.contains('open')) return closeEditor();
    closeKeyCard();
    draft = categories.map(c => ({ ...c }));
    renderEditor();
    editor.style.top = `${bar.offsetHeight + 8}px`;
    editor.classList.add('open');
    editBtn.classList.add('on');
  }
  function closeEditor() { editor.classList.remove('open'); editBtn.classList.remove('on'); }
  async function renderEditor() {
    editor.textContent = '';
    const h = el('div', 'ehead');
    h.append(el('b', '', 'Buckets'), el('span', '', 'Name each bucket and describe what belongs in it. TypeSafe reads the descriptions.'));
    editor.append(h);
    const list = el('div', 'elist');
    draft.forEach((c, i) => {
      const row = el('div', 'erow');
      const dot = el('span', 'edot'); dot.style.background = PALETTE[i % PALETTE.length];
      const name = el('input', 'ename'); name.value = c.name; name.placeholder = 'Bucket name';
      name.oninput = () => { c.name = name.value; };
      const desc = el('input', 'edesc'); desc.value = c.description; desc.placeholder = 'What belongs in this bucket?';
      desc.oninput = () => { c.description = desc.value; };
      const del = el('button', 'btn icon small', '✕'); del.title = 'Remove';
      del.onclick = () => { draft.splice(i, 1); renderEditor(); };
      row.append(dot, name, desc, del);
      list.append(row);
    });
    const otherRow = el('div', 'erow fixed');
    const od = el('span', 'edot'); od.style.background = OTHER.color;
    otherRow.append(od, el('span', 'ename', OTHER.name), el('span', 'edesc', `${OTHER.description} (always included)`));
    list.append(otherRow);
    editor.append(list);
    const actions = el('div', 'eactions');
    const add = el('button', 'btn ghost', '+ Add bucket');
    add.onclick = () => { if (draft.length < PALETTE.length) { draft.push({ name: '', description: '' }); renderEditor().then(() => [...editor.querySelectorAll('.ename')].at(-2)?.focus()); } };
    const sugg = el('button', 'btn ghost', 'Reset to suggestions');
    sugg.onclick = () => { draft = SUGGESTED.map(c => ({ ...c })); renderEditor(); };
    const cancel = el('button', 'btn ghost', 'Cancel'); cancel.onclick = closeEditor;
    const save = el('button', 'btn primary', 'Save');
    save.onclick = async () => {
      const clean = draft.map(c => ({ name: c.name.trim(), description: c.description.trim() })).filter(c => c.name);
      categories = withIds(clean);
      await chrome.storage.local.set({ categories: clean });
      closeEditor();
      reset();
      setStatus('Buckets saved. Press Run.');
    };
    actions.append(add, sugg, el('span', 'spacer'), cancel, save);
    editor.append(actions);
  }

  // ---------- API key ----------
  async function openKeyCard(thenRun) {
    if (keyCard.classList.contains('open') && !thenRun) return closeKeyCard();
    closeEditor();
    const { apiKey = '' } = await chrome.storage.local.get('apiKey');
    keyCard.textContent = '';
    const h = el('div', 'khead');
    h.append(el('span', 'kicon', '⚿'), el('b', '', apiKey ? 'Your Jev API key' : 'Connect Jev to start sorting'));
    const p = el('p', 'kdesc', 'Comments are classified by Jev, TypeSafe\'s decision model. Paste an API key from the TypeSafe console. It is stored only in this browser.');
    const link = el('a', 'klink', 'Get a key at console.typesafe.ai →');
    link.href = 'https://console.typesafe.ai/keys'; link.target = '_blank'; link.rel = 'noopener';
    const row = el('div', 'krow');
    const input = el('input', 'kinput'); input.type = 'password'; input.value = apiKey; input.placeholder = 'Paste your API key'; input.spellcheck = false;
    const show = el('button', 'btn ghost small', 'Show');
    show.onclick = () => { input.type = input.type === 'password' ? 'text' : 'password'; show.textContent = input.type === 'password' ? 'Show' : 'Hide'; };
    const save = el('button', 'btn primary', thenRun ? 'Save & run' : 'Save');
    const msg = el('div', 'kmsg');
    const submit = async () => {
      const key = input.value.trim();
      if (!key) { msg.textContent = 'Paste a key first.'; msg.className = 'kmsg err'; return; }
      save.textContent = 'Checking…'; msg.textContent = ''; msg.className = 'kmsg';
      const res = await chrome.runtime.sendMessage({ type: 'HNS_TEST_KEY', key }).catch(e => ({ ok: false, error: e.message }));
      if (!res.ok) { save.textContent = thenRun ? 'Save & run' : 'Save'; msg.textContent = res.error; msg.className = 'kmsg err'; return; }
      await chrome.storage.local.set({ apiKey: key });
      msg.textContent = '✓ Key works'; msg.className = 'kmsg ok';
      setTimeout(() => { closeKeyCard(); setStatus('Ready'); if (thenRun) run(); }, 500);
    };
    save.onclick = submit;
    input.onkeydown = e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') closeKeyCard(); };
    row.append(input, show, save);
    keyCard.append(h, p, row, msg, link);
    if (apiKey) {
      const forget = el('button', 'btn ghost small kforget', 'Remove key');
      forget.onclick = async () => { await chrome.storage.local.remove('apiKey'); closeKeyCard(); setStatus('API key removed'); };
      keyCard.append(forget);
    }
    keyCard.style.top = `${bar.offsetHeight + 8}px`;
    keyCard.classList.add('open'); keyBtn.classList.add('on');
    setTimeout(() => input.focus(), 50);
  }
  function closeKeyCard() { keyCard.classList.remove('open'); keyBtn.classList.remove('on'); }

  // ---------- wiring ----------
  keyBtn.onclick = () => openKeyCard(false);
  runBtn.onclick = run;
  editBtn.onclick = openEditor;
  closeBtn.onclick = () => toggle();
  addEventListener('resize', setPad);

  function toggle() {
    visible = !visible;
    if (!visible) { runToken++; running = false; runBtn.textContent = 'Run'; closeEditor(); closeKeyCard(); closePop(true); }
    host.style.display = visible ? '' : 'none';
    setPad();
  }
  window.__hnSorter = { toggle };

  const pageStyle = el('style');
  pageStyle.textContent = `
    .hns-marked { box-shadow: inset 3px 0 0 var(--hns); transition: box-shadow .3s; }
    .hns-tag { display:inline-block; margin-left:8px; padding:1px 7px; border-radius:999px; color:#111; font:600 9.5px/1.6 system-ui,-apple-system,sans-serif; letter-spacing:.02em; vertical-align:1px; animation: hnsIn .4s cubic-bezier(.2,.9,.3,1.3); }
    @keyframes hnsIn { from { transform: scale(.4); opacity:0 } }`;
  document.head.append(pageStyle);

  chrome.storage.local.get('categories').then(({ categories: saved }) => {
    categories = withIds(saved?.length ? saved : SUGGESTED);
    renderBuckets();
    bar.animate([{ transform: 'translateY(-110%)' }, { transform: 'none' }], { duration: 550, easing: 'cubic-bezier(.2,.9,.25,1)' });
    if (!document.querySelector('tr.athing.comtr')) setStatus('Open a Hacker News comment page', true);
    else chrome.storage.local.get('apiKey').then(({ apiKey }) => { if (!apiKey) { setStatus('Add your Jev API key to start'); openKeyCard(true); } });
  });

  function CSS() { return `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .bar, .editor, .pop, .fly { font: 13px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif; color: #e8eaee; -webkit-font-smoothing: antialiased; }
    .bar { position: absolute; top: 0; left: 0; right: 0; pointer-events: auto; padding: 10px 14px 12px; background: rgba(17,19,24,.86); backdrop-filter: blur(18px) saturate(1.4); -webkit-backdrop-filter: blur(18px) saturate(1.4); border-bottom: 1px solid rgba(255,255,255,.08); box-shadow: 0 10px 40px rgba(0,0,0,.25); }
    .head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .brand { display: flex; align-items: baseline; gap: 8px; white-space: nowrap; }
    .logo { color: #ff6600; font-size: 12px; }
    .title { font-weight: 650; letter-spacing: -.01em; }
    .by { color: #7d8594; font-size: 11px; }
    .status { flex: 1; min-width: 0; color: #9aa3b2; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
    .status.err { color: #ff8080; }
    .progress { width: 140px; height: 4px; border-radius: 4px; background: rgba(255,255,255,.08); overflow: hidden; }
    .fill { height: 100%; width: 0; background: linear-gradient(90deg, #ff6600, #ffb46b); border-radius: 4px; transition: width .25s ease; }
    .btn { all: unset; cursor: pointer; padding: 6px 12px; border-radius: 8px; font-weight: 550; font-size: 12px; transition: background .15s, transform .1s, color .15s; white-space: nowrap; }
    .btn:active { transform: scale(.96); }
    .btn.primary { background: #ff6600; color: #fff; box-shadow: 0 2px 10px rgba(255,102,0,.35); min-width: 46px; text-align: center; }
    .btn.primary:hover { background: #ff7a1f; }
    .btn.ghost { color: #aeb5c2; background: rgba(255,255,255,.06); }
    .btn.ghost:hover { background: rgba(255,255,255,.12); color: #fff; }
    .btn.ghost.on { color: #fff; background: rgba(255,255,255,.16); }
    .btn.icon { padding: 5px 8px; color: #7d8594; }
    .btn.icon:hover { color: #fff; background: rgba(255,255,255,.08); }
    .btn.small { padding: 3px 7px; font-size: 11px; }
    .buckets { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
    .bucket { --c: #888; flex: 1 1 0; min-width: 112px; height: 104px; position: relative; border-radius: 12px; cursor: pointer; background: linear-gradient(180deg, color-mix(in srgb, var(--c) 16%, transparent), rgba(255,255,255,.02)); border: 1px solid color-mix(in srgb, var(--c) 30%, transparent); transition: border-color .2s, background .2s; overflow: hidden; }
    .bucket:hover { border-color: var(--c); background: linear-gradient(180deg, color-mix(in srgb, var(--c) 26%, transparent), rgba(255,255,255,.04)); }
    .bucket.glow::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 1px var(--c), 0 0 24px var(--c); opacity: 0; animation: glow .6s ease-out; pointer-events: none; }
    @keyframes glow { 20% { opacity: .9 } 100% { opacity: 0 } }
    .btop { position: relative; z-index: 2; display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; padding: 7px 9px 0; }
    .bname { font-weight: 600; font-size: 11.5px; line-height: 1.25; color: #f2f4f7; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .count { font-weight: 700; font-size: 15px; color: var(--c); font-variant-numeric: tabular-nums; display: inline-block; }
    .pile { position: absolute; left: 0; right: 0; bottom: 0; height: 50px; }
    .floor { position: absolute; left: 10%; right: 10%; bottom: 8px; height: 3px; border-radius: 3px; background: color-mix(in srgb, var(--c) 45%, transparent); }
    .mini { position: absolute; left: 50%; bottom: 12px; width: 78%; height: 20px; padding: 3px 6px; border-radius: 5px; background: #fbfaf6; border-left: 3px solid var(--c); box-shadow: 0 1px 3px rgba(0,0,0,.35); transform: translate(-50%, var(--y)) rotate(var(--r)); transition: transform .3s cubic-bezier(.2,.9,.3,1.2), opacity .3s; display: flex; gap: 4px; align-items: center; overflow: hidden; white-space: nowrap; font-size: 8.5px; color: #555; }
    .mini b { color: #222; font-weight: 600; }
    .mini i { font-style: normal; overflow: hidden; text-overflow: ellipsis; }
    .flights { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
    .fly { position: absolute; left: 0; top: 0; transform-origin: 50% 50%; will-change: transform, opacity; background: #f6f6ef; color: #222; border-radius: 10px; padding: 9px 12px 10px; border-left: 4px solid var(--c); font-size: 12.5px; opacity: 0; box-shadow: 0 18px 44px rgba(0,0,0,.32), 0 2px 6px rgba(0,0,0,.18); }
    .fhead { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; font-size: 11px; color: #828282; }
    .fhead b { color: #333; }
    .fhead em { margin-left: auto; font-style: normal; font-weight: 600; font-size: 10px; padding: 1px 8px; border-radius: 999px; background: var(--c); color: #111; }
    .ftext { display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; font-family: Verdana, Geneva, sans-serif; font-size: 11.5px; line-height: 1.45; color: #111; }
    .trail { position: absolute; left: 0; top: 0; border-radius: 12px; background: radial-gradient(closest-side, var(--c), transparent); filter: blur(10px); will-change: transform, opacity; }
    .pop { position: absolute; pointer-events: auto; max-height: min(62vh, 640px); display: flex; flex-direction: column; background: rgba(20,22,28,.94); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,.1); border-top: 3px solid var(--c); border-radius: 14px; box-shadow: 0 30px 80px rgba(0,0,0,.45); opacity: 0; transform: translateY(-8px) scale(.98); transform-origin: top center; transition: opacity .18s ease, transform .22s cubic-bezier(.2,.9,.3,1.2); visibility: hidden; }
    .pop.open { opacity: 1; transform: none; visibility: visible; }
    .phead { display: flex; align-items: center; gap: 8px; padding: 12px 14px 2px; }
    .pdot { width: 9px; height: 9px; border-radius: 50%; background: var(--c); box-shadow: 0 0 10px var(--c); }
    .pcount { color: #8a93a3; margin-left: auto; font-size: 12px; }
    .pdesc { padding: 0 14px 10px 31px; color: #8a93a3; font-size: 11.5px; border-bottom: 1px solid rgba(255,255,255,.07); }
    .plist { overflow-y: auto; padding: 6px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.2) transparent; }
    .pitem { padding: 9px 10px; border-radius: 9px; cursor: pointer; transition: background .15s; animation: itemIn .3s ease both; }
    .pitem:hover { background: rgba(255,255,255,.06); }
    @keyframes itemIn { from { opacity: 0; transform: translateY(4px) } }
    .pmeta { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #8a93a3; margin-bottom: 3px; }
    .pmeta b { color: #e8eaee; font-weight: 600; }
    .conf { margin-left: auto; width: 46px; height: 3px; border-radius: 3px; background: rgba(255,255,255,.1); overflow: hidden; }
    .conf span { display: block; height: 100%; background: var(--c); }
    .pct { font-variant-numeric: tabular-nums; width: 30px; text-align: right; }
    .ptext { color: #cfd4dc; font-size: 12.5px; white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 7; -webkit-box-orient: vertical; overflow: hidden; }
    .empty { padding: 18px; text-align: center; color: #7d8594; }
    .editor { position: absolute; left: 50%; width: min(860px, calc(100vw - 24px)); pointer-events: auto; background: rgba(20,22,28,.96); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,.1); border-radius: 14px; box-shadow: 0 30px 80px rgba(0,0,0,.45); padding: 14px; opacity: 0; visibility: hidden; transform: translate(-50%, -10px); transition: opacity .2s, transform .25s cubic-bezier(.2,.9,.3,1.2), visibility .2s; max-height: 75vh; overflow-y: auto; }
    .editor.open { opacity: 1; visibility: visible; transform: translate(-50%, 0); }
    .ehead { display: flex; gap: 10px; align-items: baseline; margin-bottom: 10px; }
    .ehead span { color: #8a93a3; font-size: 12px; }
    .elist { display: flex; flex-direction: column; gap: 6px; }
    .erow { display: flex; align-items: center; gap: 8px; }
    .edot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
    input { all: unset; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.08); border-radius: 7px; padding: 6px 9px; color: #e8eaee; font-size: 12.5px; transition: border-color .15s, background .15s; }
    input:focus { border-color: #ff6600; background: rgba(255,255,255,.09); }
    .ename { width: 200px; flex: none; }
    .edesc { flex: 1; min-width: 0; }
    .erow.fixed span.ename, .erow.fixed span.edesc { color: #7d8594; padding: 6px 9px; font-size: 12.5px; }
    .keycard { position: absolute; right: 14px; width: min(440px, calc(100vw - 28px)); pointer-events: auto; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif; color: #e8eaee; background: rgba(20,22,28,.96); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,.1); border-top: 3px solid #ff6600; border-radius: 14px; box-shadow: 0 30px 80px rgba(0,0,0,.45); padding: 16px; opacity: 0; visibility: hidden; transform: translateY(-10px); transition: opacity .2s, transform .25s cubic-bezier(.2,.9,.3,1.2), visibility .2s; }
    .keycard.open { opacity: 1; visibility: visible; transform: none; }
    .khead { display: flex; align-items: center; gap: 8px; font-size: 14px; }
    .kicon { color: #ff6600; font-size: 16px; }
    .kdesc { margin: 6px 0 12px; color: #8a93a3; font-size: 12.5px; }
    .krow { display: flex; gap: 8px; align-items: center; }
    .kinput { flex: 1; min-width: 0; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
    .kmsg { min-height: 18px; margin-top: 8px; font-size: 12px; color: #8a93a3; }
    .kmsg.err { color: #ff8080; } .kmsg.ok { color: #5fd38d; }
    .klink { color: #ffa25f; text-decoration: none; font-size: 12px; }
    .klink:hover { text-decoration: underline; }
    .kforget { float: right; margin-top: -3px; }
    .eactions { display: flex; gap: 8px; margin-top: 14px; }
    .spacer { flex: 1; }
  `; }
})();
