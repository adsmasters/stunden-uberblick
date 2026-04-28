(function () {
  'use strict';

  var params     = new URLSearchParams(location.search);
  var clientId   = params.get('id')   || '';
  var clientName = params.get('name') || 'Kunde';

  var titleEl       = document.getElementById('clientTitle');
  var budgetInfoEl  = document.getElementById('clientBudgetInfo');
  var amBudgetHdr   = document.getElementById('amBudgetHdr');
  var advBudgetHdr  = document.getElementById('advBudgetHdr');
  var yearSel       = document.getElementById('yearSelect');
  var loadBtn       = document.getElementById('loadBtn');
  var tableWrap     = document.getElementById('tableWrap');
  var tbody         = document.getElementById('monthsBody');
  var loadingEl     = document.getElementById('loading');
  var errorEl       = document.getElementById('error');
  var setupHint     = document.getElementById('setupHint');
  var summaryEl     = document.getElementById('summary');
  var editClientBtn = document.getElementById('editClientBtn');

  var budgetModal       = document.getElementById('budgetModal');
  var budgetAmInput     = document.getElementById('budgetAmInput');
  var budgetAdvInput    = document.getElementById('budgetAdvInput');
  var budgetModalClose  = document.getElementById('budgetModalClose');
  var budgetModalCancel = document.getElementById('budgetModalCancel');
  var budgetModalSave   = document.getElementById('budgetModalSave');

  var modal       = document.getElementById('entryModal');
  var modalTitle  = document.getElementById('modalTitle');
  var modalInfo   = document.getElementById('modalClientInfo');
  var modalRows   = document.getElementById('modalEmployeeRows');
  var modalTotals = document.getElementById('modalTotals');
  var modalClose  = document.getElementById('modalClose');
  var modalCancel = document.getElementById('modalCancel');
  var modalSave   = document.getElementById('modalSave');

  var currentClient = null;
  var allEmployees  = [];
  var modalState    = null; // { year, month }

  titleEl.textContent = clientName;
  document.title = clientName + ' – Stundenübersicht';

  // ── Year select ───────────────────────────────────────────────────────
  (function () {
    var ym = window.currentYearMonth();
    for (var y = ym.year; y >= ym.year - 4; y--) {
      var o = document.createElement('option');
      o.value = y; o.textContent = y;
      yearSel.appendChild(o);
    }
  })();

  // ── State helpers ─────────────────────────────────────────────────────
  function showLoading() {
    loadingEl.innerHTML = '<div class="loading-bar"><div class="spinner"></div>Lade Daten…</div>';
    loadingEl.classList.remove('hidden');
    tableWrap.classList.add('hidden');
    summaryEl.classList.add('hidden');
    errorEl.innerHTML = '';
  }
  function hideLoading() { loadingEl.classList.add('hidden'); }
  function showError(msg) {
    errorEl.innerHTML = '<div class="alert alert-danger">⚠️ ' + msg + '</div>';
    loadingEl.classList.add('hidden');
  }

  // ── Load data ─────────────────────────────────────────────────────────
  function loadData() {
    if (!clientId) { showError('Keine Kunden-ID in der URL.'); return; }
    showLoading();
    var year = parseInt(yearSel.value);

    Promise.all([
      window.db.clients.get(clientId),
      window.db.entries.forClientYear(clientId, year),
      window.db.employees.listActive(),
    ]).then(function (results) {
      currentClient = results[0];
      var entries   = results[1];
      allEmployees  = results[2];

      var client = currentClient;
      titleEl.textContent = client.name;
      document.title = client.name + ' – Stundenübersicht';
      amBudgetHdr.textContent  = client.am_budget  != null ? window.fmtHours(client.am_budget)  : '—';
      advBudgetHdr.textContent = client.adv_budget != null ? window.fmtHours(client.adv_budget) : '—';

      var bdgParts = [];
      if (client.am_budget  != null) bdgParts.push('AM: '          + window.fmtHours(client.am_budget)  + '/Mo');
      if (client.adv_budget != null) bdgParts.push('Advertising: ' + window.fmtHours(client.adv_budget) + '/Mo');
      budgetInfoEl.textContent = bdgParts.length ? 'Budget · ' + bdgParts.join(' · ') : 'Kein Budget hinterlegt';

      // Group entries by month
      var entriesByMonth = {};
      entries.forEach(function (e) {
        if (!entriesByMonth[e.month]) entriesByMonth[e.month] = [];
        entriesByMonth[e.month].push(e);
      });

      renderTable(entriesByMonth, year, client);
      renderSummary(entriesByMonth, year, client);
      hideLoading();
      tableWrap.classList.remove('hidden');
      summaryEl.classList.remove('hidden');
    }).catch(function (e) {
      showError('Fehler: ' + e.message);
    });
  }

  // ── Render table ──────────────────────────────────────────────────────
  function renderTable(entriesByMonth, year, client) {
    tbody.innerHTML = '';
    var ym = window.currentYearMonth();

    window.MONTHS_DE.forEach(function (monthName, i) {
      var month    = i + 1;
      var isFuture = year > ym.year || (year === ym.year && month > ym.month);
      var isCurrent= year === ym.year && month === ym.month;
      var monthEntries = entriesByMonth[month] || [];
      var agg = window.aggregateEntries(monthEntries);

      var amTotal = agg.amTotal;
      var advH    = agg.advH;
      var flH     = agg.flH;
      var total   = amTotal + advH;

      var amDiff  = client.am_budget  != null ? amTotal - client.am_budget  : null;
      var advDiff = client.adv_budget != null ? advH    - client.adv_budget : null;
      var amOver  = amDiff  != null && amDiff  > 0.05;
      var advOver = advDiff != null && advDiff > 0.05;
      var amOk    = amDiff  != null && amDiff  <= 0.05;
      var advOk   = advDiff != null && advDiff <= 0.05;

      var hasBudget = client.am_budget != null || client.adv_budget != null;
      var totalBdg  = (client.am_budget || 0) + (client.adv_budget || 0);
      var totalDiff = hasBudget ? total - totalBdg : null;

      var overBadges = [];
      if (amOver)  overBadges.push('<span class="badge badge-over">Account Mgmt</span>');
      if (advOver) overBadges.push('<span class="badge badge-over">Advertising</span>');
      var overHtml = isFuture
        ? '<span class="text-muted">–</span>'
        : overBadges.length
          ? '<div class="over-badges">' + overBadges.join('') + '</div>'
          : hasBudget
            ? '<span class="badge badge-ok">✓</span>'
            : '<span class="text-muted" style="font-size:12px">—</span>';

      var totalDiffStr = totalDiff != null
        ? '<div style="font-size:11.5px">' + window.fmtDiff(totalDiff).text + '</div>' : '';

      var expandId  = 'am-expand-' + month;
      var btnId     = 'am-btn-' + month;
      var editBtnId = 'edit-btn-' + month;

      var hasAMData = agg.breakdown.some(function (b) {
        return b.role === 'account_manager' || b.role === 'freelancer';
      });

      var amCellContent;
      if (isFuture) {
        amCellContent = '<span class="text-muted">–</span>';
      } else if (hasAMData) {
        amCellContent =
          '<button class="expand-btn" id="' + btnId + '" data-target="' + expandId + '">' +
            window.svgChevron() + ' ' + window.fmtHours(amTotal) +
          '</button>' +
          (amDiff != null ? '<div style="font-size:11.5px">' + window.fmtDiff(amDiff).text + '</div>' : '');
      } else {
        amCellContent =
          '<div class="cell-hours"><span class="h-main">' + window.fmtHours(amTotal) + '</span>' +
          (amDiff != null ? '<span class="h-diff">' + window.fmtDiff(amDiff).text + '</span>' : '') + '</div>';
      }

      var advCellContent = isFuture
        ? '<span class="text-muted">–</span>'
        : '<div class="cell-hours"><span class="h-main">' + window.fmtHours(advH) + '</span>' +
          (advDiff != null ? '<span class="h-diff">' + window.fmtDiff(advDiff).text + '</span>' : '') + '</div>';

      var tr = document.createElement('tr');
      tr.className = isFuture ? 'month-future' : isCurrent ? 'month-current' : '';

      tr.innerHTML =
        '<td><strong>' + monthName + '</strong>' +
          (isCurrent ? ' <span style="font-size:11px;color:var(--primary);font-weight:500">← aktuell</span>' : '') +
        '</td>' +
        '<td class="right ' + (!isFuture ? (amOver ? 'cell-over' : amOk ? 'cell-ok' : '') : '') + '">' + amCellContent + '</td>' +
        '<td class="right ' + (!isFuture ? (advOver ? 'cell-over' : advOk ? 'cell-ok' : '') : '') + '">' + advCellContent + '</td>' +
        '<td class="right mono">' +
          (isFuture ? '<span class="text-muted">–</span>' : window.fmtHours(total) + totalDiffStr) +
        '</td>' +
        '<td class="center">' + overHtml + '</td>' +
        '<td class="center">' +
          '<button class="btn btn-ghost btn-sm btn-icon" id="' + editBtnId + '" title="Stunden bearbeiten">' +
            window.svgPencil() +
          '</button>' +
        '</td>';

      tbody.appendChild(tr);

      // AM breakdown sub-row
      if (hasAMData && !isFuture) {
        var amItems = agg.breakdown.filter(function (b) {
          return b.role === 'account_manager' || b.role === 'freelancer';
        });
        var amBreakdownHtml = amItems.map(function (b) {
          var isFL    = b.role === 'freelancer';
          var counted = isFL ? b.hours / 3 : b.hours;
          return '<span class="am-breakdown-item">' +
            '<span class="am-tag ' + window.getRoleCls(b.role) + '">' + window.getRoleShort(b.role) + '</span>' +
            '<span class="emp-hours">' + window.fmtHours(b.hours) + '</span>' +
            '<span>' + b.name + '</span>' +
            (isFL ? '<span class="fl-divider">÷3 = ' + window.fmtHours(counted) + '</span>' : '') +
          '</span>';
        }).join('');

        var detailTr = document.createElement('tr');
        detailTr.id        = expandId;
        detailTr.className = 'am-breakdown-row hidden';
        detailTr.innerHTML = '<td colspan="6"><div class="am-breakdown-inner">' + amBreakdownHtml + '</div></td>';
        tbody.appendChild(detailTr);

        (function (bId, eId) {
          var btn = tr.querySelector('#' + bId);
          if (btn) btn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            var open = btn.classList.toggle('open');
            var dest = document.getElementById(eId);
            if (dest) dest.classList.toggle('hidden', !open);
          });
        })(btnId, expandId);
      }

      // Edit button
      (function (m, mEntries) {
        var editBtn = tr.querySelector('#' + editBtnId);
        if (editBtn) editBtn.addEventListener('click', function () {
          openModal(parseInt(yearSel.value), m, mEntries);
        });
      })(month, monthEntries);
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────
  function renderSummary(entriesByMonth, year, client) {
    var ym = window.currentYearMonth();
    var totAm = 0, totAdv = 0, months = 0;
    for (var m = 1; m <= 12; m++) {
      if (year > ym.year || (year === ym.year && m > ym.month)) continue;
      var agg = window.aggregateEntries(entriesByMonth[m] || []);
      totAm  += agg.amTotal;
      totAdv += agg.advH;
      months++;
    }
    var total    = totAm + totAdv;
    var yearAmB  = client.am_budget  != null ? client.am_budget  * months : null;
    var yearAdvB = client.adv_budget != null ? client.adv_budget * months : null;
    var hasBudget= yearAmB != null || yearAdvB != null;
    var totalBdg = (yearAmB || 0) + (yearAdvB || 0);
    var diff     = hasBudget ? total - totalBdg : null;
    var diffR    = diff != null ? window.fmtDiff(diff) : { text: '—', cls: 'zero' };

    summaryEl.innerHTML =
      '<div class="stats-row">' +
      '<div class="stat-card"><div class="label">AM Jahresgesamt</div><div class="value">' + window.fmtHours(totAm) + '</div></div>' +
      '<div class="stat-card"><div class="label">Advertising Jahresgesamt</div><div class="value">' + window.fmtHours(totAdv) + '</div></div>' +
      '<div class="stat-card"><div class="label">Gesamt (' + months + ' Monate)</div><div class="value">' + window.fmtHours(total) + '</div></div>' +
      '<div class="stat-card"><div class="label">Ø pro Monat</div><div class="value">' + (months > 0 ? window.fmtHours(total / months) : '—') + '</div></div>' +
      (hasBudget ? '<div class="stat-card"><div class="label">Differenz kumuliert</div><div class="value ' + (diffR.cls === 'positive' ? 'over' : diffR.cls === 'negative' ? 'under' : '') + '">' + diffR.text + '</div></div>' : '') +
      '</div>';
  }

  // ── Entry modal ───────────────────────────────────────────────────────
  function openModal(year, month, existingEntries) {
    modalState = { year: year, month: month };
    modalTitle.textContent = 'Stunden erfassen';
    modalInfo.textContent  = (currentClient ? currentClient.name + ' · ' : '') + window.MONTHS_DE[month - 1] + ' ' + year;
    modalTotals.classList.add('hidden');
    modal.classList.remove('hidden');
    renderModalRows(existingEntries);
  }

  function renderModalRows(existingEntries) {
    var entryMap = {};
    (existingEntries || []).forEach(function (e) { entryMap[e.employee_id] = e.hours; });

    var amGroup    = allEmployees.filter(function (e) { return e.role === 'account_manager' || e.role === 'freelancer'; });
    var advGroup   = allEmployees.filter(function (e) { return e.role === 'advertising'; });
    var otherGroup = allEmployees.filter(function (e) { return e.role === 'other'; });

    if (!allEmployees.length) {
      modalRows.innerHTML =
        '<div class="state-box" style="padding:20px 0">' +
        '<p>Keine aktiven Mitarbeiter gefunden.<br>Bitte zuerst <a href="employees.html">Mitarbeiter anlegen</a>.</p>' +
        '</div>';
      updateModalTotals();
      return;
    }

    var html = '';

    if (amGroup.length) {
      html += '<div class="entry-section"><div class="entry-section-label">Account Management &amp; Freelancer</div>';
      amGroup.forEach(function (emp) {
        var hours = entryMap[emp.id] != null ? entryMap[emp.id] : '';
        var isFL  = emp.role === 'freelancer';
        html += '<div class="entry-row">' +
          '<span class="role-badge ' + window.getRoleCls(emp.role) + '">' + window.getRoleShort(emp.role) + '</span>' +
          '<span class="entry-name">' + emp.name + '</span>' +
          '<input type="number" class="emp-hours-input" data-emp-id="' + emp.id + '" data-role="' + emp.role + '"' +
          ' min="0" step="0.25" value="' + hours + '" placeholder="0">' +
          '<span class="entry-unit">h' + (isFL ? ' <span class="fl-calc"></span>' : '') + '</span>' +
          '</div>';
      });
      html += '</div>';
    }

    if (advGroup.length) {
      html += '<div class="entry-section"><div class="entry-section-label">Advertising</div>';
      advGroup.forEach(function (emp) {
        var hours = entryMap[emp.id] != null ? entryMap[emp.id] : '';
        html += '<div class="entry-row">' +
          '<span class="role-badge ' + window.getRoleCls(emp.role) + '">' + window.getRoleShort(emp.role) + '</span>' +
          '<span class="entry-name">' + emp.name + '</span>' +
          '<input type="number" class="emp-hours-input" data-emp-id="' + emp.id + '" data-role="' + emp.role + '"' +
          ' min="0" step="0.25" value="' + hours + '" placeholder="0">' +
          '<span class="entry-unit">h</span>' +
          '</div>';
      });
      html += '</div>';
    }

    if (otherGroup.length) {
      html += '<div class="entry-section"><div class="entry-section-label" style="color:var(--text-muted)">Sonstige (nicht gewertet)</div>';
      otherGroup.forEach(function (emp) {
        var hours = entryMap[emp.id] != null ? entryMap[emp.id] : '';
        html += '<div class="entry-row" style="opacity:.6">' +
          '<span class="role-badge ' + window.getRoleCls(emp.role) + '">' + window.getRoleShort(emp.role) + '</span>' +
          '<span class="entry-name">' + emp.name + '</span>' +
          '<input type="number" class="emp-hours-input" data-emp-id="' + emp.id + '" data-role="' + emp.role + '"' +
          ' min="0" step="0.25" value="' + hours + '" placeholder="0">' +
          '<span class="entry-unit">h</span>' +
          '</div>';
      });
      html += '</div>';
    }

    modalRows.innerHTML = html;
    modalRows.querySelectorAll('.emp-hours-input').forEach(function (inp) {
      inp.addEventListener('input', updateModalTotals);
    });
    updateModalTotals();
  }

  function updateModalTotals() {
    var amH = 0, advH = 0, flH = 0;
    modalRows.querySelectorAll('.emp-hours-input').forEach(function (inp) {
      var h    = parseFloat(inp.value) || 0;
      var role = inp.dataset.role;
      if      (role === 'account_manager') amH  += h;
      else if (role === 'advertising')     advH += h;
      else if (role === 'freelancer')      flH  += h;
    });

    modalRows.querySelectorAll('.emp-hours-input[data-role="freelancer"]').forEach(function (inp) {
      var calcEl = inp.closest('.entry-row') && inp.closest('.entry-row').querySelector('.fl-calc');
      if (calcEl) {
        var fl3 = (parseFloat(inp.value) || 0) / 3;
        calcEl.textContent = fl3 > 0 ? '(÷3 = ' + window.fmtHours(fl3) + ')' : '';
      }
    });

    var amTotal = amH + flH / 3;
    modalTotals.classList.remove('hidden');
    modalTotals.innerHTML =
      '<strong>Account Mgmt:</strong> ' + window.fmtHours(amTotal) +
      (flH > 0 ? ' <span style="font-size:11.5px;color:var(--text-muted)">(' + window.fmtHours(amH) + ' AM + ' + window.fmtHours(flH) + ' FL÷3 = ' + window.fmtHours(flH / 3) + ')</span>' : '') +
      '&emsp;<strong>Advertising:</strong> ' + window.fmtHours(advH);
  }

  function closeModal() { modal.classList.add('hidden'); modalState = null; }
  modalClose.addEventListener('click',  closeModal);
  modalCancel.addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

  modalSave.addEventListener('click', function () {
    if (!modalState) return;
    var year  = modalState.year;
    var month = modalState.month;
    var inputs = modalRows.querySelectorAll('.emp-hours-input');
    var saves  = [];

    inputs.forEach(function (inp) {
      var empId = inp.dataset.empId;
      var hours = parseFloat(inp.value) || 0;
      if (empId) saves.push(window.db.entries.upsert(clientId, empId, year, month, hours));
    });

    if (!saves.length) { closeModal(); return; }
    modalSave.disabled    = true;
    modalSave.textContent = 'Speichern…';

    Promise.all(saves)
      .then(function () { closeModal(); loadData(); })
      .catch(function (e) { alert('Fehler: ' + e.message); })
      .finally(function () { modalSave.disabled = false; modalSave.textContent = 'Speichern'; });
  });

  // ── Budget modal ──────────────────────────────────────────────────────
  editClientBtn.addEventListener('click', function (e) {
    e.preventDefault();
    if (!currentClient) return;
    budgetAmInput.value  = currentClient.am_budget  != null ? currentClient.am_budget  : '';
    budgetAdvInput.value = currentClient.adv_budget != null ? currentClient.adv_budget : '';
    budgetModal.classList.remove('hidden');
    budgetAmInput.focus();
  });

  function closeBudgetModal() { budgetModal.classList.add('hidden'); }
  budgetModalClose.addEventListener('click',  closeBudgetModal);
  budgetModalCancel.addEventListener('click', closeBudgetModal);
  budgetModal.addEventListener('click', function (e) { if (e.target === budgetModal) closeBudgetModal(); });

  budgetModalSave.addEventListener('click', function () {
    if (!currentClient) return;
    var am  = parseFloat(budgetAmInput.value)  || null;
    var adv = parseFloat(budgetAdvInput.value) || null;
    budgetModalSave.disabled = true;
    window.db.clients.update(currentClient.id, { am_budget: am, adv_budget: adv })
      .then(function () { closeBudgetModal(); loadData(); })
      .catch(function (err) { alert('Fehler: ' + err.message); })
      .finally(function () { budgetModalSave.disabled = false; });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (modalState) { closeModal(); return; }
      closeBudgetModal();
    }
  });

  // ── Boot ──────────────────────────────────────────────────────────────
  if (!window.isConfigured()) {
    setupHint.classList.remove('hidden');
  } else {
    loadData();
  }
  loadBtn.addEventListener('click', loadData);
})();
