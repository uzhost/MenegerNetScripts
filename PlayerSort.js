// ==UserScript==
// @name         MeneGer Players: Advanced Filters (Mas, Price, Age, Tal, Nat; Multi-Position)
// @namespace    http://tampermonkey.net/
// @version      2025-09-04
// @description  Crawl meneger.net players list across one/many/all positions and filter by Mas, Price, Age, Talent, Nationality. Robust table parsing.
// @match        https://meneger.net/players*
// @match        https://www.meneger.net/players*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ========= CONFIG =========
  // Baseline filters (set any *_MIN/_MAX to null to ignore)
  const MAS_MIN   = 70;
  const MAS_MAX   = null;

  const PRICE_MIN = null;
  const PRICE_MAX = 1_000;

  const AGE_MIN   = null;
  const AGE_MAX   = 35;   // e.g. 25 for youth

  const TAL_MIN   = null;   // e.g. 8
  const TAL_MAX   = 9;

  // Nationality filters (match against country name or code appearing in the Nat column)
  // Examples: NAT_IN = ['Spain','ESP'];  NAT_NOT_IN = ['Russia','RUS'];
  const NAT_IN     = null;         // array of strings (case-insensitive) or null
  const NAT_NOT_IN = null;         // array of strings (case-insensitive) or null

  // Positions to scan:
  // [null]     -> scan ALL players (no pos filter)
  // ['Gk']     -> only GK
  // ['Gk','Cb','Cf', ...] -> multiple
  // null       -> respect the current page's ?pos=... (whatever you opened)
  let POS_TARGETS = [null];

  // Sorting:
  // null  -> respect current URL 'sort'
  // 'mas' -> force sort by mastery, etc.
  const FORCE_SORT = null;

  // Crawl pacing
  const PAGE_DELAY_MS = 300;
  const POS_DELAY_MS  = 600;
  const MAX_PAGES     = 2000;

  // ========= Helpers =========
  const log = (...a) => console.log('[PlayersFilter]', ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const parseIntStrict = (text) => {
    if (!text) return NaN;
    const digits = String(text).replace(/\u00A0/g, '').replace(/\D+/g, '');
    return digits ? Number(digits) : NaN;
  };
  const parseIntLoose = (text) => {
    if (!text) return NaN;
    const m = String(text).replace(/\u00A0/g, '').match(/-?\d+/);
    return m ? Number(m[0]) : NaN;
  };
  const getNatText = (cell) => {
    if (!cell) return '';
    // try flag <img alt="Spain"> or title, otherwise text
    const img = cell.querySelector('img[alt], img[title]');
    const v = img?.getAttribute('alt') || img?.getAttribute('title') || cell.textContent || '';
    return v.replace(/\s+/g, ' ').trim();
  };
  const strMatches = (value, list) => {
    if (!value || !list || !Array.isArray(list) || list.length === 0) return true;
    const v = value.toLowerCase();
    return list.some(x => v.includes(String(x).toLowerCase()));
  };
  const strNotMatches = (value, list) => {
    if (!value || !list || !Array.isArray(list) || list.length === 0) return true;
    const v = value.toLowerCase();
    return list.every(x => !v.includes(String(x).toLowerCase()));
  };

  function findPlayersTable(doc) {
    const tables = [...doc.querySelectorAll('table')];
    for (const table of tables) {
      const head = table.tHead?.rows?.[0] || table.querySelector('thead tr') || table.querySelector('tr');
      if (!head) continue;
      const headers = [...head.cells].map(td => (td.textContent || '').replace(/\u00A0/g, ' ').trim().toLowerCase());
      const idx = {
        player: headers.findIndex(h => /player/.test(h)),
        nat:    headers.findIndex(h => /^nat/.test(h)),
        pos:    headers.findIndex(h => /^pos/.test(h)),
        year:   headers.findIndex(h => /^(year|age)$/.test(h)), // some lists show "Year"
        tal:    headers.findIndex(h => /^tal/.test(h)),
        mas:    headers.findIndex(h => /\bmas\b/.test(h)),
        price:  headers.findIndex(h => /price/.test(h)),
      };
      if (idx.player === -1 || idx.price === -1) continue;

      const rows = table.tBodies.length ? [...table.tBodies[0].rows] : [...table.querySelectorAll('tbody tr')];
      const ok = rows.slice(0, 6).some(tr => tr.cells[idx.player]?.querySelector('a[href*="/player/"]'));
      if (!ok) continue;

      return { table, idx };
    }
    return null;
  }

  function parsePage(doc, debug=false) {
    const hit = findPlayersTable(doc);
    if (!hit) return { items: [], perPage: 0 };

    const { table, idx } = hit;
    const rows = table.tBodies.length ? [...table.tBodies[0].rows] : [...table.querySelectorAll('tbody tr')];

    const items = rows.map((tr, i) => {
      const txt = j => tr.cells[j]?.textContent?.trim() ?? '';
      const nat = idx.nat >= 0 ? getNatText(tr.cells[idx.nat]) : '';
      const obj = {
        name:  txt(idx.player),
        link:  tr.cells[idx.player]?.querySelector('a')?.href || '',
        nat,
        pos:   idx.pos >= 0 ? txt(idx.pos) : '',
        age:   idx.year >= 0 ? parseIntLoose(txt(idx.year)) : NaN, // "Year" behaves like age on site
        tal:   idx.tal >= 0 ? parseIntLoose(txt(idx.tal)) : NaN,
        mas:   idx.mas >= 0 ? parseIntLoose(txt(idx.mas)) : NaN,
        price: parseIntStrict(tr.cells[idx.price]?.innerText || tr.cells[idx.price]?.textContent || '')
      };
      if (debug && i < 20) {
        console.log('[PlayersFilter][Row]', obj.name, {
          Nat: obj.nat, Pos: obj.pos, Age: obj.age, Tal: obj.tal, Mas: obj.mas, Price: obj.price
        });
      }
      return obj;
    });

    return { items, perPage: rows.length };
  }

  function passFilters(p) {
    if (MAS_MIN   != null && !(p.mas   >  MAS_MIN)) return false;
    if (MAS_MAX   != null && !(p.mas   <= MAS_MAX)) return false;
    if (PRICE_MIN != null && !(p.price >= PRICE_MIN)) return false;
    if (PRICE_MAX != null && !(p.price <= PRICE_MAX)) return false;
    if (AGE_MIN   != null && Number.isFinite(p.age) && !(p.age   >= AGE_MIN)) return false;
    if (AGE_MAX   != null && Number.isFinite(p.age) && !(p.age   <= AGE_MAX)) return false;
    if (TAL_MIN   != null && Number.isFinite(p.tal) && !(p.tal   >= TAL_MIN)) return false;
    if (TAL_MAX   != null && Number.isFinite(p.tal) && !(p.tal   <= TAL_MAX)) return false;
    if (!strMatches(p.nat, NAT_IN)) return false;
    if (!strNotMatches(p.nat, NAT_NOT_IN)) return false;
    return true;
  }

  function showPanel(state) {
    const { allResults, scanned, done, filtersSummary } = state;
    let panel = document.getElementById('playersFilterPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'playersFilterPanel';
      panel.style.cssText = `
        position:fixed; right:16px; bottom:16px; width:720px; max-height:72vh; overflow:auto;
        background:#111; color:#fff; font:14px/1.4 system-ui,Segoe UI,Arial;
        border-radius:12px; box-shadow:0 12px 30px rgba(0,0,0,.35); padding:14px; z-index:999999;
      `;
      document.body.appendChild(panel);
    }
    const rows = [['#','Name','Nat','Pos','Age','Tal','Mas','Price','Link'],
      ...allResults.map((r,i)=>[i+1,r.name,r.nat,r.pos,r.age,r.tal,r.mas,r.price,r.link])];
    const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
    const csv = rows.map(r => r.map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <strong>Players Filter</strong>
        <span style="opacity:.8">— ${allResults.length} matches (scanned ~${scanned})${done?' ✓':''}</span>
        <a href="${url}" download="players_filtered.csv"
           style="margin-left:auto;background:#2ea043;color:#fff;text-decoration:none;padding:6px 10px;border-radius:8px">Download CSV</a>
      </div>
      <div style="opacity:.8; font-size:12px; margin-bottom:8px">${filtersSummary}</div>
      ${allResults.slice(0,500).map((r,i)=>`
        <div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid #333">
          <div style="width:28px;opacity:.6">${i+1}.</div>
          <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <a href="${r.link||'#'}" target="_blank" style="color:#9cdcfe;text-decoration:none">${r.name||'(no name)'}</a>
          </div>
          <div style="width:90px;opacity:.9">${r.nat||''}</div>
          <div style="width:44px;text-align:center">${r.pos||''}</div>
          <div style="width:44px;text-align:right">${Number.isFinite(r.age)?r.age:''}</div>
          <div style="width:44px;text-align:right">${Number.isFinite(r.tal)?r.tal:''}</div>
          <div style="width:64px;text-align:right">${Number.isFinite(r.mas)?r.mas:''}</div>
          <div style="width:96px;text-align:right">${Number.isFinite(r.price)?r.price.toLocaleString():''}</div>
        </div>`).join('')}
    `;
  }

  function filtersDesc() {
    const parts = [];
    if (MAS_MIN!=null)   parts.push(`Mas>${MAS_MIN}`);   if (MAS_MAX!=null) parts.push(`Mas≤${MAS_MAX}`);
    if (PRICE_MIN!=null) parts.push(`Price≥${PRICE_MIN.toLocaleString()}`); if (PRICE_MAX!=null) parts.push(`Price≤${PRICE_MAX.toLocaleString()}`);
    if (AGE_MIN!=null)   parts.push(`Age≥${AGE_MIN}`);   if (AGE_MAX!=null) parts.push(`Age≤${AGE_MAX}`);
    if (TAL_MIN!=null)   parts.push(`Tal≥${TAL_MIN}`);   if (TAL_MAX!=null) parts.push(`Tal≤${TAL_MAX}`);
    if (NAT_IN)          parts.push(`Nat in [${NAT_IN.join(', ')}]`);
    if (NAT_NOT_IN)      parts.push(`Nat not in [${NAT_NOT_IN.join(', ')}]`);
    return parts.join(' • ') || 'No filters';
  }

  // ========= Main =========
  (async () => {
    const allResults = [];
    let scanned = 0;

    if (POS_TARGETS === null) {
      const cur = new URL(location.href);
      POS_TARGETS = [cur.searchParams.get('pos') ?? null];
    }

    const base = new URL(location.origin + '/players');
    const current = new URL(location.href);
    current.searchParams.forEach((val, key) => {
      if (!['pos','start','sort'].includes(key)) base.searchParams.set(key, val);
    });

    const sortToUse = FORCE_SORT ?? (current.searchParams.get('sort') || 'mas');

    for (const pos of POS_TARGETS) {
      let start = 0;
      let page = 0;
      await sleep(POS_DELAY_MS);

      while (page < MAX_PAGES) {
        const url = new URL(base.toString());
        if (pos) url.searchParams.set('pos', pos); else url.searchParams.delete('pos');
        url.searchParams.set('sort', sortToUse);
        url.searchParams.set('start', String(start));

        const res = await fetch(url.toString(), { credentials: 'include' });
        if (!res.ok) { log('HTTP', res.status, 'stop @', url.toString()); break; }

        const html = await res.text();
        const doc  = new DOMParser().parseFromString(html, 'text/html');

        const { items, perPage } = parsePage(doc, page === 0); // debug first page per pos
        if (!perPage && !items.length) break;

        scanned += perPage || 0;
        for (const it of items) if (passFilters(it)) allResults.push(it);

        showPanel({ allResults, scanned, done:false, filtersSummary: filtersDesc() });

        if (!perPage || items.length < perPage) break;
        start += perPage;
        page++;
        await sleep(PAGE_DELAY_MS);
      }
    }

    showPanel({ allResults, scanned, done:true, filtersSummary: filtersDesc() });
    log('Done. Matches:', allResults.length);
  })();
})();
