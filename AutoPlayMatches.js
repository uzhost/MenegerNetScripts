// ==UserScript==
// @name         MeneGer Auto-Cup Apply
// @namespace    http://tampermonkey.net/
// @version      2025-09-03
// @description  Automatically applies to cups when the "Take part" button is available (and polls cup pages periodically).
// @author       You
// @match        https://meneger.net/*
// @match        https://www.meneger.net/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ---- CONFIG ----
  // Add/adjust any cup endpoints you care about:
  const CUP_PATHS = [
    // League-A
"/herbert-chapman-trophy",
"/mayor-london-cup",
"/vodacom-challenge",
"/bangladesh-gold-cup",
"/marbella-cup",

// League-B
"/la-manga-cup",
"/trofeo-joan-gamper",
"/singapore-grand-prix",
"/santiago-bernabeu-trophy",
"/the-atlantic-cup",
"/florida-international-tournament",
"/teresa-herrera-trophy",
"/azerbaijan-grand-prix",
"/copa-del-sol",
"/antalya-cup",
    
    // League-C
"/mayor-new-york-cup",
"/wimbledon-championship",
"/pele-memorial-cup",
"/diego-maradona-memorial-tournament",
"/queen-elizabeth-cup",
"/monaco-grand-prix",
"/paris-open-championship",
    
    // League-D
"/saudi-king-tournament",
"/supercopa-euroamericana",
"/sheikh-sharjah-cup",
"/australian-open-cup",
"/dubai-super-cup",
"/amir-ajman-tournament",
"/trademaster-championship",
"/sultan-oman-cup",
"/international-champions-cup",
"/bahrain-king-tournament"
  ];
  const BASE = location.origin.replace(/\/$/, "");
  const MIN_INTERVAL_MS = 30_000;  // 30s
  const MAX_INTERVAL_MS = 45_000;  // 45s
  const ENABLE_ON_PAGE_AUTO_CLICK = true; // auto-submit when you manually open a cup

  // ---- UTILS ----
  const sleep  = (ms) => new Promise(r => setTimeout(r, ms));
  const jitter = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  const toast = (msg, ok = true) => {
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText = `
      position:fixed; right:16px; bottom:16px; z-index:999999;
      background:${ok ? "#2ea043" : "#a4282a"}; color:#fff; padding:10px 14px;
      border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,.25); font:14px system-ui;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  };

  const toDoc = (html) => new DOMParser().parseFromString(html, "text/html");

  // Extract first form that has a submit input/button with text/value like "Take part"
  const findTakePartForm = (doc, path) => {
    const forms = [...doc.querySelectorAll(`form[action$="${path}"]`), ...doc.querySelectorAll("form")];
    for (const f of forms) {
      const submit = [...f.querySelectorAll('input[type="submit"],button[type="submit"],input[type="button"],button')]
        .find(b => /take\s*part/i.test((b.value || b.textContent || "").trim()));
      if (submit) return f;
    }
    return null;
  };

  // Submit the form with all fields (including hidden ones/CSRF)
  const postForm = async (form, path) => {
    const action = form.getAttribute("action") || path;
    const url = action.startsWith("http") ? action : `${BASE}${action}`;
    const fd = new FormData(form);
    // keep clicked submit name/value if present
    const submitInput = form.querySelector('input[type="submit"][name],button[type="submit"][name]');
    if (submitInput && submitInput.name && submitInput.value != null) {
      fd.append(submitInput.name, submitInput.value);
    }
    return fetch(url, { method: "POST", credentials: "include", body: fd });
  };

  // Check a single cup page and apply if possible
  const checkCup = async (path) => {
    try {
      const res = await fetch(`${BASE}${path}`, { credentials: "include" });
      if (!res.ok) return { applied: false, reason: `HTTP ${res.status}` };
      const html = await res.text();
      const doc = toDoc(html);
      const form = findTakePartForm(doc, path);
      if (!form) return { applied: false, reason: "no button" };
      const postRes = await postForm(form, path);
      return { applied: postRes.ok, reason: postRes.ok ? "applied" : `HTTP ${postRes.status}` };
    } catch (e) {
      return { applied: false, reason: e.message || "error" };
    }
  };

  // Periodic runner (keeps working while you browse any meneger.net page)
  const loop = async () => {
    while (true) {
      for (const path of CUP_PATHS) {
        const r = await checkCup(path);
        if (r.applied) {
          toast(`Applied to ${path.replace(/\//g, "")}! ✅`, true);
        } else if (r.reason !== "no button") {
          console.log(`[AutoCup] ${path}: ${r.reason}`);
        }
        await sleep(800); // small gap between requests
      }
      await sleep(jitter(MIN_INTERVAL_MS, MAX_INTERVAL_MS));
    }
  };

  // Auto click when already on a cup page you opened yourself
  const autoClickOnPage = () => {
    if (!ENABLE_ON_PAGE_AUTO_CLICK) return;
    const form = [...document.querySelectorAll("form")].find(f => {
      const submit = [...f.querySelectorAll('input[type="submit"],button[type="submit"],input[type="button"],button')]
        .find(b => /take\s*part/i.test((b.value || b.textContent || "").trim()));
      return !!submit;
    });
    if (form) {
      form.submit();
      toast("Auto-submitting Take part…");
    }
  };

  autoClickOnPage();
  loop();
})();
