(function () {
  'use strict';

  const yearSel       = document.getElementById('yearSelect');
  const loadBtn       = document.getElementById('loadBtn');
  const syncBtn       = document.getElementById('syncBtn');
  const tableWrap     = document.getElementById('tableWrap');
  const tbody         = document.getElementById('clientsBody');
  const loadingEl     = document.getElementById('loading');
  const errorEl       = document.getElementById('error');
  const setupHint     = document.getElementById('setupHint');
  const summaryEl     = document.getElementById('summary');
  const emptyEl       = document.getElementById('emptyClients');
  const searchInput   = document.getElementById('clientSearch');
  const empFilterWrap = document.getElementById('empFilterWrap');

  // ── Filter state ──────────────────────────────────────────────────────
  let searchText     = '';
  let selectedEmpIds = new Set();

  function applyFilters(rows) {
    const text = searchText.toLowerCase().trim();
    return rows.filter(function (row) {
      const c = row.client;
      if (text && !c.name.toLowerCase().startsWith(text)) return false;
      if (selectedEmpIds.size > 0) {
        const match = (c.am_employee_id  && selectedEmpIds.has(c.am_employee_id)) ||
                      (c.adv_employee_id && selectedEmpIds.has(c.adv_employee_id));
        if (!match) return false;
      }
      return true;
    });
  }

  function buildEmpFilter(rows) {
    const empMap = {};
    rows.forEach(function (row) {
      const c = row.client;
      if (c.am_emp)  empMap[c.am_emp.id]  = c.am_emp;
      if (c.adv_emp) empMap[c.adv_emp.id] = c.adv_emp;
    });
    const emps = Object.values(empMap).sort(function (a, b) { return a.name.localeCompare(b.name); });

    if (!emps.length) { empFilterWrap.innerHTML = ''; return; }

    const btnStyle = [
      'display:inline-flex;align-items:center;gap:6px;padding:0 10px;height:32px;',
      'border:1px solid var(--border);border-radius:6px;background:#fff;',
      'color:var(--text);font-size:13px;cursor:pointer;white-space:nowrap;',
      'transition:border-color .15s',
    ].join('');

    const panelStyle = [
      'position:absolute;top:calc(100% + 4px);left:0;z-index:200;min-width:180px;',
      'background:#fff;border:1px solid var(--border);border-radius:8px;',
      'box-shadow:0 4px 16px rgba(0,0,0,.12);padding:6px 0;',
    ].join('');

    empFilterWrap.innerHTML =
      '<button id="empFBtn" style="' + btnStyle + '">' +
        '<span id="empFLabel">Alle Mitarbeiter</span>' +
        '<svg width="10" height="10" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4 4-4"/></svg>' +
      '</button>' +
      '<div id="empFPanel" style="' + panelStyle + 'display:none">' +
        '<button id="empFClear" style="display:block;width:100%;text-align:left;padding:5px 14px;' +
          'font-size:12px;color:var(--text-muted);background:none;border:none;cursor:pointer;' +
          'border-bottom:1px solid var(--border);margin-bottom:4px">Alle abwählen</button>' +
        '<div id="empFList"></div>' +
      '</div>';

    const btn   = document.getElementById('empFBtn');
    const panel = document.getElementById('empFPanel');
    const label = document.getElementById('empFLabel');
    const clear = document.getElementById('empFClear');
    const list  = document.getElementById('empFList');

    emps.forEach(function (emp) {
      const itemStyle = 'display:flex;align-items:center;gap:8px;padding:5px 14px;cursor:pointer;font-size:13px';
      const el = document.createElement('label');
      el.style.cssText = itemStyle + ';color:var(--text)';
      el.innerHTML = '<input type="checkbox" value="' + emp.id + '" style="accent-color:var(--primary);cursor:pointer"> ' + emp.name;
      el.querySelector('input').addEventListener('change', function () {
        if (this.checked) selectedEmpIds.add(emp.id);
        else              selectedEmpIds.delete(emp.id);
        updateEmpLabel();
        renderTable(lastRows, parseInt(yearSel.value), lastMaxMonth);
        updateSortHeaders();
      });
      list.appendChild(el);
    });

    function updateEmpLabel() {
      if (selectedEmpIds.size === 0) label.textContent = 'Alle Mitarbeiter';
      else if (selectedEmpIds.size === 1) {
        const id = [...selectedEmpIds][0];
        label.textContent = empMap[id] ? empMap[id].name : '1 ausgewählt';
      } else {
        label.textContent = selectedEmpIds.size + ' ausgewählt';
      }
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    clear.addEventListener('click', function (e) {
      e.stopPropagation();
      selectedEmpIds.clear();
      list.querySelectorAll('input[type=checkbox]').forEach(function (cb) { cb.checked = false; });
      updateEmpLabel();
      panel.style.display = 'none';
      renderTable(lastRows, parseInt(yearSel.value), lastMaxMonth);
      updateSortHeaders();
    });

    document.addEventListener('click', function () { panel.style.display = 'none'; });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  // ── Working-day helpers ───────────────────────────────────────────────
  // Count Mon–Fri days in a given year/month
  function totalWorkDays(year, month) {
    const days = new Date(year, month, 0).getDate(); // days in month
    let count = 0;
    for (let d = 1; d <= days; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow >= 1 && dow <= 5) count++;
    }
    return count;
  }

  // Count Mon–Fri days from 1st up to and including `upToDay`
  function elapsedWorkDays(year, month, upToDay) {
    let count = 0;
    for (let d = 1; d <= upToDay; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow >= 1 && dow <= 5) count++;
    }
    return count;
  }

  // ── Contract start helpers ────────────────────────────────────────────
  // Sum up effective budget for a client over all active months (incl. per-month corrections)
  // For the current month the budget is pro-rated by elapsed working days / total working days
  function effectiveBudget(client, adjs, year, maxMonth) {
    const today = new Date();
    const todayY = today.getFullYear();
    const todayM = today.getMonth() + 1;
    const todayD = today.getDate();

    let amB  = (client.am_budget  != null || client.am_budget2  != null) ? 0 : null;
    let advB = (client.adv_budget != null || client.adv_budget2 != null) ? 0 : null;

    for (let m = 1; m <= maxMonth; m++) {
      // Contract start check
      if (client.contract_start) {
        const cs  = new Date(client.contract_start);
        const csY = cs.getUTCFullYear(), csM = cs.getUTCMonth() + 1;
        if (csY > year || (csY === year && m < csM)) continue;
      }

      // Determine phase for this month
      let phase = 'phase1';
      if (client.budget_switch) {
        const bs  = new Date(client.budget_switch);
        const bsY = bs.getUTCFullYear(), bsM = bs.getUTCMonth() + 1;
        if (year > bsY || (year === bsY && m >= bsM)) phase = 'phase2';
      }

      // Skip months after contract end (only for non-transition clients)
      if (phase === 'phase1' && !client.budget_switch) {
        const endDate = client.contract_end || client.project_end || null;
        if (endDate) {
          const ed  = new Date(endDate);
          const edY = ed.getUTCFullYear(), edM = ed.getUTCMonth() + 1;
          if (year > edY || (year === edY && m > edM)) continue;
        }
      }

      const adj     = adjs[m] || null;
      const adjAmH  = adj ? (adj.am_hours  || 0) : 0;
      const adjAdvH = adj ? (adj.adv_hours || 0) : 0;
      const bdgAm   = phase === 'phase2' ? client.am_budget2  : client.am_budget;
      const bdgAdv  = phase === 'phase2' ? client.adv_budget2 : client.adv_budget;

      let ratio = 1;
      if (year === todayY && m === todayM) {
        const total   = totalWorkDays(year, m);
        const elapsed = elapsedWorkDays(year, m, todayD);
        ratio = total > 0 ? elapsed / total : 1;
      }

      if (amB  != null && bdgAm  != null) amB  += (bdgAm  + adjAmH)  * ratio;
      if (advB != null && bdgAdv != null) advB += (bdgAdv + adjAdvH) * ratio;
    }
    return { amB, advB };
  }

  function effectiveMonths(client, year, maxMonth) {
    // Determine start month for this year
    let startM = 1;
    if (client.contract_start) {
      const d   = new Date(client.contract_start);
      const csY = d.getUTCFullYear();
      const csM = d.getUTCMonth() + 1;
      if (csY > year) return 0;
      if (csY === year) startM = csM;
    }
    // Determine end month for this year (transition clients run indefinitely)
    let endM = maxMonth;
    if (!client.budget_switch) {
      const endDate2 = client.contract_end || client.project_end || null;
      if (endDate2) {
        const d   = new Date(endDate2);
        const edY = d.getUTCFullYear();
        const edM = d.getUTCMonth() + 1;
        if (edY < year) return 0;
        if (edY === year) endM = Math.min(maxMonth, edM);
      }
    }
    return Math.max(0, endM - startM + 1);
  }

  // ── Sort state ────────────────────────────────────────────────────────
  let sortCol = null; // 'name' | 'am' | 'adv' | 'total' | 'diff'
  let sortDir = 'desc';
  let lastRows     = [];
  let lastMaxMonth = 12;

  function sortRows(rows, maxMonth) {
    if (!sortCol) return rows;
    return rows.slice().sort(function (a, b) {
      let va, vb;
      const ac = a.client, bc = b.client;
      const aa = a.agg,    ba = b.agg;
      if (sortCol === 'name') {
        va = ac.name.toLowerCase();
        vb = bc.name.toLowerCase();
      } else if (sortCol === 'am') {
        va = aa.amTotal; vb = ba.amTotal;
      } else if (sortCol === 'adv') {
        va = aa.advH; vb = ba.advH;
      } else if (sortCol === 'total') {
        va = aa.amTotal + aa.advH;
        vb = ba.amTotal + ba.advH;
      } else if (sortCol === 'diff') {
        const aEff = effectiveBudget(ac, a.adjs, parseInt(yearSel.value), maxMonth);
        const bEff = effectiveBudget(bc, b.adjs, parseInt(yearSel.value), maxMonth);
        const aBdg = (aEff.amB || 0) + (aEff.advB || 0);
        const bBdg = (bEff.amB || 0) + (bEff.advB || 0);
        va = (aa.amTotal + aa.advH) - aBdg;
        vb = (ba.amTotal + ba.advH) - bBdg;
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ?  1 : -1;
      return 0;
    });
  }

  function updateSortHeaders() {
    document.querySelectorAll('thead th[data-sort]').forEach(function (th) {
      const ind = th.querySelector('.sort-ind');
      if (!ind) return;
      if (th.dataset.sort === sortCol) {
        ind.textContent = sortDir === 'asc' ? ' ↑' : ' ↓';
        th.style.color = 'var(--primary)';
      } else {
        ind.textContent = ' ↕';
        th.style.color = '';
      }
    });
  }

  // Wire up header clicks (after DOM ready)
  document.querySelectorAll('thead th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      const col = th.dataset.sort;
      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = col;
        sortDir = col === 'name' ? 'asc' : 'desc';
      }
      renderTable(lastRows, parseInt(yearSel.value), lastMaxMonth);
      updateSortHeaders();
    });
    // Show idle indicator
    const ind = th.querySelector('.sort-ind');
    if (ind) ind.textContent = ' ↕';
  });

  // ── Init year select ──────────────────────────────────────────────────
  (function initSelects() {
    const ym = window.currentYearMonth();
    for (let y = ym.year; y >= ym.year - 4; y--) {
      const o = document.createElement('option');
      o.value = y; o.textContent = y;
      yearSel.appendChild(o);
    }
  })();

  // ── State helpers ─────────────────────────────────────────────────────
  function showLoading(msg) {
    loadingEl.innerHTML = `<div class="loading-bar"><div class="spinner"></div>${msg || 'Lade Daten…'}</div>`;
    loadingEl.classList.remove('hidden');
    tableWrap.classList.add('hidden');
    summaryEl.classList.add('hidden');
    emptyEl.classList.add('hidden');
    errorEl.innerHTML = '';
  }
  function hideLoading() { loadingEl.classList.add('hidden'); }
  function showError(msg) {
    errorEl.innerHTML = `<div class="alert alert-danger">⚠️ ${msg}</div>`;
    loadingEl.classList.add('hidden');
  }
  function showWarn(msg) {
    errorEl.innerHTML = `<div class="alert alert-warn">⚠️ ${msg}</div>`;
  }

  // ── Load data ─────────────────────────────────────────────────────────
  function loadData() {
    showLoading();
    const year = parseInt(yearSel.value);
    const ym   = window.currentYearMonth();
    // For the current year only count months up to today
    const maxMonth = (year === ym.year) ? ym.month : 12;

    Promise.all([
      window.db.clients.list(),
      window.db.entries.forYear(year),
      window.db.adjustments.forYear(year),
    ]).then(([clients, entries, allAdjs]) => {

      // Index adjustments by client_id → month
      const adjByClient = {};
      allAdjs.forEach(a => {
        if (!adjByClient[a.client_id]) adjByClient[a.client_id] = {};
        adjByClient[a.client_id][a.month] = a;
      });

      if (!clients.length) {
        hideLoading();
        emptyEl.classList.remove('hidden');
        return;
      }

      // Filter entries to completed months only (for current year)
      const visibleEntries = entries.filter(e => e.month <= maxMonth);

      // Group entries by client
      const entriesByClient = {};
      visibleEntries.forEach(e => {
        if (!entriesByClient[e.client_id]) entriesByClient[e.client_id] = [];
        entriesByClient[e.client_id].push(e);
      });

      const rows = clients.map(c => ({
        client:  c,
        entries: entriesByClient[c.id] || [],
        agg:     window.aggregateEntries(entriesByClient[c.id] || []),
        adjs:    adjByClient[c.id] || {},
      }));

      // Cache for re-sorting without reload
      lastRows     = rows;
      lastMaxMonth = maxMonth;

      // Update table header with period
      const ym2 = window.currentYearMonth();
      const periodLabel2 = (year === ym2.year && maxMonth < 12)
        ? `Jan – ${window.MONTHS_DE[maxMonth - 1].slice(0,3)} ${year}`
        : `${year}`;
      const thAmSub  = document.getElementById('thAmSub');
      const thAdvSub = document.getElementById('thAdvSub');
      if (thAmSub)  thAmSub.textContent  = periodLabel2 + ' · inkl. FL÷3';
      if (thAdvSub) thAdvSub.textContent = periodLabel2;

      buildEmpFilter(rows);
      renderTable(rows, year, maxMonth);
      updateSortHeaders();
      hideLoading();
      tableWrap.classList.remove('hidden');
      summaryEl.classList.remove('hidden');
    }).catch(e => {
      showError(e.message === 'NOT_CONFIGURED'
        ? 'Keine Supabase-Verbindung. Bitte <a href="settings.html">Einstellungen</a> prüfen.'
        : 'Fehler: ' + e.message);
    });
  }

  // ── Render table ──────────────────────────────────────────────────────
  function renderTable(rows, year, maxMonth) {
    tbody.innerHTML = '';
    const filtered = applyFilters(rows);
    const sorted   = sortRows(filtered, maxMonth);

    // Update summary with filtered rows
    renderSummary(filtered, year, maxMonth);

    if (!sorted.length && rows.length > 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);font-size:14px">Keine Kunden gefunden.</td>';
      tbody.appendChild(tr);
      return;
    }

    sorted.forEach((row, i) => {
      const { client: c, entries: clientEntries, agg, adjs } = row;
      const { amH, advH, flH, amTotal, breakdown } = agg;

      // Budget = monthly budget × effective months + per-month corrections
      const { amB: annualAmBdg, advB: annualAdvBdg } = effectiveBudget(c, adjs, year, maxMonth);

      const amDiff  = annualAmBdg  != null ? amTotal - annualAmBdg  : null;
      const advDiff = annualAdvBdg != null ? advH    - annualAdvBdg : null;
      const amOver  = amDiff  != null && amDiff  > 0.05;
      const advOver = advDiff != null && advDiff > 0.05;
      const amOk    = amDiff  != null && amDiff  <= 0.05;
      const advOk   = advDiff != null && advDiff <= 0.05;

      const total     = amTotal + advH;
      const hasBudget = c.am_budget != null || c.adv_budget != null;
      const totalBdg  = (annualAmBdg || 0) + (annualAdvBdg || 0);
      const totalDiff = hasBudget ? total - totalBdg : null;

      const overBadges = [];
      if (amOver)  overBadges.push('<span class="badge badge-over">Account Mgmt</span>');
      if (advOver) overBadges.push('<span class="badge badge-over">Advertising</span>');
      const overHtml = overBadges.length
        ? `<div class="over-badges">${overBadges.join('')}</div>`
        : !hasBudget
          ? '<span class="text-muted" style="font-size:12px">kein Budget</span>'
          : '<span class="badge badge-ok">✓ Im Budget</span>';

      const expandId = `am-expand-${i}`;
      const btnId    = `am-btn-${i}`;
      const hasAMData = breakdown.some(b => b.role === 'account_manager' || b.role === 'freelancer');

      const amCellContent = hasAMData
        ? `<button class="expand-btn" id="${btnId}" data-target="${expandId}">
             ${window.svgChevron()} ${window.fmtHours(amTotal)}
           </button>
           ${amDiff != null ? `<div style="font-size:11.5px">${window.fmtDiff(amDiff).text}</div>` : ''}`
        : `<div class="cell-hours">
             <span class="h-main">${window.fmtHours(amTotal)}</span>
             ${amDiff != null ? `<span class="h-diff">${window.fmtDiff(amDiff).text}</span>` : ''}
           </div>`;

      const totalDiffStr = totalDiff != null
        ? `<div style="font-size:11.5px">${window.fmtDiff(totalDiff).text}</div>` : '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <a class="client-link" href="detail.html?id=${encodeURIComponent(c.id)}&name=${encodeURIComponent(c.name)}">
            ${c.name} <span class="arrow">${window.svgArrow()}</span>
          </a>
        </td>
        <td class="right ${amOver ? 'cell-over' : amOk ? 'cell-ok' : ''}">${amCellContent}</td>
        <td class="right ${advOver ? 'cell-over' : advOk ? 'cell-ok' : ''}">
          <div class="cell-hours">
            <span class="h-main">${window.fmtHours(advH)}</span>
            ${advDiff != null ? `<span class="h-diff">${window.fmtDiff(advDiff).text}</span>` : ''}
          </div>
        </td>
        <td class="right mono">${window.fmtHours(total)}</td>
        <td class="right mono ${totalDiff != null && totalDiff > 0.05 ? 'diff-over' : totalDiff != null && totalDiff < -0.05 ? 'diff-under' : ''}" style="font-weight:600">
          ${totalDiff != null ? window.fmtDiff(totalDiff).text : '<span class="text-muted">—</span>'}
        </td>
        <td class="center">${overHtml}</td>
        <td class="center">
          <a class="btn btn-ghost btn-sm" href="detail.html?id=${encodeURIComponent(c.id)}&name=${encodeURIComponent(c.name)}">
            Details ${window.svgArrow()}
          </a>
        </td>`;

      tbody.appendChild(tr);

      // AM breakdown sub-row
      if (hasAMData) {
        const amItems = breakdown.filter(b => b.role === 'account_manager' || b.role === 'freelancer');
        const amBreakdown = amItems.map(b => {
          const isFL    = b.role === 'freelancer';
          const counted = b.counted != null ? b.counted : b.hours;
          const div     = isFL ? (counted > 0 ? Math.round(b.hours / counted) : '?') : null;
          return `<span class="am-breakdown-item">
            <span class="am-tag ${window.getRoleCls(b.role)}">${window.getRoleShort(b.role)}</span>
            <span class="emp-hours">${window.fmtHours(b.hours)}</span>
            <span>${b.name}</span>
            ${isFL ? `<span class="fl-divider">÷${div} = ${window.fmtHours(counted)}</span>` : ''}
          </span>`;
        }).join('');

        const detailTr = document.createElement('tr');
        detailTr.id        = expandId;
        detailTr.className = 'am-breakdown-row hidden';
        detailTr.innerHTML = `<td colspan="6"><div class="am-breakdown-inner">${amBreakdown}</div></td>`;
        tbody.appendChild(detailTr);

        tr.querySelector(`#${btnId}`)?.addEventListener('click', e => {
          e.stopPropagation();
          const btn  = document.getElementById(btnId);
          const dest = document.getElementById(expandId);
          const open = btn.classList.toggle('open');
          dest.classList.toggle('hidden', !open);
        });
      }
    });
  }

  // ── Summary stats ─────────────────────────────────────────────────────
  function renderSummary(rows, year, maxMonth) {
    let totAm = 0, totAdv = 0, totalBudget = 0, clientsOver = 0;
    let hasBudget = false;
    rows.forEach(({ client: c, agg, adjs }) => {
      totAm  += agg.amTotal;
      totAdv += agg.advH;
      const { amB: periodAmBdg, advB: periodAdvBdg } = effectiveBudget(c, adjs, year, maxMonth);
      if (periodAmBdg != null || periodAdvBdg != null) {
        hasBudget = true;
        totalBudget += (periodAmBdg || 0) + (periodAdvBdg || 0);
        if ((periodAmBdg  != null && agg.amTotal > periodAmBdg  + 0.05) ||
            (periodAdvBdg != null && agg.advH    > periodAdvBdg + 0.05)) clientsOver++;
      }
    });
    const total = totAm + totAdv;
    const diff  = hasBudget ? total - totalBudget : null;
    const diffR = diff != null ? window.fmtDiff(diff) : { text: '—', cls: 'zero' };

    // Period label e.g. "Jan – Apr 2026" or "2025"
    const periodLabel = maxMonth < 12
      ? `${window.MONTHS_DE[0].slice(0,3)} – ${window.MONTHS_DE[maxMonth - 1].slice(0,3)} ${year}`
      : `${year}`;

    summaryEl.innerHTML = `
      <div class="stats-row">
        <div class="stat-card"><div class="label">Account Mgmt (${periodLabel})</div><div class="value">${window.fmtHours(totAm)}</div></div>
        <div class="stat-card"><div class="label">Advertising (${periodLabel})</div><div class="value">${window.fmtHours(totAdv)}</div></div>
        <div class="stat-card"><div class="label">Gesamt (${periodLabel})</div><div class="value">${window.fmtHours(total)}</div></div>
        ${hasBudget ? `
        <div class="stat-card"><div class="label">Differenz Budget (${periodLabel})</div>
          <div class="value ${diffR.cls === 'positive' ? 'over' : diffR.cls === 'negative' ? 'under' : ''}">${diffR.text}</div></div>
        <div class="stat-card"><div class="label">Kunden über Budget</div>
          <div class="value ${clientsOver > 0 ? 'over' : ''}">${clientsOver} / ${rows.length}</div></div>` : ''}
      </div>`;
  }

  // ── Clockify year sync ────────────────────────────────────────────────
  function norm(str) { return (str || '').trim().toLowerCase(); }

  async function syncFromClockify() {
    if (!window.clockify.isConfigured()) {
      showError('Clockify nicht verbunden. Bitte zuerst in den <a href="settings.html">Einstellungen</a> den API Key eintragen.');
      return;
    }

    const year = parseInt(yearSel.value);
    const ym   = window.currentYearMonth();
    // Sync all months up to current month for current year, all 12 for past years
    const maxMonth = year < ym.year ? 12 : ym.month;

    syncBtn.disabled = true;
    errorEl.innerHTML = '';

    try {
      // Load clients + employees in parallel
      const [clients, employees] = await Promise.all([
        window.db.clients.list(),
        window.db.employees.listActive(),
      ]);

      const clientMap   = {};
      clients.forEach(c   => { clientMap[norm(c.name)]   = c; });
      const employeeMap = {};
      employees.forEach(e => { employeeMap[norm(e.name)] = e; });

      const saves     = [];
      const unmatched = { clients: new Set(), users: new Set() };
      let   matched   = 0;

      // Fetch all months sequentially with progress
      for (let m = 1; m <= maxMonth; m++) {
        syncBtn.textContent = `Synchronisiere ${window.MONTHS_DE[m - 1]}… (${m}/${maxMonth})`;

        // Fetch client-breakdown, user-totals AND intern hours in parallel
        const [cfMap, userMap, internMap] = await Promise.all([
          window.clockify.fetchMonth(year, m),
          window.clockify.fetchMonthByUser(year, m),
          window.clockify.fetchMonthInternByUser(year, m),
        ]);

        // Client entries (for overview/detail)
        Object.keys(cfMap).forEach(clientKey => {
          const client = clientMap[clientKey];
          if (!client) { unmatched.clients.add(clientKey); return; }

          Object.keys(cfMap[clientKey]).forEach(userKey => {
            const emp   = employeeMap[userKey];
            const hours = cfMap[clientKey][userKey];
            if (!emp) { unmatched.users.add(userKey); return; }
            saves.push(window.db.entries.upsert(
              client.id, emp.id, year, m,
              Math.round(hours * 4) / 4
            ));
            matched++;
          });
        });

        // Total hours per employee (for utilization – includes internal time)
        Object.keys(userMap).forEach(userKey => {
          const emp         = employeeMap[userKey];
          const hours       = userMap[userKey];
          const internHours = internMap[userKey] || 0;
          if (!emp) return;
          saves.push(window.db.utilHours.upsert(
            emp.id, year, m,
            Math.round(hours       * 4) / 4,
            Math.round(internHours * 4) / 4
          ));
        });
      }

      syncBtn.textContent = `Speichere ${matched} Einträge…`;
      await Promise.all(saves);

      // Warnings for unmatched
      const warns = [];
      if (unmatched.clients.size) warns.push('Nicht zugeordnete Kunden: <strong>' + [...unmatched.clients].join(', ') + '</strong>');
      if (unmatched.users.size)   warns.push('Nicht zugeordnete Nutzer: <strong>' + [...unmatched.users].join(', ')   + '</strong>');
      if (warns.length) showWarn(warns.join('<br>'));

      syncBtn.textContent = `✓ ${matched} Einträge synchronisiert`;
      setTimeout(() => { syncBtn.textContent = 'Von Clockify sync'; }, 3000);
      localStorage.setItem('clockifyLastAutoSync', Date.now().toString());
      updateLastSyncLabel();
      loadData();

    } catch (e) {
      showError('Clockify Fehler: ' + e.message);
      syncBtn.textContent = 'Von Clockify sync';
    } finally {
      syncBtn.disabled = false;
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────
  searchInput.addEventListener('input', function () {
    searchText = searchInput.value;
    if (lastRows.length) {
      renderTable(lastRows, parseInt(yearSel.value), lastMaxMonth);
      updateSortHeaders();
    }
  });

  if (!window.isConfigured()) {
    setupHint.classList.remove('hidden');
  } else {
    loadData();
  }
  loadBtn.addEventListener('click', loadData);
  syncBtn.addEventListener('click', syncFromClockify);

  // ── Auto-sync: aktueller Monat zur vollen Stunde ──────────────────────
  const autoSyncStatusEl = document.getElementById('autoSyncStatus');

  function updateLastSyncLabel() {
    const ts = localStorage.getItem('clockifyLastAutoSync');
    if (!ts || !autoSyncStatusEl) return;
    const d  = new Date(parseInt(ts, 10));
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    autoSyncStatusEl.textContent = '↻ ' + hh + ':' + mm + ' Uhr';
  }

  async function autoSyncCurrentMonth() {
    if (!window.clockify.isConfigured() || !window.isConfigured()) return;
    if (autoSyncStatusEl) autoSyncStatusEl.textContent = '↻ Sync…';
    try {
      const ym   = window.currentYearMonth();
      const year = ym.year, month = ym.month;

      const [clients, employees] = await Promise.all([
        window.db.clients.list(),
        window.db.employees.listActive(),
      ]);
      const clientMap = {}, employeeMap = {};
      clients.forEach(c   => { clientMap[norm(c.name)]   = c; });
      employees.forEach(e => { employeeMap[norm(e.name)] = e; });

      const [cfMap, userMap, internMap] = await Promise.all([
        window.clockify.fetchMonth(year, month),
        window.clockify.fetchMonthByUser(year, month),
        window.clockify.fetchMonthInternByUser(year, month),
      ]);

      const saves = [];
      Object.keys(cfMap).forEach(clientKey => {
        const client = clientMap[clientKey];
        if (!client) return;
        Object.keys(cfMap[clientKey]).forEach(userKey => {
          const emp = employeeMap[userKey];
          if (!emp) return;
          saves.push(window.db.entries.upsert(client.id, emp.id, year, month, cfMap[clientKey][userKey]));
        });
      });
      Object.keys(userMap).forEach(userKey => {
        const emp = employeeMap[userKey];
        if (!emp) return;
        saves.push(window.db.utilHours.upsert(emp.id, year, month, userMap[userKey], internMap[userKey] || 0));
      });
      await Promise.all(saves);

      localStorage.setItem('clockifyLastAutoSync', Date.now().toString());
      loadData();
    } catch (e) {
      // Stiller Fehler beim Auto-Sync
    }
    updateLastSyncLabel();
  }

  function scheduleAutoSync() {
    const now          = new Date();
    const msToNextHour = (60 - now.getMinutes()) * 60000
                       - now.getSeconds()        * 1000
                       - now.getMilliseconds();
    setTimeout(function () {
      autoSyncCurrentMonth();
      setInterval(autoSyncCurrentMonth, 60 * 60 * 1000);
    }, msToNextHour);
  }

  if (window.clockify.isConfigured()) {
    updateLastSyncLabel();
    scheduleAutoSync();
  }
})();
