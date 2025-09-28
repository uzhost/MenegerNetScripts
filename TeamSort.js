// ==UserScript==
// @name         MeneGer Teams: Price < 1M (Hardened v2)
// @namespace    http://tampermonkey.net/
// @version      2025-09-29
// @description  Find teams with Price/Cost < 1,000,000 on teams list; robust table & row detection + debug
// @match        https://meneger.net/teams*
// @match        https://www.meneger.net/teams*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const PRICE_MAX = 1_000_000;
  const PAGE_DELAY_MS = 300;
  const MAX_PAGES = 2000;

  const log = (...a) => console.log('[Teams<1M]', ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

  const digitsOnly = (txt) => {
    if (!txt) return NaN;
    const s = String(txt).replace(/[^\d]/g, '');
    return s ? Number(s) : NaN;
  };

  // Heuristics to decide "this is the teams list table"
  function isTeamsTable(table) {
    // must have many rows & columns
    const body = table.tBodies[0] || table.querySelector('tbody');
    if (!body) return false;
    const rows = [...body.rows];
    if (rows.length < 10) return false;

    // prefer tables that have a THEAD with Team/Price
    const head = table.tHead?.rows?.[0] || table.querySelector('thead tr');
    if (head) {
      const headers = [...head.cells].map(td => norm(td.textContent).toLowerCase());
      const teamIdx  = headers.findIndex(h => /(team|команда|club)/.test(h));
      const priceIdx = headers.findIndex(h => /(price|цена|стоим|cost)/.test(h));
      if (teamIdx !== -1 && priceIdx !== -1) {
        // sanity: first rows must have a /team/ link in that column
        const ok = rows.slice(0, 8).some(tr => tr.cells[teamIdx]?.querySelector('a[href*="/team/"], a[href*="/teams"]'));
        if (ok) return { teamIdx, priceIdx };
      }
    }

    // fallback: structural guess
    const cols = rows[0].cells.length;
    if (cols < 5) return false;

    // guess team column = first column that has many /team/ links
    let teamIdx = -1;
    for (let c = 0; c < Math.min(cols, 6); c++) {
      const hits = rows.slice(0, 10).filter(tr => tr.cells[c]?.querySelector('a[href*="/team/"], a[href*="/teams"]')).length;
      if (hits >= 4) { teamIdx = c; break; }
    }
    if (teamIdx === -1) return false;

    // guess price column = among rightmost 3 columns, pick the one with most large numbers
    let priceIdx = -1, best = -1;
    for (let c = cols - 1; c >= Math.max(0, cols - 3); c--) {
      const nums = rows.slice(0, 10).map(tr => digitsOnly(tr.cells[c]?.innerText || tr.cells[c]?.textContent || ''));
      const hits = nums.filter(v => Number.isFinite(v) && v >= 50_000).length;
      if (hits > best) { best = hits; priceIdx = c; }
    }
    if (priceIdx === -1) return false;

    return { teamIdx, priceIdx };
  }

  function findTeamsTable(doc) {
    const candidates = [...doc.querySelectorAll('table')];
    for (const t of candidates) {
      const hit = isTeamsTable(t);
      if (hit) return { table: t, idx: hit };
    }
    return null;
  }

  function parsePage(doc, debug=false) {
    const hit = findTeamsTable(doc);
    if (!hit) {
      if (debug) log('No teams table found.');
      return { items: [], perPage: 0 };
    }
    const { table, idx } = hit;
    const rows = [...(table.tBodies[0] || table.querySelector('tbody')).rows];

    const items = rows
      .filter(tr => tr.cells.length >= Math.max(idx.teamIdx, idx.priceIdx) + 1)
      .map((tr, i) => {
        const teamCell = tr.cells[idx.teamIdx];
        const priceCell = tr.cells[idx.priceIdx];

        // name = anchor text ONLY
        const a = teamCell?.querySelector('a[href*="/team/"], a[href*="/teams"]');
        const name = norm(a?.textContent || teamCell?.textContent || '');
        const link = a?.href || '';

        const priceText = priceCell?.innerText || priceCell?.textContent || '';
        const price = digitsOnly(priceText);

        // try to read optional players/power columns by looking for nearby numeric cells
        const nums = [...tr.cells].map(td => digitsOnly(td.innerText || td.textContent || ''));
        // choose two mid columns that look like "players" & "power"
        const numericSorted = nums
          .map((v, c) => ({ v, c }))
          .filter(x => Number.isFinite(x.v))
          .sort((a, b) => a.c - b.c);

        let players = '';
        let power = '';
        if (numericSorted.length >= 2) {
          // heuristics: players is usually around 11–30, power 200–1200
          const maybePlayers = numericSorted.find(x => x.v >= 10 && x.v <= 30);
          const maybePower   = numericSorted.find(x => x.v >= 200 && x.v <= 2000);
          players = maybePlayers ? String(maybePlayers.v) : '';
          power   = maybePower   ? String(maybePower.v)   : '';
        }

        if (debug && i < 15) {
          console.log('[Teams<1M][Row]', { name, link, priceText, price, players, power });
        }
        return { name, link, price, priceText, players, power };
      });

    return { items, perPage: rows.length };
  }

  const pass = t => Number.isFinite(t.price) && t.price < PRICE_MAX;

  function showPanel(results, scanned, done) {
    let panel = document.getElementById('teamsUnder1MPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'teamsUnder1MPanel';
      panel.style.cssText = `
        position:fixed; right:16px; bottom:16px; width:740px; max-height:72vh; overflow:auto;
        background:#111; color:#fff; font:14px/1.4 system-ui,Segoe UI,Arial;
        border-radius:12px; box-shadow:0 12px 30px rgba(0,0,0,.35); padding:14px; z-index:999999;
      `;
      document.body.appendChild(panel);
    }
    const rows = [['#','Team','Players','Power','Price','Link'],
      ...results.map((r,i)=>[i+1, r.name, r.players, r.power, Number.isFinite(r.price)?r.price.toLocaleString():r.priceText, r.link])];
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
          <div style="width:120px;text-align:right">${Number.isFinite(r.price)?r.price.toLocaleString():r.priceText}</div>
        </div>`).join('')}
    `;
  }

  function highlightOnPage(doc) {
    const hit = findTeamsTable(doc);
    if (!hit) return;
    const { table, idx } = hit;
    const rows = [...(table.tBodies[0] || table.querySelector('tbody')).rows];
    for (const tr of rows) {
      const priceCell = tr.cells[idx.priceIdx];
      const price = digitsOnly(priceCell?.innerText || priceCell?.textContent || '');
      if (Number.isFinite(price) && price < PRICE_MAX) {
        tr.style.outline = '3px solid #2ea043';
        tr.style.background = 'rgba(46,160,67,.10)';
      }
    }
  }

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

      const { items, perPage } = parsePage(doc, page === 0); // debug on first page
      if (!perPage && !items.length) break;

      scanned += perPage || 0;
      for (const it of items) if (pass(it)) results.push(it);

      if (page === 0) highlightOnPage(document);
      showPanel(results, scanned, false);

      if (!perPage || items.length < perPage) break;
      start += perPage;
      await sleep(PAGE_DELAY_MS);
    }

    showPanel(results, scanned, true);
    log('Done. Matches:', results.length, 'Scanned:', scanned);
  })();
})();
