/* 꼭 알아야 하는 경제 상식 152 — 책 읽기 뷰어
 * book.json(목차)과 chapters/*.md(본문)만 있으면 동작한다. 빌드 과정 없음. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var main = $('#main');
  var book = null;
  var flat = [];            // 모든 장을 순서대로 편 목록
  var byId = {};
  var mdCache = {};
  var plainCache = null;    // 전문 검색용
  var lastIndex = -1;       // 페이지 넘김 방향 계산용

  /* ---------- 저장소 (실패해도 동작하도록) ---------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('eg.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('eg.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  var readSet = new Set(store.get('read', []));
  function markRead(id) {
    if (readSet.has(id)) return;
    readSet.add(id);
    store.set('read', Array.from(readSet));
    document.querySelectorAll('[data-cid="' + id + '"]').forEach(function (a) { a.classList.add('read'); });
    updateStats();
  }

  /* ---------- 유틸 ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function chNo(c) { return pad(c.no); }
  function fetchMd(id) {
    if (mdCache[id] !== undefined) return Promise.resolve(mdCache[id]);
    return fetch('chapters/' + id + '.md', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .catch(function () { return null; })
      .then(function (t) { mdCache[id] = t; return t; });
  }
  function toPlain(md) {
    return md
      .replace(/^## 더 알아보기[\s\S]*$/m, ' ')
      .replace(/<details>[\s\S]*?<summary>[\s\S]*?<\/summary>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^>\s*\[![A-Z]+\]\s*$/gm, ' ')
      .replace(/[#>*_`|~-]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  /* ---------- 마크다운 렌더링 ---------- */
  marked.setOptions({ gfm: true, breaks: false });
  var CALLOUT = { NOTE: '참고', TIP: '알아두면 좋아요', WARNING: '주의', IMPORTANT: '꼭 기억하세요', CAUTION: '주의' };

  function renderMarkdown(md) {
    var html = DOMPurify.sanitize(marked.parse(md), { ADD_TAGS: ['details', 'summary'], ADD_ATTR: ['open'] });
    var box = document.createElement('div');
    box.innerHTML = html;

    // GitHub 스타일 강조 상자: > [!TIP]
    box.querySelectorAll('blockquote').forEach(function (bq) {
      var p = bq.firstElementChild;
      if (!p || p.tagName !== 'P') return;
      var m = p.innerHTML.match(/^\s*\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*(<br>)?\s*/i);
      if (!m) return;
      var type = m[1].toUpperCase();
      p.innerHTML = p.innerHTML.slice(m[0].length);
      if (!p.innerHTML.trim()) p.remove();
      bq.className = 'callout callout-' + (type === 'CAUTION' ? 'warning' : type.toLowerCase());
      var t = document.createElement('span');
      t.className = 'callout-title';
      t.textContent = CALLOUT[type];
      bq.insertBefore(t, bq.firstChild);
    });
    // 넓은 표는 가로 스크롤
    box.querySelectorAll('table').forEach(function (t) {
      var w = document.createElement('div');
      w.className = 'table-wrap';
      t.parentNode.insertBefore(w, t);
      w.appendChild(t);
      t.querySelectorAll('th, td').forEach(function (cell) {
        if (cell.textContent.trim().length <= 14) cell.style.whiteSpace = 'nowrap';
      });
    });
    // 외부 링크는 새 창
    box.querySelectorAll('a[href]').forEach(function (a) {
      var h = a.getAttribute('href');
      if (/^https?:\/\//.test(h)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    });
    return box.innerHTML;
  }

  /* ---------- 화면: 표지 ---------- */
  function partProgress(p) {
    var n = p.chapters.filter(function (c) { return readSet.has(c.id); }).length;
    return { n: n, total: p.chapters.length, pct: Math.round(n / p.chapters.length * 100) };
  }
  function todayChapter() {
    var d = new Date();
    var day = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
    return flat[(day * 37) % flat.length];
  }

  function renderHome() {
    document.title = book.title;
    var last = store.get('last', null);
    var lastCh = last && byId[last];
    var t = todayChapter();

    var parts = book.parts.map(function (p) {
      var pr = partProgress(p);
      return '<a class="part-card" href="#/part/' + p.no + '">' +
        '<span class="pc-no">' + p.no + '</span>' +
        '<span class="pc-tag">' + esc(p.tagline) + '</span>' +
        '<span class="pc-title">' + esc(p.title) + '</span>' +
        '<span class="pc-bar"><i><b style="width:' + pr.pct + '%"></b></i>' + pr.n + ' / ' + pr.total + '</span>' +
        '</a>';
    }).join('');

    var toc = book.parts.map(function (p) {
      return '<section><h3><span>' + p.no + '부</span>' + esc(p.title) + '</h3><ol>' +
        p.chapters.map(function (c) { return tocLink(c, 'no'); }).join('') + '</ol></section>';
    }).join('');

    main.innerHTML =
      '<div class="home">' +
        '<div class="cover" role="img" aria-label="책 표지: ' + esc(book.title) + '">' +
          '<span class="cover-kicker">ECONOMICS · ESSENTIALS</span>' +
          '<h1 class="cover-title">꼭 알아야 하는<br>경제 상식<span class="num">152</span></h1>' +
          '<p class="cover-sub">' + esc(book.subtitle) + '<br>기초 체력부터 세계경제까지, 하루 한 장.</p>' +
          '<div class="cover-foot"><span>4부 152장 · ' + esc(book.asOf) + ' 기준</span><span class="cover-seal" aria-hidden="true">經</span></div>' +
        '</div>' +
        '<div class="cta">' +
          (lastCh
            ? '<a class="btn btn-primary" href="#/' + lastCh.id + '">이어 읽기 · ' + lastCh.part.no + '-' + chNo(lastCh) + '</a><a class="btn btn-ghost" href="#/' + flat[0].id + '">처음부터</a>'
            : '<a class="btn btn-primary" href="#/' + flat[0].id + '">첫 장 펼치기 →</a>') +
        '</div>' +
        '<p class="home-stat" id="homeStat"></p>' +
        '<a class="today" href="#/' + t.id + '"><span class="t-icon">今</span><span class="t-k">오늘의 경제 상식 · ' + t.part.no + '부 ' + chNo(t) + '장</span><span class="t-t">' + esc(t.title) + '</span></a>' +
        '<h2 class="section-title">네 개의 부 <small>관심 있는 곳부터 펼쳐도 좋아요</small></h2>' +
        '<div class="parts">' + parts + '</div>' +
        '<h2 class="section-title">차례 <small>152장</small></h2>' +
        '<div class="full-toc">' + toc + '</div>' +
        '<div class="colophon">' +
          '<p><b>이 책의 원칙</b> — 모든 장은 공신력 있는 기관 자료를 바탕으로 쓰고, 바뀔 수 있는 수치·제도에는 기준 시점을 적었습니다. 예시 계산의 숫자는 이해를 돕기 위한 가정입니다. 이 책은 투자 권유가 아니며, 금융상품 가입·투자 결정 전에는 해당 기관의 최신 공시를 꼭 확인하세요.</p>' +
          '<p>내용 기준: ' + esc(book.asOf) + ' · 오류 제보는 GitHub 저장소의 Issues로 알려주세요.</p>' +
        '</div>' +
      '</div>';
    updateStats();
  }

  function tocLink(c, cls) {
    return '<li><a href="#/' + c.id + '" data-cid="' + c.id + '"' + (readSet.has(c.id) ? ' class="read"' : '') + '>' +
      '<span class="' + cls + '">' + c.part.no + '-' + chNo(c) + '</span><span>' + esc(c.title) + '</span></a></li>';
  }

  /* ---------- 화면: 부 표제지 ---------- */
  function renderPart(no) {
    var p = book.parts.filter(function (x) { return x.no === no; })[0];
    if (!p) return renderHome();
    document.title = p.no + '부 ' + p.title + ' · ' + book.title;
    var pr = partProgress(p);
    main.innerHTML =
      '<div class="part-open">' +
        '<div class="po-no">제 ' + p.no + ' 부</div>' +
        '<h1>' + esc(p.title) + '</h1>' +
        '<p class="po-tag">' + esc(p.tagline) + '</p>' +
        '<div class="orn" aria-hidden="true">❖ ❖ ❖</div>' +
        '<p class="home-stat">' + pr.total + '장 중 ' + pr.n + '장 읽음</p>' +
        '<ol>' + p.chapters.map(function (c) {
          return '<li><a href="#/' + c.id + '" data-cid="' + c.id + '"' + (readSet.has(c.id) ? ' class="read"' : '') + '><span class="no">' + chNo(c) + '</span><span>' + esc(c.title) + '</span></a></li>';
        }).join('') + '</ol>' +
        '<a class="btn btn-primary" href="#/' + p.chapters[0].id + '">' + p.no + '부 첫 장 읽기 →</a>' +
      '</div>';
  }

  /* ---------- 화면: 본문 ---------- */
  var endObserver = null;

  function renderChapter(c) {
    var dir = lastIndex < 0 ? '' : (c.index > lastIndex ? 'turn-next' : c.index < lastIndex ? 'turn-prev' : '');
    lastIndex = c.index;
    store.set('last', c.id);
    document.title = c.title + ' · ' + book.title;
    main.innerHTML = '<div class="loading">책장을 넘기는 중…</div>';

    fetchMd(c.id).then(function (md) {
      if (location.hash.slice(2) !== c.id) return; // 그새 다른 장으로 이동함
      var prev = flat[c.index - 1], next = flat[c.index + 1];
      var body, mins = '';
      if (md) {
        body = renderMarkdown(md);
        var chars = toPlain(md).replace(/\s/g, '').length;
        mins = '약 ' + Math.max(1, Math.round(chars / 500)) + '분 읽기';
      } else {
        body = '<h1>' + esc(c.title) + '</h1><div class="pending"><b>집필 중인 장이에요</b>곧 채워질 예정입니다. 다른 장을 먼저 읽어보세요.</div>';
      }
      main.innerHTML =
        '<div class="reader ' + dir + '">' +
          '<article class="sheet">' +
            '<header class="ch-head">' +
              '<div class="ch-kicker"><a href="#/part/' + c.part.no + '">제' + c.part.no + '부 · ' + esc(c.part.title) + '</a></div>' +
              '<div class="ch-no" aria-hidden="true">' + chNo(c) + '</div>' +
            '</header>' +
            '<div class="prose">' + body + '</div>' +
            (mins ? '<p class="ch-meta" style="text-align:center">' + mins + '</p>' : '') +
            '<div class="ch-end" aria-hidden="true">❖ ❖ ❖</div>' +
            '<div class="folio"><span>' + (c.index + 1) + ' / ' + flat.length + '</span></div>' +
            '<div id="endMark" style="height:1px"></div>' +
          '</article>' +
          '<nav class="pager" aria-label="장 이동">' +
            (prev ? '<a class="prev" href="#/' + prev.id + '" rel="prev"><span class="pg-dir">← 이전 장</span><span class="pg-t">' + esc(prev.title) + '</span></a>' : '') +
            (next ? '<a class="next" href="#/' + next.id + '" rel="next"><span class="pg-dir">다음 장 →</span><span class="pg-t">' + esc(next.title) + '</span></a>'
                  : '<a class="next" href="#/"><span class="pg-dir">끝까지 읽었어요!</span><span class="pg-t">표지로 돌아가기</span></a>') +
          '</nav>' +
          '<p class="swipe-hint">좌우로 밀거나 ← → 키로 책장을 넘길 수 있어요</p>' +
        '</div>';

      // 장 끝까지 읽으면 '읽음' 표시
      if (endObserver) endObserver.disconnect();
      if (md && 'IntersectionObserver' in window) {
        endObserver = new IntersectionObserver(function (es) {
          if (es[0].isIntersecting) { markRead(c.id); endObserver.disconnect(); }
        });
        endObserver.observe($('#endMark'));
      }
      onScroll();
    });
  }

  /* ---------- 라우터 ---------- */
  function route() {
    var h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    closeAll();
    window.scrollTo(0, 0);
    var m;
    if (!h) { lastIndex = -1; renderHome(); }
    else if ((m = h.match(/^part\/(\d)$/))) { lastIndex = -1; renderPart(+m[1]); }
    else if (byId[h]) renderChapter(byId[h]);
    else { lastIndex = -1; renderHome(); }
    highlightToc();
    main.focus({ preventScroll: true });
  }

  /* ---------- 목차 서랍 ---------- */
  var drawer = $('#drawer'), scrim = $('#scrim'), tocBtn = $('#tocBtn');
  function buildDrawer() {
    $('#drawerNav').innerHTML = book.parts.map(function (p) {
      return '<details class="toc-part" data-part="' + p.no + '"><summary><span class="pn">' + p.no + '부</span><span class="pt">' + esc(p.title) + '</span><span class="pc" data-pc="' + p.no + '"></span></summary>' +
        '<ol class="toc-list">' + p.chapters.map(function (c) { return tocLink(c, 'no'); }).join('') + '</ol></details>';
    }).join('');
  }
  function highlightToc() {
    var id = location.hash.replace(/^#\/?/, '');
    document.querySelectorAll('#drawerNav a').forEach(function (a) {
      if (a.dataset.cid === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function openDrawer() {
    drawer.hidden = false; scrim.hidden = false; tocBtn.setAttribute('aria-expanded', 'true');
    var id = location.hash.replace(/^#\/?/, '');
    var c = byId[id];
    document.querySelectorAll('.toc-part').forEach(function (d) { d.open = c ? +d.dataset.part === c.part.no : false; });
    var cur = $('#drawerNav a[aria-current]');
    if (cur) cur.scrollIntoView({ block: 'center' });
    $('#drawerClose').focus();
  }
  function closeDrawer() { drawer.hidden = true; if (settingsEl.hidden) scrim.hidden = true; tocBtn.setAttribute('aria-expanded', 'false'); }
  tocBtn.addEventListener('click', openDrawer);
  $('#drawerClose').addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeAll);

  function updateStats() {
    var n = readSet.size;
    var s = $('#drawerStat'); if (s) s.textContent = n + ' / ' + flat.length + '장 읽음';
    var hs = $('#homeStat'); if (hs) hs.textContent = n ? '지금까지 ' + n + '장을 읽었어요 (' + Math.round(n / flat.length * 100) + '%)' : '하루 한 장, 10분이면 충분해요.';
    if (book) book.parts.forEach(function (p) {
      var el = document.querySelector('[data-pc="' + p.no + '"]');
      if (el) { var pr = partProgress(p); el.textContent = pr.n + '/' + pr.total; }
    });
  }

  /* ---------- 읽기 설정 ---------- */
  var settingsEl = $('#settings'), settingsBtn = $('#settingsBtn');
  var settings = store.get('settings', {});
  function applySettings() {
    var root = document.documentElement;
    if (settings.theme && settings.theme !== 'auto') root.dataset.theme = settings.theme; else delete root.dataset.theme;
    root.dataset.font = settings.font || 'serif';
    var size = settings.size || 18;
    root.style.setProperty('--read-size', size + 'px');
    $('#sizeOut').textContent = size;
    settingsEl.querySelectorAll('[data-font]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.font === (settings.font || 'serif'))); });
    settingsEl.querySelectorAll('[data-theme]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.theme === (settings.theme || 'auto'))); });
    store.set('settings', settings);
  }
  settingsBtn.addEventListener('click', function () {
    var open = settingsEl.hidden;
    closeAll();
    settingsEl.hidden = !open;
    settingsBtn.setAttribute('aria-expanded', String(open));
  });
  settingsEl.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.size) settings.size = Math.min(26, Math.max(15, (settings.size || 18) + +b.dataset.size));
    if (b.dataset.font) settings.font = b.dataset.font;
    if (b.dataset.theme) settings.theme = b.dataset.theme;
    applySettings();
  });
  document.addEventListener('click', function (e) {
    if (!settingsEl.hidden && !settingsEl.contains(e.target) && !settingsBtn.contains(e.target)) {
      settingsEl.hidden = true; settingsBtn.setAttribute('aria-expanded', 'false');
    }
  });

  /* ---------- 검색 ---------- */
  var searchEl = $('#search'), searchInput = $('#searchInput'), results = $('#searchResults'), hint = $('#searchHint');
  function openSearch() {
    closeAll();
    searchEl.hidden = false;
    searchInput.focus();
    searchInput.select();
    loadAllText();
  }
  function closeSearch() { searchEl.hidden = true; }
  function loadAllText() {
    if (plainCache) return Promise.resolve(plainCache);
    hint.textContent = '본문을 불러오는 중… 제목 검색은 바로 됩니다.';
    return Promise.all(flat.map(function (c) { return fetchMd(c.id); })).then(function (all) {
      plainCache = {};
      all.forEach(function (md, i) { if (md) plainCache[flat[i].id] = toPlain(md); });
      hint.textContent = '제목과 본문 ' + Object.keys(plainCache).length + '장에서 찾습니다.';
      doSearch();
      return plainCache;
    });
  }
  function doSearch() {
    var q = searchInput.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    var ql = q.toLowerCase();
    var terms = ql.split(/\s+/).filter(Boolean);
    var hits = [];
    flat.forEach(function (c) {
      var title = c.title.toLowerCase();
      var text = plainCache && plainCache[c.id] ? plainCache[c.id] : '';
      var tl = text.toLowerCase();
      var score = 0;
      terms.forEach(function (t) {
        if (title.indexOf(t) >= 0) score += 10;
        var n = 0, i = -1;
        while ((i = tl.indexOf(t, i + 1)) >= 0 && n < 20) n++;
        score += n;
        if (title.indexOf(t) < 0 && n === 0) score -= 1000;
      });
      if (score > 0) {
        var pos = tl.indexOf(terms[0]);
        var snip = pos >= 0 ? (pos > 40 ? '…' : '') + text.slice(Math.max(0, pos - 40), pos + 80) + '…' : '';
        hits.push({ c: c, score: score, snip: snip });
      }
    });
    hits.sort(function (a, b) { return b.score - a.score; });
    var re = new RegExp('(' + terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'gi');
    var hl = function (s) { return esc(s).replace(re, '<mark>$1</mark>'); };
    results.innerHTML = hits.length
      ? hits.slice(0, 40).map(function (h) {
          return '<li><a href="#/' + h.c.id + '"><span class="sr-meta">' + h.c.part.no + '부 · ' + chNo(h.c) + '장</span><span class="sr-title">' + hl(h.c.title) + '</span>' +
            (h.snip ? '<span class="sr-snip">' + hl(h.snip) + '</span>' : '') + '</a></li>';
        }).join('')
      : '<li class="search-hint">"' + esc(q) + '"에 대한 결과가 없어요. 다른 낱말로 찾아보세요.</li>';
  }
  var searchTimer;
  searchInput.addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 120); });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { var a = results.querySelector('a'); if (a) a.click(); }
  });
  $('#searchBtn').addEventListener('click', openSearch);
  $('#searchClose').addEventListener('click', closeSearch);

  function closeAll() {
    drawer.hidden = true; scrim.hidden = true; tocBtn.setAttribute('aria-expanded', 'false');
    searchEl.hidden = true;
    settingsEl.hidden = true; settingsBtn.setAttribute('aria-expanded', 'false');
  }

  /* ---------- 책장 넘기기: 키보드 · 스와이프 ---------- */
  function go(delta) {
    var c = byId[location.hash.replace(/^#\/?/, '')];
    if (!c) return;
    var t = flat[c.index + delta];
    if (t) location.hash = '#/' + t.id;
  }
  document.addEventListener('keydown', function (e) {
    var typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === 'Escape') { closeAll(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); openSearch(); }
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  });

  var tx = 0, ty = 0, tt = 0, tOk = false;
  main.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { tOk = false; return; }
    tOk = !e.target.closest('.table-wrap, pre, .search');
    tx = e.touches[0].clientX; ty = e.touches[0].clientY; tt = Date.now();
  }, { passive: true });
  main.addEventListener('touchend', function (e) {
    if (!tOk) return;
    var dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Date.now() - tt < 600 && Math.abs(dx) > 70 && Math.abs(dy) < Math.abs(dx) * 0.5) {
      var sel = window.getSelection && String(window.getSelection());
      if (!sel) go(dx < 0 ? 1 : -1);
    }
  }, { passive: true });

  /* ---------- 스크롤: 진행 막대 · 상단바 ---------- */
  var topbar = $('#topbar'), bar = $('#progressBar'), lastY = 0, ticking = false;
  function onScroll() {
    var y = window.scrollY, h = document.documentElement.scrollHeight - innerHeight;
    var reading = !!$('.reader');
    bar.style.width = reading && h > 0 ? Math.min(100, y / h * 100) + '%' : '0';
    topbar.classList.toggle('scrolled', y > 4);
    topbar.classList.toggle('hide', reading && y > 160 && y > lastY + 4 && drawer.hidden && settingsEl.hidden);
    if (y < lastY - 4 || y < 160) topbar.classList.remove('hide');
    lastY = y;
    ticking = false;
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });

  /* ---------- 시작 ---------- */
  applySettings();
  fetch('book.json', { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(function (b) {
      book = b;
      b.parts.forEach(function (p) {
        p.chapters.forEach(function (c, i) {
          c.part = p; c.no = i + 1; c.index = flat.length;
          flat.push(c); byId[c.id] = c;
        });
      });
      buildDrawer();
      updateStats();
      window.addEventListener('hashchange', route);
      route();
    })
    .catch(function () {
      main.innerHTML = '<div class="loading">목차(book.json)를 불러오지 못했어요. 로컬에서 볼 때는 간단한 웹서버로 열어주세요.<br><code>python -m http.server</code></div>';
    });
})();
