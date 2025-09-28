// ==UserScript==
// @name         MeneGer Staff: Show Only Talent = 3 (Coach/GK/Phys)
// @namespace    http://tampermonkey.net/
// @version      2025-09-29
// @description  Crawl staff lists (Coach, Goalkeeping Coach, Physiotherapist) and show only Tal=3, keeping original order.
// @match        https://meneger.net/staffs*
// @match        https://www.meneger.net/staffs*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ---- CONFIG ----
  const POS_TARGETS = ['Coach', 'gCoach', 'Phys']; // pages to scan
  const TAL_TARGET = 3;                             // show only Tal == 3
  const PAGE_DELAY_MS = 250;
  const ROLE_DELAY_MS = 400;
  const MAX_PAGES = 2000;

  // ---- helpers ----
  const log = (...a) => console.log('[StaffTal3]', ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  const parseIntLoose = (text) => {
    if (!text) return NaN;
    const m = String(text).replace(/\u00A0/g, '').match(/-?\d+/);
    return m ? Number(m[0]) : NaN;
  };

  // find the staff table (works with the page shown in your screenshot)
  function findStaffTable(doc) {
    // prefer id="example"
    const preferred = doc.querySelector('table#example');
    if (preferred) {
      const head = preferred.tHead?.rows?.[0] || preferred.querySelector('thead tr') || preferred.querySelector('tr');
      if (head) {
        const headers = [...head.cells].map(td => norm(td.textContent).toLowerCase());
        const idx = {
          staff:  headers.findIndex(h => /^(staff|name)$/.test(h)),
          nat:    headers.findIndex(h => /^nat/.test(h)),
          pos:    headers.findIndex(h => /^pos/.test(h)),
          year:   headers.findIndex(h => /^(year|age)$/.test(h)),
          tal:    headers.findIndex(h => /^tal/.test(h)),
          mas:    headers.findIndex(h => /^mas/.test(h)),
          salary: headers.findIndex(h => /(salary|wage|price)/.test(h)),
        };
        if (idx.pos !== -1 && idx.tal !== -1) return { table: preferred, idx };
      }
    }
    // fallback: scan all tables
    const tables = [...doc.querySelectorAll('table')];
    for (const table of tables) {
      const head = table.tHead?.rows?.[0] || table.querySelector('thead tr') || table.querySelector('tr');
      if (!head) continue;
      const headers = [...head.cells].map(td => norm(td.textContent).toLowerCase());
      const idx = {
        staff:  headers.findIndex(h => /^(staff|name)$/.test(h)),
        nat:    headers.findIndex(h => /^nat/.test(h)),
        pos:    headers.findIndex(h => /^pos/.test(h)),
        year:   headers.findIndex(h => /^(year|age)$/.test(h)),
        tal:    headers.findIndex(h => /^tal/.test(h)),
        mas:    headers.findIndex(h => /^mas/.test(h)),
        salary: headers.findIndex(h => /(salary|wage|price)/.test(h)),
      };
      if (idx.pos !== -1 && idx.tal !== -1) {
        const rows = table.tBodies.length ? [...table.tBodies[0].rows] : [...table.querySelectorAll('tbody tr')];
        const ok = rows.slice(0, 6).some(tr => {
          const cell = idx.staff !== -1 ? tr.cells[idx.staff] : tr.cells[idx.pos];
          return !!cell?.querySelector('a[href*="/staff/"]');
        });
        if (ok) return { table, idx };
      }
    }
    return null;
  }

  function parsePage(doc, debug=false) {
    const hit = findStaffTable(doc);
    if (!hit) return { items: [], perPage: 0 };
    const { table, idx } = hit;
    const rows = table.tBodies.length ? [...table.tBodies[0].rows] : [...table.querySelectorAll('tbody tr')];

    const items = rows.map((tr, i) => {
      const txt = j => tr.cells[j]?.textContent?.trim() ?? '';
      const nameCell = idx.staff !== -1 ? tr.cells[idx.staff] : tr.cells[idx.pos];
      const name = nameCell?.textContent?.trim() || '(unknown)';
      const link = nameCell?.querySelector('a')?.href || '';
      const pos  = txt(idx.pos);
      const tal  = parseIntLoose(txt(idx.tal));
      const rec = {
        name,
        link,
        nat:  idx.nat  !== -1 ? (tr.cells[idx.nat]?.querySelector('img[alt],img[title]')?.getAttribute('alt') || tr.cells[idx.nat]?.textContent?.trim() || '') : '',
        pos,
        year: idx.year !== -1 ? parseIntLoose(txt(idx.year)) : NaN,
        tal,
        mas:  idx.mas  !== -1 ? parseIntLoose(txt(idx.mas))  : NaN,
        salary: idx.salary !== -1 ? (tr.cells[idx.salary]?.textContent?.trim() || '') : ''
      };
      if (debug && i < 12) console.log('[StaffTal3][Row]', rec);
      return rec;
    });

    return { items, perPage: rows.length };
  }

  // highlight Tal=3 rows on the visible page
  function highlightTal3OnPage() {
    const hit = findStaffTable(document);
    if (!hit) return;
    const { table, idx } = hit;
    const rows = table.tBodies.length ? [...table.tBodies[0].rows] : [...table.querySelectorAll('tbody tr')];
    for (const tr of rows) {
      const tal = parseIntLoose(tr.cells[idx.tal]?.textContent?.trim());
      if (tal === TAL_TARGET) {
        tr.style.outline = '3px solid #2ea043';
        tr.style.background = 'rgba(46,160,67,.10)';
      }
    }
  }

  // minimal panel
  function renderPanel(list, scanned, done) {
    let panel = document.getElementById('staffTal3Panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'staffTal3Panel';
      panel.style.cssText = `
        position:fixed; right:16px; bottom:16px; width:720px; max-height:72vh; overflow:auto;
        background:#111; color:#fff; font:14px/1.4 system-ui,Segoe UI,Arial;
        border-radius:12px; box-shadow:0 12px 30px rgba(0,0,0,.35); padding:14px; z-index:999999;
      `;
      document.body.appendChild(panel);
    }

    const rows = [['#','Name','Role','Nat','Age','Tal','Mas','Salary','Link'],
      ...list.map((r,i)=>[i+1,r.name,r.pos,r.nat,Number.isFinite(r.year)?r.year:'',r.tal,r.mas,r.salary,r.link])];
    const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
    const csv = rows.map(r => r.map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));

    panel.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
        <strong>Talent = ${TAL_TARGET}</strong>
        <span style="opacity:.8">— ${list.length} matches (scanned ~${scanned})${done?' ✓':''}</span>
        <a href="${url}" download="staff_talent_${TAL_TARGET}.csv"
           style="margin-left:auto;background:#2ea043;color:#fff;text-decoration:none;padding:6px 10px;border-radius:8px">Download CSV</a>
      </div>
      <div>
        ${list.slice(0,800).map((r,i)=>`
          <div style="display:grid;grid-template-columns: 28px 1fr 160px 80px 50px 40px 120px;gap:8px;align-items:center;border-bottom:1px solid #333;padding:6px 0">
            <div style="opacity:.6">${i+1}.</div>
            <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              <a href="${r.link||'#'}" target="_blank" style="color:#9cdcfe;text-decoration:none">${r.name}</a>
            </div>
            <div>${r.pos}</div>
            <div>${r.nat||''}</div>
            <div style="text-align:right">${Number.isFinite(r.year)?r.year:''}</div>
            <div style="text-align:right"><b>${Number.isFinite(r.tal)?r.tal:''}</b></div>
            <div style="text-align:right">${r.salary||''}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ---- MAIN ----
  (async () => {
    const base = new URL(location.origin + '/staffs');
    // carry other filters (e.g., country) from the current URL
    new URL(location.href).searchParams.forEach((v,k) => {
      if (!['pos','start'].includes(k)) base.searchParams.set(k, v);
    });

    const results = [];   // keep original crawl order
    let scanned = 0;

    // highlight Tal=3 on the page you're viewing
    highlightTal3OnPage();

    for (const pos of POS_TARGETS) {
      let start = 0;
      let page = 0;
      await sleep(ROLE_DELAY_MS);

      while (page < MAX_PAGES) {
        const url = new URL(base.toString());
        url.searchParams.set('pos', pos);
        url.searchParams.set('start', String(start));

        const res = await fetch(url.toString(), { credentials: 'include' });
        if (!res.ok) { log('HTTP', res.status, 'stop @', url.toString()); break; }

        const html = await res.text();
        const doc  = new DOMParser().parseFromString(html, 'text/html');

        const { items, perPage } = parsePage(doc, page === 0);
        if (!perPage && !items.length) break;

        scanned += perPage || 0;

        // preserve page order; only push Tal=3
        for (const it of items) if (it.tal === TAL_TARGET) results.push(it);

        renderPanel(results, scanned, false);

        if (!perPage || items.length < perPage) break;
        start += perPage;
        page++;
        await sleep(PAGE_DELAY_MS);
      }
    }

    renderPanel(results, scanned, true);
    log('Done. Tal=3 staff:', results.length, 'Scanned:', scanned);
  })();
})();
