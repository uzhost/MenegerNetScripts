// ==UserScript==
// @name         MeneGer Teams: Price < 1M (Multilingual + Debug)
// @namespace    http://tampermonkey.net/
// @version      2025-09-29
// @description  Find teams whose Price/Цена is < 1,000,000; robust table detection (EN/RU), crawls ?start=...
// @match        https://meneger.net/teams*
// @match        https://www.meneger.net/teams*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ==== CONFIG ====
  const PRICE_MAX = 1_000_000;
  const PAGE_DELAY_MS = 300;
  const MAX_PAGES = 2000;

  // ==== Helpers ====
  const log = (...a) => console.log('[Teams<1M]', ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const digitsOnly = (txt) => {
    if (!txt) return NaN;
    const s = String(txt).replace(/\u00A0/g, '').replace(/\D+/g, '');
    return s ? Number(s) : NaN;
  };

  // Multilingual header checks
  const hasTeam   = h => /^(team|команда)$/i.test(h) || h.includes('team') || h.includes('команда');
  const hasPrice  = h => /^(price|цена|стоимость)$/i.test(h) || h.includes('price') || h.includes('цена') || h.includes('стоим');
  const hasPower  = h => /^(power|сила)$/i.test(h) || h.includes('power') || h.includes('сила');
  const hasPlayers= h => /^(players|игроки)$/i.test(h) || h.includes('players') || h.includes('игроки');

  function findTeamsTable(doc) {
    const tables = [...doc.querySelectorAll('table')];
    for (const table of tables) {
      const headRow = table.tHead?.rows?.[0] || table.querySelector('thead tr') || table.querySelector('tr');
      if (!headRow) continue;
      const headers = [...headRow.cells].map(td => norm(td.textContent));
      const idx = {
        team:   headers.findIndex(hasTeam),
        price:  headers.findIndex(hasPrice),
        power:  headers.findIndex(hasPower),
        players:headers.findIndex(hasPlayers),
      };
      // Must have Team & Price
      if (idx.team === -1 || idx.price === -1) continue;

      const rows = table.tBodies.length ? [...table.tBodies[0].rows] : [...table.querySelectorAll('tbody tr')];
      // sanity: expect a /team/ link in the Team column for at least one row
      const looksRight = rows.slice(0, 6).some(tr => tr.cells[idx.team]?.querySelector('a[href*="/team/"]'));
      if (!looksRight) continue;

      return { table, idx };
    }
    return null;
  }

  function parsePage(doc, debug=false) {
    const hit = findTeamsTable(doc);
    if (!hit) {
      if (debug) log('No table matched: headers not found or no /team/ links.');
      return { items: [], perPage: 0 };
    }

    const { table, idx } = hit;
    const rows = table.tBodies.length ? [...table.tBodies[0].rows] : [...table.querySelectorAll('tbody tr')];

    const items = rows.map((tr, i) => {
      const teamCell = tr.cells[idx.team];
      const priceCell = tr.cells[idx.price];
      const name = teamCell?.textContent?.trim() || '';
      const link = teamCell?.querySelector('a[href*="/team/"]')?.href || '';
      const priceText = priceCell?.innerText || priceCell?.textContent || '';
      const price = digitsOnly(priceText);
      const power = idx.power !== -1 ? (tr.cells[idx.power]?.textContent?.trim() || '') : '';
      const players = idx.players !== -1 ? (tr.cells[idx.players]?.textContent?.trim() || '') : '';

      const obj = { name, link, price, priceText, power, players };
      if (debug && i < 15) console.log('[Teams<1M][Row]', obj);
      return obj;
    });

    return { items, perPage: rows.length, idx };
  }

  const pass = t => Number.isFinite(t.price) && t.price < PRICE_MAX;

  function showPanel(results, scanned, done) {
    let panel = document.getElementById('teamsUnder1MPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'teamsUnder1MPanel';
      panel.style.cssText = `
        position:fixed; right:16px; bottom:16px; width:700px; max-height:72vh; overflow:auto;
        background:#111; color:#fff; font:14px/1.4 system-ui,Segoe UI,Arial;
        border-radius:12px; box-shadow:0 12px 30px rgba(0,0,0,.35); padding:14px; z-index:999999;
      `;
      document.body.appendChild(panel);
    }
    const rows = [['#','Team','Players','Power','Price','Link'],
      ...results.map((r,i)=>[i+1, r.name, r.players, r.power, Number.isFinite(r.price)?r.price.toLocaleString():'', r.link])];
    const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
    const csv = rows.map(r => r.map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <strong>Teams with Price &lt; ${PRICE_MAX.toLocaleString()}</strong>
        <span style="opacity:.8">— ${results.length} matches (scanned ~${scanned})${done?' ✓':''}</span>
        <a href="${url}" download="teams_price_lt_1M.csv"
           style="margin-left:auto;background:#2ea043;color:#fff;text-decoration:none;padding:6px 10px;border-radius:8px">Download CSV</a>
      </div>
      ${results.slice(0,500).map((r,i)=>`
        <div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #333">
          <div style="width:28px;opacity:.6">${i+1}.</div>
          <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <a href="${r.link||'#'}" target="_blank" style="color:#9cdcfe;text-decoration:none">${r.name}</a>
          </div>
          <div style="width:80px;text-align:center">${r.players||''}</div>
          <div style="width:80px;text-align:center">${r.power||''}</div>
          <div style="width:120px;text-align:right">${Number.isFinite(r.price)?r.price.toLocaleString():''}</div>
        </div>`).join('')}
    `;
  }

  // Highlight matches on the visible page
  function highlightOnPage(doc) {
    const hit = findTeamsTable(doc);
    if (!hit) return;
    const { table, idx } = hit;
    const rows = table.tBodies.length ? [...table.tBodies[0].rows] : [...table.querySelectorAll('tbody tr')];
    for (const tr of rows) {
      const priceText = tr.cells[idx.price]?.innerText || tr.cells[idx.price]?.textContent || '';
      const price = digitsOnly(priceText);
      if (Number.isFinite(price) && price < PRICE_MAX) {
        tr.style.outline = '3px solid #2ea043';
        tr.style.background = 'rgba(46,160,67,.10)';
      }
    }
  }

  // ==== MAIN ====
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
      const doc  = new DOMParser().parseFromString(html, 'text/html');

      const { items, perPage } = parsePage(doc, page === 0); // debug first page
      if (!perPage && !items.length) break;

      scanned += perPage || 0;
      for (const it of items) if (pass(it)) results.push(it);

      if (page === 0) highlightOnPage(document);
      showPanel(results, scanned, false);

      if (!perPage || items.length < perPage) break; // last page
      start += perPage;
      await sleep(PAGE_DELAY_MS);
    }

    showPanel(results, scanned, true);
    log('Done. Matches:', results.length, 'Scanned:', scanned);
  })();

})();
