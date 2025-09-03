// ==UserScript==
// @name         MeneGer Players: GK Mas>100 & Price<1M (Robust Table Detect)
// @namespace    http://tampermonkey.net/
// @version      2025-09-04
// @description  Filter players where Mas>100 and Price<1,000,000 on meneger.net. Robust players-table detection.
// @match        https://meneger.net/players*
// @match        https://www.meneger.net/players*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ---- Filters ----
  const MAS_MIN   = 80;
  const PRICE_MAX = 1_000;

  // ---- Crawl settings ----
  const PAGE_DELAY_MS = 350;
  const MAX_PAGES     = 1000;

  const log = (...a) => console.log('[GK Filter]', ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Parse integers with commas, NBSP, symbols
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

  function findPlayersTable(doc) {
    const tables = [...doc.querySelectorAll('table')];
    for (const table of tables) {
      const head = table.tHead?.rows?.[0] || table.querySelector('thead tr') || table.querySelector('tr');
      if (!head) continue;
      const headers = [...head.cells].map(td => (td.textContent || '').replace(/\u00A0/g, ' ').trim().toLowerCase());
      const idx = {
        player: headers.findIndex(h => /player/.test(h)),
        price:  headers.findIndex(h => /price/.test(h)),
        mas:    headers.findIndex(h => /\bmas\b/i.test(h)),
        pos:    headers.findIndex(h => /^pos/.test(h)),
      };
      // Must have Player & Price; Mas is strongly expected; Pos helpful
      if (idx.player === -1 || idx.price === -1) continue;

      // Sanity check: rows should contain /player/ links in the Player column
      const rows = table.tBodies.length ? [...table.tBodies[0].rows] : [...table.querySelectorAll('tbody tr')];
      const sample = rows.slice(0, 5);
      const looksRight = sample.some(tr => {
        const a = tr.cells[idx.player]?.querySelector('a[href*="/player/"]');
        return !!a;
      });
      if (!looksRight) continue;

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

      // robust parsing
      const price = parseIntStrict(tr.cells[idx.price]?.innerText || tr.cells[idx.price]?.textContent || '');
      const mas   = idx.mas >= 0 ? parseIntLoose(txt(idx.mas)) : NaN;

      const item = {
        name:  txt(idx.player),
        pos:   idx.pos >= 0 ? txt(idx.pos) : '',
        mas,
        price,
        link:  tr.cells[idx.player]?.querySelector('a')?.href || ''
      };

      if (debug && i < 25) {
        console.log('[GK Filter][Row]', item.name, {
          MAS_cell: idx.mas >= 0 ? txt(idx.mas) : '(n/a)',
          MAS: item.mas,
          Price_cell: tr.cells[idx.price]?.innerText || '',
          Price: item.price
        });
      }
      return item;
    });
    return { items, perPage: rows.length };
  }

  function pass(p) {
    return (p.mas > MAS_MIN) && (Number.isFinite(p.price) && p.price < PRICE_MAX);
  }

  function showPanel(results, done, scanned) {
    let panel = document.getElementById('gkFilterPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'gkFilterPanel';
      panel.style.cssText = `
        position:fixed; right:16px; bottom:16px; width:540px; max-height:70vh; overflow:auto;
        background:#111; color:#fff; font:14px/1.4 system-ui,Segoe UI,Arial;
        border-radius:12px; box-shadow:0 12px 30px rgba(0,0,0,.35); padding:14px; z-index:999999;
      `;
      document.body.appendChild(panel);
    }
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [['#','Name','Pos','Mas','Price','Link'],
      ...results.map((r,i)=>[i+1,r.name,r.pos,r.mas,r.price,r.link])]
      .map(r=>r.map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <strong>Mas > ${MAS_MIN} & Price < ${PRICE_MAX.toLocaleString()}</strong>
        <span style="opacity:.8">— ${results.length} matches (scanned ~${scanned})${done?' ✓':''}</span>
        <a href="${url}" download="players_filtered.csv"
           style="margin-left:auto;background:#2ea043;color:#fff;text-decoration:none;padding:6px 10px;border-radius:6px">Download CSV</a>
      </div>
      ${results.slice(0,300).map((r,i)=>`
        <div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid #333">
          <div style="width:28px;opacity:.6">${i+1}.</div>
          <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <a href="${r.link||'#'}" target="_blank" style="color:#9cdcfe;text-decoration:none">${r.name||'(no name)'}</a>
          </div>
          <div style="width:44px;text-align:center">${r.pos||''}</div>
          <div style="width:64px;text-align:right">${Number.isFinite(r.mas)?r.mas:''}</div>
          <div style="width:90px;text-align:right">${Number.isFinite(r.price)?r.price.toLocaleString():''}</div>
        </div>`).join('')}
    `;
  }

  // ===== Crawl from current URL (keeps pos=Gk&sort=mas)
  (async () => {
    const results = [];
    let scanned = 0;

    const url = new URL(location.href);
    let start = parseInt(url.searchParams.get('start') || '0', 10);

    for (let page = 0; page < MAX_PAGES; page++) {
      url.searchParams.set('start', String(start));
      const res = await fetch(url.toString(), { credentials: 'include' });
      if (!res.ok) { log('HTTP', res.status, 'stop'); break; }

      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      // debug only on page 0 to verify correct table & indices
      const { items, perPage } = parsePage(doc, page === 0);
      if (!perPage && !items.length) break;

      scanned += perPage || 0;
      for (const it of items) if (pass(it)) results.push(it);

      showPanel(results, false, scanned);

      if (!perPage || items.length < perPage) break; // last page
      start += perPage;
      await sleep(PAGE_DELAY_MS);
    }

    showPanel(results, true, scanned);
    log('Done. Matches:', results.length);
  })();

})();
