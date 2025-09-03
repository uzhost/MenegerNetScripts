// ==UserScript==
// @name         MeneGer Players: Mixed Filters (Mas & Price)
// @namespace    http://tampermonkey.net/
// @version      2025-09-04
// @description  Fetch players pages (sorted once) and filter locally with multiple conditions (e.g., Mas>100 AND Price<=1).
// @match        https://meneger.net/players*
// @match        https://www.meneger.net/players*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ===== CONFIG =====
  const SORT = 'mas';          // server-side single sort to use: mas | age | tal | pos | price
  const START_FROM = 0;        // initial offset
  const PAGE_DELAY_MS = 350;   // polite delay between pages
  const MAX_PAGES = 1000;      // safety stop

  // Mixed filter conditions (edit to your taste)
  const MAS_MIN   = 100;       // keep players with Mas > MAS_MIN
  const PRICE_EQ  = null;      // set to a number to require exact price, e.g. 1; otherwise null
  const PRICE_MAX = 1;         // keep players with Price <= PRICE_MAX (ignored if PRICE_EQ is set)
  // Optional extra filters (set to null to ignore)
  const AGE_MAX   = null;      // e.g. 23
  const TAL_MIN   = null;      // e.g. 3
  const POS_IN    = null;      // e.g. ['GK','DF','MF','FW'] or null

  // ===== Helpers =====
  const log = (...a) => console.log('[MixedFilter]', ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const base = location.origin;

  const numify = (s) => {
    if (!s) return NaN;
    const clean = String(s).replace(/\s+/g,'').replace(/[^\d\-.,]/g,'').replace(/,(?=\d{3}\b)/g,'');
    const onlyDigits = clean.replace(/[^\d\-]/g,'');
    return onlyDigits === '' ? NaN : Number(onlyDigits);
  };

  const parseTable = (doc) => {
    const tables = [...doc.querySelectorAll('table')];
    for (const table of tables) {
      const headRow = table.tHead?.rows?.[0] || table.querySelector('thead tr') || table.querySelector('tr');
      if (!headRow) continue;
      const headers = [...headRow.cells].map(td => (td.textContent||'').trim());
      const idx = {
        player: headers.findIndex(h => /player/i.test(h)),
        mas:    headers.findIndex(h => /^mas$/i.test(h)),
        price:  headers.findIndex(h => /price/i.test(h)),
        age:    headers.findIndex(h => /^age$/i.test(h)),
        tal:    headers.findIndex(h => /^tal(ent)?$/i.test(h)),
        pos:    headers.findIndex(h => /^pos(ition)?$/i.test(h)),
      };
      if (idx.player === -1 || idx.price === -1) continue;

      const rows = table.tBodies.length ? [...table.tBodies[0].rows] : [...table.querySelectorAll('tbody tr')];
      const items = rows.map(tr => {
        const cell = i => tr.cells[i]?.textContent?.trim() ?? '';
        const link = tr.cells[idx.player]?.querySelector('a')?.href || '';
        return {
          name:  cell(idx.player),
          mas:   idx.mas >= 0 ? numify(cell(idx.mas))  : NaN,
          price: numify(cell(idx.price)),
          age:   idx.age >= 0 ? numify(cell(idx.age))  : NaN,
          tal:   idx.tal >= 0 ? numify(cell(idx.tal))  : NaN,
          pos:   idx.pos >= 0 ? cell(idx.pos) : '',
          link,
        };
      });
      return { items, perPage: rows.length };
    }
    return { items: [], perPage: 0 };
  };

  const passFilters = (p) => {
    if (Number.isFinite(MAS_MIN) && !(p.mas > MAS_MIN)) return false;
    if (PRICE_EQ != null) {
      if (!(p.price === PRICE_EQ)) return false;
    } else if (Number.isFinite(PRICE_MAX)) {
      if (!(p.price <= PRICE_MAX)) return false;
    }
    if (AGE_MAX != null && Number.isFinite(p.age) && !(p.age <= AGE_MAX)) return false;
    if (TAL_MIN != null && Number.isFinite(p.tal) && !(p.tal >= TAL_MIN)) return false;
    if (POS_IN && Array.isArray(POS_IN) && POS_IN.length) {
      if (!POS_IN.includes((p.pos||'').toUpperCase())) return false;
    }
    return true;
  };

  // ===== UI panel =====
  const showPanel = (results, done, scanned) => {
    let panel = document.getElementById('mixedFilterPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'mixedFilterPanel';
      panel.style.cssText = `
        position:fixed; right:16px; bottom:16px; width:480px; max-height:65vh; overflow:auto;
        background:#111; color:#fff; font:14px/1.45 system-ui,Segoe UI,Arial; border-radius:12px;
        box-shadow:0 12px 30px rgba(0,0,0,.35); z-index:999999; padding:14px; border:1px solid #333;
      `;
      document.body.appendChild(panel);
    }
    const toCSV = (list) => {
      const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
      const rows = [['#','Name','Mas','Price','Age','Tal','Pos','Link'],
        ...list.map((r,i)=>[i+1,r.name,r.mas,r.price,r.age,r.tal,r.pos,r.link])];
      return rows.map(r=>r.map(esc).join(',')).join('\n');
    };
    const csv = toCSV(results);
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <strong>Mixed Filter Results</strong>
        <span style="opacity:.8">— ${results.length} matched; scanned ~${scanned} rows${done?' (done)':''}</span>
        <a href="${url}" download="players_mixed_filter.csv"
           style="margin-left:auto;background:#2ea043;color:#fff;text-decoration:none;padding:6px 10px;border-radius:8px">Download CSV</a>
      </div>
      <div style="opacity:.8; font-size:12px; margin-bottom:8px">
        Using server sort=<code>${SORT}</code> | Filters: Mas&gt;${MAS_MIN}${PRICE_EQ!=null?` & Price=${PRICE_EQ}`:` & Price≤${PRICE_MAX}`}
        ${AGE_MAX!=null?` & Age≤${AGE_MAX}`:''}${TAL_MIN!=null?` & Tal≥${TAL_MIN}`:''}${POS_IN?` & Pos∈[${POS_IN.join(',')}]`:''}
      </div>
      <div style="border-top:1px solid #333; padding-top:6px">
        ${results.slice(0,300).map((r,i)=>`
          <div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px dashed #2a2a2a">
            <div style="width:28px;opacity:.7">${i+1}.</div>
            <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              <a href="${r.link||'#'}" target="_blank" style="color:#9cdcfe;text-decoration:none">${r.name||'(no name)'}</a>
            </div>
            <div title="Pos"   style="width:44px;text-align:center;opacity:.9">${r.pos||'—'}</div>
            <div title="Tal"   style="width:44px;text-align:right;opacity:.85">${Number.isFinite(r.tal)?r.tal:'—'}</div>
            <div title="Age"   style="width:44px;text-align:right;opacity:.85">${Number.isFinite(r.age)?r.age:'—'}</div>
            <div title="Mas"   style="width:64px;text-align:right;opacity:1">${Number.isFinite(r.mas)?r.mas:'—'}</div>
            <div title="Price" style="width:80px;text-align:right;opacity:1">${Number.isFinite(r.price)?r.price:'—'}</div>
          </div>
        `).join('')}
      </div>
    `;
  };

  // ===== Crawl & filter =====
  (async () => {
    // build base URL with desired sort
    const u0 = new URL(location.href);
    u0.searchParams.set('sort', SORT);
    u0.searchParams.set('start', String(START_FROM));

    const results = [];
    let scanned = 0;
    let start = START_FROM;
    let perPageGuess = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const u = new URL(u0);
      u.searchParams.set('start', String(start));

      const res = await fetch(u.toString(), { credentials: 'include' });
      if (!res.ok) { log('HTTP', res.status, 'stopping'); break; }

      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const { items, perPage } = parseTable(doc);
      if (!perPage && !items.length) { log('no table/rows, stopping'); break; }

      if (!perPageGuess) perPageGuess = perPage || 20;
      scanned += perPage || 0;

      for (const it of items) if (passFilters(it)) results.push(it);

      showPanel(results, false, scanned);

      // pagination advance
      start += perPageGuess;
      if (!perPage || perPage < perPageGuess) { log('last page size', perPage, 'stopping'); break; }

      await sleep(PAGE_DELAY_MS);
    }

    showPanel(results, true, scanned);
    log('Done. Matched', results.length, 'players.');
  })();
})();
