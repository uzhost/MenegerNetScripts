// ==UserScript==
// @name         MeneGer Players: Mixed Filters (Mas & Price) [Fixed]
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
  const PRICE_EQ  = 0;         // require exact price, or set to null to ignore exact match
  const PRICE_MAX = null;      // alternative: set a max price instead of PRICE_EQ
  const AGE_MAX   = null;      // e.g. 23 to filter young players
  const TAL_MIN   = null;      // e.g. 3
  const POS_IN    = null;      // e.g. ['GK','DF','MF','FW'] or null

  // ===== Helpers =====
  const log = (...a) => console.log('[MixedFilter]', ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const base = location.origin;

 function parseNumber(text) {
  if (!text) return NaN;
  // remove NBSP and trim
  let s = text.replace(/\u00A0/g, ' ').trim();
  // remove any currency symbols or letters
  s = s.replace(/[^\d.,-]/g, '');
  // if it contains comma as thousands separator, drop commas
  if (/,/.test(s) && /\d{1,3}(,\d{3})+/.test(s)) {
    s = s.replace(/,/g, '');
  }
  // normalize decimal comma to dot
  s = s.replace(',', '.');
  const num = parseFloat(s);
  return Number.isNaN(num) ? NaN : num;
}

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
          mas:   idx.mas >= 0 ? parseNumber(cell(idx.mas))  : NaN,
          price: parseNumber(cell(idx.price)),
          age:   idx.age >= 0 ? parseNumber(cell(idx.age))  : NaN,
          tal:   idx.tal >= 0 ? parseNumber(cell(idx.tal))  : NaN,
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
      if (!Number.isFinite(p.price) || p.price !== PRICE_EQ) return false;
    } else if (Number.isFinite(PRICE_MAX)) {
      if (!Number.isFinite(p.price) || !(p.price <= PRICE_MAX)) return false;
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
        position:fixed; right:16px; bottom:16px; width:500px; max-height:70vh; overflow:auto;
        background:#111; color:#fff; font:14px/1.45 system-ui,Segoe UI,Arial;
        border-radius:12px; box-shadow:0 12px 30px rgba(0,0,0,.35); padding:14px; z-index:999999;
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
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <strong>Filtered Results</strong>
        <span style="opacity:.8">— ${results.length} matches (scanned ~${scanned})${done?' ✓':''}</span>
        <a href="${url}" download="players_filtered.csv"
           style="margin-left:auto;background:#2ea043;color:#fff;text-decoration:none;padding:6px 10px;border-radius:6px">Download CSV</a>
      </div>
      ${results.slice(0,300).map((r,i)=>`
        <div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid #333">
          <div style="width:28px;opacity:.7">${i+1}.</div>
          <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <a href="${r.link||'#'}" target="_blank" style="color:#9cdcfe;text-decoration:none">${r.name||'(no name)'}</a>
          </div>
          <div style="width:40px;text-align:center">${r.pos||''}</div>
          <div style="width:40px;text-align:right">${Number.isFinite(r.tal)?r.tal:''}</div>
          <div style="width:50px;text-align:right">${Number.isFinite(r.age)?r.age:''}</div>
          <div style="width:60px;text-align:right">${Number.isFinite(r.mas)?r.mas:''}</div>
          <div style="width:60px;text-align:right">${Number.isFinite(r.price)?r.price:''}</div>
        </div>`).join('')}
    `;
  };

  console.log("Row check:", it.name, "Mas=", it.mas, "Price raw=", tr.cells[idx.price]?.innerHTML, "parsed=", it.price);

  // ===== Crawl & filter =====
  (async () => {
    const results = [];
    let scanned = 0;
    let start = START_FROM;
    let perPageGuess = null;
    const u0 = new URL(location.origin + "/players");
    u0.searchParams.set("sort", SORT);

    for (let page = 0; page < MAX_PAGES; page++) {
      u0.searchParams.set("start", String(start));
      const res = await fetch(u0.toString(), { credentials: "include" });
      if (!res.ok) { log("HTTP", res.status, "stop"); break; }
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html,"text/html");
      const { items, perPage } = parseTable(doc);
      if (!perPage && !items.length) { break; }
      if (!perPageGuess) perPageGuess = perPage || 20;
      scanned += perPage || 0;
      for (const it of items) if (passFilters(it)) results.push(it);
      showPanel(results, false, scanned);
      if (!perPage || perPage < perPageGuess) break;
      start += perPageGuess;
      await sleep(PAGE_DELAY_MS);
    }
    showPanel(results,true,scanned);
  })();
})();
