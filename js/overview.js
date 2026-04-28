(function () {
  'use strict';

  const monthSel  = document.getElementById('monthSelect');
  const yearSel   = document.getElementById('yearSelect');
  const loadBtn   = document.getElementById('loadBtn');
  const tableWrap = document.getElementById('tableWrap');
  const tbody     = document.getElementById('clientsBody');
  const loadingEl = document.getElementById('loading');
  const errorEl   = document.getElementById('error');
  const setupHint = document.getElementById('setupHint');
  const summaryEl = document.getElementById('summary');
  const emptyEl   = document.getElementById('emptyClients');

  const syncBtn       = document.getElementById('syncBtn');

  const modal         = document.getElementById('entryModal');
  const modalTitle    = document.getElementById('modalTitle');
  const modalInfo     = document.getElementById('modalClientInfo');
  const modalRows     = document.getElementById('modalEmployeeRows');
  const modalTotals   = document.getElementById('modalTotals');
  const modalClose    = document.getElementById('modalClose');
  const modalCancel   = document.getElementById('modalCancel');
  const modalSave     = document.getElementById('modalSave');

  let modalState   = null; // { client, year, month }
  let allEmployees = [];   // cached active employees

  // ── Init selects ──────────────────────────────────────────────────────
  (function initSelects() {
    const ym = window.currentYearMonth();
    window.MONTHS_DE.forEach((m, i) => {
      const o = document.createElement('option');
      o.value = i + 1; o.textContent = m;
      if (i + 1 === ym.month) o.selected = true;
      monthSel.appendChild(o);
    });
    for (let y = ym.year; y >= ym.year - 4; y--) {
      const o = document.createElement('option');
      o.value = y; o.textContent = y;
      yearSel.appendChild(o);
    }
  })();

  // ── Entry modal ───────────────────────────────────────────────────────
  function openModal(client, year, month, existingEntries) {
    modalState = { client, year, month };
    modalTitle.textContent = 'Stunden erfassen';
    modalInfo.textContent  = `${client.name} · ${window.MONTHS_DE[month - 1]} ${year}`;
    modalTotals.classList.add('hidden');
    modal.classList.remove('hidden');
    renderModalRows(existingEntries);
  }

  function renderModalRows(existingEntries) {
    const entryMap = {};
    (existingEntries || []).forEach(e => { entryMap[e.employee_id] = e.hours; });

    const amGroup  = allEmployees.filter(e => e.role === 'account_manager' || e.role === 'freelancer');
    const advGroup = allEmployees.filter(e => e.role === 'advertising');
    const otherGroup = allEmployees.filter(e => e.role === 'other');

    if (!allEmployees.length) {
      modalRows.innerHTML = `<div class="state-box" style="padding:20px 0">
        <p>Keine aktiven Mitarbeiter gefunden.<br>Bitte zuerst <a href="employees.html">Mitarbeiter anlegen</a>.</p>
      </div>`;
      updateModalTotals();
      return;
    }

    let html = '';

    if (amGroup.length) {
      html += `<div class="entry-section">
        <div class="entry-section-label">Account Management &amp; Freelancer</div>`;
      amGroup.forEach(emp => {
        const hours = entryMap[emp.id] != null ? entryMap[emp.id] : '';
        const isFL  = emp.role === 'freelancer';
        html += `<div class="entry-row">
          <span class="role-badge ${window.getRoleCls(emp.role)}">${window.getRoleShort(emp.role)}</span>
          <span class="entry-name">${emp.name}</span>
          <input type="number" class="emp-hours-input" data-emp-id="${emp.id}" data-role="${emp.role}"
                 min="0" step="0.25" value="${hours}" placeholder="0">
          <span class="entry-unit">h${isFL ? ' <span class="fl-calc" data-emp="${emp.id}"></span>' : ''}</span>
        </div>`;
      });
      html += `</div>`;
    }

    if (advGroup.length) {
      html += `<div class="entry-section">
        <div class="entry-section-label">Advertising</div>`;
      advGroup.forEach(emp => {
        const hours = entryMap[emp.id] != null ? entryMap[emp.id] : '';
        html += `<div class="entry-row">
          <span class="role-badge ${window.getRoleCls(emp.role)}">${window.getRoleShort(emp.role)}</span>
          <span class="entry-name">${emp.name}</span>
          <input type="number" class="emp-hours-input" data-emp-id="${emp.id}" data-role="${emp.role}"
                 min="0" step="0.25" value="${hours}" placeholder="0">
          <span class="entry-unit">h</span>
        </div>`;
      });
      html += `</div>`;
    }

    if (otherGroup.length) {
      html += `<div class="entry-section">
        <div class="entry-section-label" style="color:var(--text-muted)">Sonstige (nicht gewertet)</div>`;
      otherGroup.forEach(emp => {
        const hours = entryMap[emp.id] != null ? entryMap[emp.id] : '';
        html += `<div class="entry-row" style="opacity:.6">
          <span class="role-badge ${window.getRoleCls(emp.role)}">${window.getRoleShort(emp.role)}</span>
          <span class="entry-name">${emp.name}</span>
          <input type="number" class="emp-hours-input" data-emp-id="${emp.id}" data-role="${emp.role}"
                 min="0" step="0.25" value="${hours}" placeholder="0">
          <span class="entry-unit">h</span>
        </div>`;
      });
      html += `</div>`;
    }

    modalRows.innerHTML = html;
    modalRows.querySelectorAll('.emp-hours-input').forEach(inp => {
      inp.addEventListener('input', updateModalTotals);
    });
    updateModalTotals();
  }

  function updateModalTotals() {
    let amH = 0, advH = 0, flH = 0;
    modalRows.querySelectorAll('.emp-hours-input').forEach(inp => {
      const h    = parseFloat(inp.value) || 0;
      const role = inp.dataset.role;
      if      (role === 'account_manager') amH  += h;
      else if (role === 'advertising')     advH += h;
      else if (role === 'freelancer')      flH  += h;
    });

    // Update FL ÷3 notes
    modalRows.querySelectorAll('.emp-hours-input[data-role="freelancer"]').forEach(inp => {
      const calcEl = inp.closest('.entry-row')?.querySelector('.fl-calc');
      if (calcEl) {
        const fl3 = (parseFloat(inp.value) || 0) / 3;
        calcEl.textContent = fl3 > 0 ? `(÷3 = ${window.fmtHours(fl3)})` : '';
      }
    });

    const amTotal = amH + flH / 3;
    modalTotals.classList.remove('hidden');
    modalTotals.innerHTML =
      `<strong>Account Mgmt:</strong> ${window.fmtHours(amTotal)}` +
      (flH > 0 ? ` <span style="font-size:11.5px;color:var(--text-muted)">(${window.fmtHours(amH)} AM + ${window.fmtHours(flH)} FL÷3 = ${window.fmtHours(flH/3)})</span>` : '') +
      `&emsp;<strong>Advertising:</strong> ${window.fmtHours(advH)}`;
  }

  function closeModal() { modal.classList.add('hidden'); modalState = null; }
  modalClose.addEventListener('click',  closeModal);
  modalCancel.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalState) closeModal(); });

  modalSave.addEventListener('click', () => {
    if (!modalState) return;
    const { client, year, month } = modalState;
    const inputs = modalRows.querySelectorAll('.emp-hours-input');
    const saves  = [];

    inputs.forEach(inp => {
      const empId = inp.dataset.empId;
      const hours = parseFloat(inp.value) || 0;
      if (empId) saves.push(window.db.entries.upsert(client.id, empId, year, month, hours));
    });

    if (!saves.length) { closeModal(); return; }
    modalSave.disabled = true;
    modalSave.textContent = 'Speichern…';

    Promise.all(saves)
      .then(() => { closeModal(); loadData(); })
      .catch(e  => alert('Fehler: ' + e.message))
      .finally(() => { modalSave.disabled = false; modalSave.textContent = 'Speichern'; });
  });

  // ── State helpers ─────────────────────────────────────────────────────
  function showLoading() {
    loadingEl.innerHTML = '<div class="loading-bar"><div class="spinner"></div>Lade Daten…</div>';
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

  // ── Load data ─────────────────────────────────────────────────────────
  function loadData() {
    showLoading();
    const year  = parseInt(yearSel.value);
    const month = parseInt(monthSel.value);

    Promise.all([
      window.db.clients.list(),
      window.db.entries.forMonth(year, month),
      window.db.employees.listActive(),
    ]).then(([clients, entries, employees]) => {
      allEmployees = employees;

      if (!clients.length) {
        hideLoading();
        emptyEl.classList.remove('hidden');
        return;
      }

      // Group entries by client
      const entriesByClient = {};
      entries.forEach(e => {
        if (!entriesByClient[e.client_id]) entriesByClient[e.client_id] = [];
        entriesByClient[e.client_id].push(e);
      });

      const rows = clients.map(c => ({
        client:  c,
        entries: entriesByClient[c.id] || [],
        agg:     window.aggregateEntries(entriesByClient[c.id] || []),
      }));

      renderTable(rows, year, month, entries);
      renderSummary(rows);
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
  function renderTable(rows, year, month, allEntries) {
    tbody.innerHTML = '';

    rows.forEach((row, i) => {
      const { client: c, entries: clientEntries, agg } = row;
      const { amH, advH, flH, amTotal, breakdown } = agg;
      const total = amTotal + advH;

      const amDiff  = c.am_budget  != null ? amTotal - c.am_budget  : null;
      const advDiff = c.adv_budget != null ? advH    - c.adv_budget : null;
      const amOver  = amDiff  != null && amDiff  > 0.05;
      const advOver = advDiff != null && advDiff > 0.05;
      const amOk    = amDiff  != null && amDiff  <= 0.05;
      const advOk   = advDiff != null && advDiff <= 0.05;

      const totalBdg  = (c.am_budget || 0) + (c.adv_budget || 0);
      const hasBudget = c.am_budget != null || c.adv_budget != null;
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

      // AM cell: expand button if there's breakdown data
      const hasAMData = breakdown.some(b => b.role === 'account_manager' || b.role === 'freelancer');
      const amCellContent = hasAMData
        ? `<button class="expand-btn" id="${btnId}" data-target="${expandId}">
             ${window.svgChevron()} ${window.fmtHours(amTotal)}
           </button>
           ${amDiff != null ? `<div style="font-size:11.5px">${window.fmtDiff(amDiff).text}</div>` : ''}`
        : `<div class="cell-hours"><span class="h-main">${window.fmtHours(amTotal)}</span>
           ${amDiff != null ? `<span class="h-diff">${window.fmtDiff(amDiff).text}</span>` : ''}</div>`;

      const totalDiffStr = totalDiff != null ? `<div style="font-size:11.5px">${window.fmtDiff(totalDiff).text}</div>` : '';

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
        <td class="right mono">${window.fmtHours(total)}${totalDiffStr}</td>
        <td class="center">${overHtml}</td>
        <td class="center">
          <button class="btn btn-ghost btn-sm btn-icon edit-btn" title="Stunden erfassen">
            ${window.svgPencil()}
          </button>
        </td>`;

      tbody.appendChild(tr);

      // AM breakdown sub-row
      if (hasAMData) {
        const amItems = breakdown.filter(b => b.role === 'account_manager' || b.role === 'freelancer');
        const amBreakdown = amItems.map(b => {
          const isFL    = b.role === 'freelancer';
          const counted = isFL ? b.hours / 3 : b.hours;
          return `<span class="am-breakdown-item">
            <span class="am-tag ${window.getRoleCls(b.role)}">${window.getRoleShort(b.role)}</span>
            <span class="emp-hours">${window.fmtHours(b.hours)}</span>
            <span>${b.name}</span>
            ${isFL ? `<span class="fl-divider">÷3 = ${window.fmtHours(counted)}</span>` : ''}
          </span>`;
        }).join('');

        const detailTr = document.createElement('tr');
        detailTr.id        = expandId;
        detailTr.className = 'am-breakdown-row hidden';
        detailTr.innerHTML = `<td colspan="6">
          <div class="am-breakdown-inner">${amBreakdown}</div>
        </td>`;
        tbody.appendChild(detailTr);

        tr.querySelector(`#${btnId}`)?.addEventListener('click', e => {
          e.stopPropagation();
          const btn  = document.getElementById(btnId);
          const dest = document.getElementById(expandId);
          const open = btn.classList.toggle('open');
          dest.classList.toggle('hidden', !open);
        });
      }

      // Edit button → entry modal
      tr.querySelector('.edit-btn').addEventListener('click', () => {
        openModal(c, year, month, clientEntries);
      });
    });
  }

  // ── Summary stats ─────────────────────────────────────────────────────
  function renderSummary(rows) {
    let totAm = 0, totAdv = 0, totalBudget = 0, clientsOver = 0;
    let hasBudget = false;
    rows.forEach(({ client: c, agg }) => {
      totAm  += agg.amTotal;
      totAdv += agg.advH;
      if (c.am_budget != null || c.adv_budget != null) {
        hasBudget = true;
        totalBudget += (c.am_budget || 0) + (c.adv_budget || 0);
        if ((c.am_budget  != null && agg.amTotal > c.am_budget  + 0.05) ||
            (c.adv_budget != null && agg.advH    > c.adv_budget + 0.05)) clientsOver++;
      }
    });
    const total = totAm + totAdv;
    const diff  = hasBudget ? total - totalBudget : null;
    const diffR = diff != null ? window.fmtDiff(diff) : { text: '—', cls: 'zero' };

    summaryEl.innerHTML = `
      <div class="stats-row">
        <div class="stat-card"><div class="label">Account Mgmt gesamt</div><div class="value">${window.fmtHours(totAm)}</div></div>
        <div class="stat-card"><div class="label">Advertising gesamt</div><div class="value">${window.fmtHours(totAdv)}</div></div>
        <div class="stat-card"><div class="label">Gesamt getrackt</div><div class="value">${window.fmtHours(total)}</div></div>
        ${hasBudget ? `
        <div class="stat-card"><div class="label">Differenz gesamt</div>
          <div class="value ${diffR.cls === 'positive' ? 'over' : diffR.cls === 'negative' ? 'under' : ''}">${diffR.text}</div></div>
        <div class="stat-card"><div class="label">Kunden über Budget</div>
          <div class="value ${clientsOver > 0 ? 'over' : ''}">${clientsOver} / ${rows.length}</div></div>` : ''}
      </div>`;
  }

  // ── Clockify sync ─────────────────────────────────────────────────────
  function syncFromClockify() {
    if (!window.clockify.isConfigured()) {
      showError('Clockify nicht verbunden. Bitte zuerst in den <a href="settings.html">Einstellungen</a> den API Key eintragen.');
      return;
    }

    const year  = parseInt(yearSel.value);
    const month = parseInt(monthSel.value);

    syncBtn.disabled    = true;
    syncBtn.textContent = 'Synchronisiere…';
    errorEl.innerHTML   = '';

    // Load Clockify data + our clients + employees in parallel
    Promise.all([
      window.clockify.fetchMonth(year, month),
      window.db.clients.list(),
      window.db.employees.listActive(),
    ]).then(([cfMap, clients, employees]) => {
      // Build lookup maps (normalised name → object)
      const clientMap   = {};
      clients.forEach(c   => { clientMap[norm(c.name)]   = c; });
      const employeeMap = {};
      employees.forEach(e => { employeeMap[norm(e.name)] = e; });

      const saves        = [];
      const unmatched    = { projects: new Set(), users: new Set() };
      let   matchedCount = 0;

      Object.keys(cfMap).forEach(projKey => {
        const client = clientMap[projKey];
        if (!client) { unmatched.projects.add(projKey); return; }

        Object.keys(cfMap[projKey]).forEach(userKey => {
          const emp   = employeeMap[userKey];
          const hours = cfMap[projKey][userKey];
          if (!emp) { unmatched.users.add(userKey); return; }
          saves.push(window.db.entries.upsert(client.id, emp.id, year, month, Math.round(hours * 4) / 4));
          matchedCount++;
        });
      });

      return Promise.all(saves).then(() => ({ matchedCount, unmatched }));
    }).then(({ matchedCount, unmatched }) => {
      let msg = `✓ ${matchedCount} Einträge aus Clockify übernommen.`;
      const warns = [];
      if (unmatched.projects.size) warns.push('Nicht zugeordnete Projekte: ' + [...unmatched.projects].join(', '));
      if (unmatched.users.size)    warns.push('Nicht zugeordnete Nutzer: '   + [...unmatched.users].join(', '));
      if (warns.length) {
        errorEl.innerHTML = '<div class="alert alert-warn">⚠️ ' + warns.join('<br>') + '</div>';
      }
      loadData(); // Reload table with fresh data
      // Brief success flash on button
      syncBtn.textContent = msg;
      setTimeout(() => { syncBtn.textContent = 'Von Clockify sync'; }, 3000);
    }).catch(e => {
      showError('Clockify Fehler: ' + e.message);
    }).finally(() => {
      syncBtn.disabled = false;
      if (syncBtn.textContent === 'Synchronisiere…') syncBtn.textContent = 'Von Clockify sync';
    });
  }

  function norm(str) { return (str || '').trim().toLowerCase(); }

  // ── Boot ──────────────────────────────────────────────────────────────
  if (!window.isConfigured()) {
    setupHint.classList.remove('hidden');
  } else {
    loadData();
  }
  loadBtn.addEventListener('click', loadData);
  syncBtn.addEventListener('click', syncFromClockify);
})();
