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

  // Budget modal
  var budgetModal       = document.getElementById('budgetModal');
  var budgetAmInput     = document.getElementById('budgetAmInput');
  var budgetAdvInput    = document.getElementById('budgetAdvInput');
  var budgetModalClose  = document.getElementById('budgetModalClose');
  var budgetModalCancel = document.getElementById('budgetModalCancel');
  var budgetModalSave   = document.getElementById('budgetModalSave');

  // Entry modal
  var modal       = document.getElementById('entryModal');
  var modalTitle  = document.getElementById('modalTitle');
  var modalInfo   = document.getElementById('modalClientInfo');
  var modalRows   = document.getElementById('modalEmployeeRows');
  var modalTotals = document.getElementById('modalTotals');
  var modalClose  = document.getElementById('modalClose');
  var modalCancel = document.getElementById('modalCancel');
  var modalSave   = document.getElementById('modalSave');

  // Adjustment modal
  var adjModal       = document.getElementById('adjModal');
  var adjModalTitle  = document.getElementById('adjModalTitle');
  var adjModalInfo   = document.getElementById('adjModalInfo');
  var adjAmInput     = document.getElementById('adjAmInput');
  var adjAdvInput    = document.getElementById('adjAdvInput');
  var adjNoteInput   = document.getElementById('adjNoteInput');
  var adjModalClose  = document.getElementById('adjModalClose');
  var adjModalCancel = document.getElementById('adjModalCancel');
  var adjModalSave   = document.getElementById('adjModalSave');
  var adjModalDelete = document.getElementById('adjModalDelete');

  var currentClient  = null;
  var allEmployees   = [];

  // ── Contract start helpers ────────────────────────────────────────────
  function contractStart(client) {
    if (!client || !client.contract_start) return null;
    var d = new Date(client.contract_start);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  }
  function isBeforeContract(year, month, client) {
    var cs = contractStart(client);
    if (!cs) return false;
    return year < cs.year || (year === cs.year && month < cs.month);
  }
  function isAfterContract(year, month, client) {
    if (client.budget_switch) return false; // transition client – never fully "after"
    var endDate = client.contract_end || client.project_end || null;
    if (!endDate) return false;
    var d    = new Date(endDate);
    var endY = d.getUTCFullYear();
    var endM = d.getUTCMonth() + 1;
    return year > endY || (year === endY && month > endM);
  }

  function getPhase(year, month, client) {
    if (isBeforeContract(year, month, client)) return 'before';
    if (client.budget_switch) {
      var d   = new Date(client.budget_switch);
      var swY = d.getUTCFullYear(), swM = d.getUTCMonth() + 1;
      if (year > swY || (year === swY && month >= swM)) return 'phase2';
    }
    if (isAfterContract(year, month, client)) return 'after';
    return 'phase1';
  }

  function budgetForPhase(client, phase) {
    if (phase === 'phase2') return { am: client.am_budget2, adv: client.adv_budget2 };
    return { am: client.am_budget, adv: client.adv_budget };
  }
  var modalState     = null; // { year, month }
  var adjState       = null; // { year, month, existing: adj|null }

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

  // ── Booking helpers ───────────────────────────────────────────────────
  var allBookings = [];

  function bookingHoursForMonth(year, month) {
    var h = 0;
    allBookings.forEach(function (b) {
      var sd  = new Date(b.start_month);
      var sy  = sd.getUTCFullYear(), sm = sd.getUTCMonth() + 1;
      var cur = (year - 1) * 12 + month;
      var sta = (sy   - 1) * 12 + sm;
      var end = sta + b.months_count - 1;
      if (cur >= sta && cur <= end) {
        h += (b.amount / b.hourly_rate) / b.months_count;
      }
    });
    return h;
  }

  function fmtEur(n) { return n.toLocaleString('de-DE') + ' €'; }

  function bookingPeriodLabel(b) {
    var sd = new Date(b.start_month);
    var sy = sd.getUTCFullYear(), sm = sd.getUTCMonth();
    if (b.months_count === 1) return window.MONTHS_DE[sm] + ' ' + sy;
    var totalM = (sy - 1) * 12 + sm + 1 + b.months_count - 1;
    var ey = Math.floor((totalM - 1) / 12) + 1;
    var em = ((totalM - 1) % 12);
    return window.MONTHS_DE[sm] + ' ' + sy + ' – ' + window.MONTHS_DE[em] + ' ' + ey;
  }

  // ── Render bookings card ──────────────────────────────────────────────
  var bookingsWrap = document.getElementById('bookingsWrap');

  function renderBookings() {
    if (!bookingsWrap) return;
    var rows = allBookings.map(function (b) {
      var totalH   = b.amount / b.hourly_rate;
      var perMonthH = totalH / b.months_count;
      return '<tr>' +
        '<td style="font-size:13px">' + bookingPeriodLabel(b) + (b.note ? '<br><span style="font-size:11px;color:var(--text-muted)">' + b.note + '</span>' : '') + '</td>' +
        '<td class="right" style="font-size:13px;white-space:nowrap">' + fmtEur(b.amount) + '</td>' +
        '<td class="right" style="font-size:13px">' + b.hourly_rate + ' €/h</td>' +
        '<td class="right" style="font-size:13px;white-space:nowrap">' + window.fmtHours(totalH) +
          (b.months_count > 1 ? '<br><span style="font-size:11px;color:var(--text-muted)">' + window.fmtHours(perMonthH) + '/Mo</span>' : '') + '</td>' +
        '<td class="center"><button class="btn btn-ghost btn-sm booking-edit-btn" data-id="' + b.id + '">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button></td>' +
      '</tr>';
    }).join('');

    bookingsWrap.innerHTML =
      '<div class="card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px 0">' +
          '<span style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted)">Projektbuchungen</span>' +
          '<button id="addBookingBtn" class="btn btn-primary btn-sm">+ Buchung hinzufügen</button>' +
        '</div>' +
        (allBookings.length
          ? '<div class="table-wrap"><table><thead><tr>' +
              '<th style="min-width:160px">Zeitraum</th>' +
              '<th class="right">Betrag</th>' +
              '<th class="right">Satz</th>' +
              '<th class="right">Stunden</th>' +
              '<th class="center" style="width:50px"></th>' +
            '</tr></thead><tbody>' + rows + '</tbody></table></div>'
          : '<div style="padding:14px 18px;font-size:13px;color:var(--text-muted)">Noch keine Buchungen hinterlegt.</div>'
        ) +
      '</div>';
    bookingsWrap.classList.remove('hidden');

    document.getElementById('addBookingBtn').addEventListener('click', function () { openBookingModal(null); });
    bookingsWrap.querySelectorAll('.booking-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var booking = allBookings.find(function (b) { return b.id === btn.dataset.id; });
        if (booking) openBookingModal(booking);
      });
    });
  }

  // ── Booking modal ─────────────────────────────────────────────────────
  var bookingModal       = document.getElementById('bookingModal');
  var bookingModalTitle  = document.getElementById('bookingModalTitle');
  var bookingAmount      = document.getElementById('bookingAmount');
  var bookingRate        = document.getElementById('bookingRate');
  var bookingStart       = document.getElementById('bookingStart');
  var bookingMonthsInp   = document.getElementById('bookingMonths');
  var bookingCalc        = document.getElementById('bookingCalc');
  var bookingNote        = document.getElementById('bookingNote');
  var bookingModalClose  = document.getElementById('bookingModalClose');
  var bookingModalCancel = document.getElementById('bookingModalCancel');
  var bookingModalSave   = document.getElementById('bookingModalSave');
  var bookingModalDelete = document.getElementById('bookingModalDelete');
  var editingBookingId   = null;

  function updateBookingCalc() {
    var amt  = parseFloat(bookingAmount.value) || 0;
    var rate = parseFloat(bookingRate.value)   || 0;
    var mon  = parseInt(bookingMonthsInp.value) || 1;
    if (amt > 0 && rate > 0) {
      var totalH   = amt / rate;
      var perMonthH = totalH / mon;
      bookingCalc.textContent = '= ' + window.fmtHours(totalH) + ' gesamt' +
        (mon > 1 ? ' → ' + window.fmtHours(perMonthH) + '/Monat' : '');
    } else {
      bookingCalc.textContent = '';
    }
  }

  function openBookingModal(booking) {
    editingBookingId = booking ? booking.id : null;
    bookingModalTitle.textContent  = booking ? 'Buchung bearbeiten' : 'Projektbuchung hinzufügen';
    bookingAmount.value            = booking ? booking.amount      : '';
    bookingRate.value              = booking ? booking.hourly_rate : '100';
    bookingStart.value             = booking ? booking.start_month.substring(0, 7) : '';
    bookingMonthsInp.value         = booking ? booking.months_count : 1;
    bookingNote.value              = booking ? (booking.note || '') : '';
    bookingModalDelete.style.display = booking ? '' : 'none';
    updateBookingCalc();
    bookingModal.classList.remove('hidden');
    bookingAmount.focus();
  }

  function closeBookingModal() { bookingModal.classList.add('hidden'); editingBookingId = null; }
  bookingModalClose.addEventListener('click',  closeBookingModal);
  bookingModalCancel.addEventListener('click', closeBookingModal);
  bookingModal.addEventListener('click', function (e) { if (e.target === bookingModal) closeBookingModal(); });

  [bookingAmount, bookingRate, bookingMonthsInp].forEach(function (el) {
    el.addEventListener('input', updateBookingCalc);
  });

  bookingModalSave.addEventListener('click', function () {
    var amt  = parseFloat(bookingAmount.value);
    var rate = parseFloat(bookingRate.value);
    var mon  = parseInt(bookingMonthsInp.value) || 1;
    var start = bookingStart.value;
    if (!amt || !rate || !start) {
      bookingAmount.style.borderColor = !amt   ? 'var(--danger)' : '';
      bookingStart.style.borderColor  = !start ? 'var(--danger)' : '';
      return;
    }
    bookingAmount.style.borderColor = '';
    bookingStart.style.borderColor  = '';

    bookingModalSave.disabled    = true;
    bookingModalSave.textContent = 'Speichern…';

    var fields = {
      client_id:    clientId,
      amount:       amt,
      hourly_rate:  rate,
      start_month:  start + '-01',
      months_count: mon,
      note:         bookingNote.value.trim() || null,
    };
    var promise = editingBookingId
      ? window.db.projectBookings.update(editingBookingId, fields)
      : window.db.projectBookings.create(fields);

    promise
      .then(function () { closeBookingModal(); loadData(); })
      .catch(function (e) { alert('Fehler: ' + e.message); })
      .finally(function () { bookingModalSave.disabled = false; bookingModalSave.textContent = 'Speichern'; });
  });

  bookingModalDelete.addEventListener('click', function () {
    if (!editingBookingId) return;
    bookingModalDelete.disabled    = true;
    bookingModalDelete.textContent = 'Löschen…';
    window.db.projectBookings.delete(editingBookingId)
      .then(function () { closeBookingModal(); loadData(); })
      .catch(function (e) { alert('Fehler: ' + e.message); })
      .finally(function () { bookingModalDelete.disabled = false; bookingModalDelete.textContent = 'Löschen'; });
  });

  // ── Load data ─────────────────────────────────────────────────────────
  function loadData() {
    if (!clientId) { showError('Keine Kunden-ID in der URL.'); return; }
    showLoading();
    var year = parseInt(yearSel.value);

    Promise.all([
      window.db.clients.get(clientId),
      window.db.entries.forClientYear(clientId, year),
      window.db.employees.listActive(),
      window.db.adjustments.forClientYear(clientId, year),
      window.db.projectBookings.forClient(clientId),
    ]).then(function (results) {
      currentClient = results[0];
      var entries      = results[1];
      allEmployees     = results[2];
      var adjustments  = results[3];
      allBookings      = results[4] || [];

      var client = currentClient;
      titleEl.textContent = client.name;
      document.title = client.name + ' – Stundenübersicht';
      var ym           = window.currentYearMonth();
      var curPhase     = getPhase(ym.year, ym.month, client);
      var curBdg       = budgetForPhase(client, curPhase);
      if (client.is_hourly) {
        amBudgetHdr.textContent  = 'Aufwand';
        advBudgetHdr.textContent = 'Aufwand';
      } else {
        amBudgetHdr.textContent  = curBdg.am  != null ? window.fmtHours(curBdg.am)  : '—';
        advBudgetHdr.textContent = curBdg.adv != null ? window.fmtHours(curBdg.adv) : '—';
      }

      var bdgParts = [];
      if (client.is_hourly) {
        bdgParts.push('Abrechnung nach Aufwand');
      } else {
        if (curBdg.am  != null) bdgParts.push('AM: '          + window.fmtHours(curBdg.am)  + '/Mo');
        if (curBdg.adv != null) bdgParts.push('Advertising: ' + window.fmtHours(curBdg.adv) + '/Mo');
        if (client.budget_switch && curPhase === 'phase2') {
          var bs = new Date(client.budget_switch);
          bdgParts.push('seit ' + window.MONTHS_DE[bs.getUTCMonth()] + ' ' + bs.getUTCFullYear());
        }
      }
      var cs = contractStart(client);
      if (cs) bdgParts.push('Vertragsstart: ' + window.MONTHS_DE[cs.month - 1] + ' ' + cs.year);
      budgetInfoEl.textContent = bdgParts.length ? bdgParts.join(' · ') : 'Kein Budget hinterlegt';

      // Group entries by month
      var entriesByMonth = {};
      entries.forEach(function (e) {
        if (!entriesByMonth[e.month]) entriesByMonth[e.month] = [];
        entriesByMonth[e.month].push(e);
      });

      // Index adjustments by month
      var adjByMonth = {};
      (adjustments || []).forEach(function (a) { adjByMonth[a.month] = a; });

      renderBookings();
      renderTable(entriesByMonth, adjByMonth, year, client);
      renderSummary(entriesByMonth, adjByMonth, year, client);
      hideLoading();
      tableWrap.classList.remove('hidden');
      summaryEl.classList.remove('hidden');
    }).catch(function (e) {
      showError('Fehler: ' + e.message);
    });
  }

  // ── Render table ──────────────────────────────────────────────────────
  function renderTable(entriesByMonth, adjByMonth, year, client) {
    tbody.innerHTML = '';
    var ym = window.currentYearMonth();

    window.MONTHS_DE.forEach(function (monthName, i) {
      var month    = i + 1;
      var isFuture = year > ym.year || (year === ym.year && month > ym.month);
      var isCurrent= year === ym.year && month === ym.month;
      var monthEntries = entriesByMonth[month] || [];
      var agg = window.aggregateEntries(monthEntries, year, month);
      var adj = adjByMonth[month] || null;

      // Tracked hours + project bookings
      var bookingH = !isFuture ? bookingHoursForMonth(year, month) : 0;
      var amTotal  = agg.amTotal + bookingH;
      var advH     = agg.advH;
      var total    = amTotal + advH;

      // Correction amounts (applied to budget, not to hours)
      var adjAm  = adj ? (adj.am_hours  || 0) : 0;
      var adjAdv = adj ? (adj.adv_hours || 0) : 0;

      var phase       = getPhase(year, month, client);
      var outOfPeriod = phase === 'before' || phase === 'after';
      var bdg         = budgetForPhase(client, phase);

      // Effective budget = monthly budget ± correction
      // For hourly clients: tracked hours become the budget automatically
      var effAmBudget, effAdvBudget;
      if (client.is_hourly && !outOfPeriod && !isFuture) {
        effAmBudget  = amTotal + adjAm;
        effAdvBudget = advH    + adjAdv;
      } else {
        effAmBudget  = (!outOfPeriod && bdg.am  != null) ? bdg.am  + adjAm  : null;
        effAdvBudget = (!outOfPeriod && bdg.adv != null) ? bdg.adv + adjAdv : null;
      }

      var amDiff  = effAmBudget  != null ? amTotal - effAmBudget  : null;
      var advDiff = effAdvBudget != null ? advH    - effAdvBudget : null;
      var amOver  = amDiff  != null && amDiff  > 0.05;
      var advOver = advDiff != null && advDiff > 0.05;
      var amOk    = amDiff  != null && amDiff  <= 0.05;
      var advOk   = advDiff != null && advDiff <= 0.05;

      var hasBudget = !outOfPeriod && (effAmBudget != null || effAdvBudget != null);
      var totalBdg  = (effAmBudget || 0) + (effAdvBudget || 0);
      var totalDiff = hasBudget ? total - totalBdg : null;

      var overBadges = [];
      if (amOver)  overBadges.push('<span class="badge badge-over">Account Mgmt</span>');
      if (advOver) overBadges.push('<span class="badge badge-over">Advertising</span>');
      var overHtml = isFuture
        ? '<span class="text-muted">–</span>'
        : phase === 'before'
          ? '<span class="text-muted" style="font-size:11px">vor Vertragsstart</span>'
          : phase === 'after'
          ? '<span class="text-muted" style="font-size:11px">Vertrag beendet</span>'
          : overBadges.length
            ? '<div class="over-badges">' + overBadges.join('') + '</div>'
            : hasBudget
              ? '<span class="badge badge-ok">✓</span>'
              : '<span class="text-muted" style="font-size:12px">—</span>';

      var totalDiffStr = totalDiff != null
        ? '<div style="font-size:11.5px">' + window.fmtDiff(totalDiff).text + '</div>' : '';

      var btnId       = 'am-btn-'   + month;
      var advBtnId    = 'adv-btn-'  + month;
      var expandId    = 'am-exp-'   + month;
      var advExpandId = 'adv-exp-'  + month;
      var editBtnId   = 'edit-btn-' + month;
      var adjBtnId    = 'adj-btn-'  + month;

      var hasAMData = agg.breakdown.some(function (b) {
        return b.role === 'account_manager' || b.role === 'freelancer';
      });
      var hasADVData = agg.breakdown.some(function (b) { return b.role === 'advertising'; });
      var hasBreakdown = hasAMData || hasADVData || bookingH > 0;

      // AM cell – badges for budget correction and project booking
      var adjAmBadge = (!isFuture && adjAm !== 0)
        ? ' <span class="adj-badge" title="' + (adj && adj.note ? adj.note : 'Budgetkorrektur') + '">'
          + 'Budget ' + (adjAm > 0 ? '+' : '') + window.fmtHours(adjAm) + '</span>'
        : '';
      var bookingBadge = (!isFuture && bookingH > 0)
        ? ' <span class="adj-badge" title="Projektbuchung">+' + window.fmtHours(bookingH) + ' Buchung</span>'
        : '';

      var showAMExpand  = !isFuture && (hasAMData || bookingH > 0);
      var showADVExpand = !isFuture && hasADVData;

      // ADV badge (needed before advCellContent)
      var adjAdvBadge = (!isFuture && adjAdv !== 0)
        ? ' <span class="adj-badge" title="' + (adj && adj.note ? adj.note : 'Budgetkorrektur') + '">'
          + 'Budget ' + (adjAdv > 0 ? '+' : '') + window.fmtHours(adjAdv) + '</span>'
        : '';

      var amCellContent;
      if (isFuture) {
        amCellContent = '<span class="text-muted">–</span>';
      } else if (showAMExpand) {
        amCellContent =
          '<button class="expand-btn" id="' + btnId + '">' +
            window.svgChevron() + ' ' + window.fmtHours(amTotal) +
          '</button>' + adjAmBadge + bookingBadge +
          (amDiff != null ? '<div style="font-size:11.5px">' + window.fmtDiff(amDiff).text + '</div>' : '');
      } else {
        amCellContent =
          '<div class="cell-hours"><span class="h-main">' + window.fmtHours(amTotal) + '</span>' + adjAmBadge + bookingBadge +
          (amDiff != null ? '<span class="h-diff">' + window.fmtDiff(amDiff).text + '</span>' : '') + '</div>';
      }

      var advCellContent;
      if (isFuture) {
        advCellContent = '<span class="text-muted">–</span>';
      } else if (showADVExpand) {
        advCellContent =
          '<button class="expand-btn" id="' + advBtnId + '">' +
            window.svgChevron() + ' ' + window.fmtHours(advH) +
          '</button>' + adjAdvBadge +
          (advDiff != null ? '<div style="font-size:11.5px">' + window.fmtDiff(advDiff).text + '</div>' : '');
      } else {
        advCellContent =
          '<div class="cell-hours"><span class="h-main">' + window.fmtHours(advH) + '</span>' + adjAdvBadge +
          (advDiff != null ? '<span class="h-diff">' + window.fmtDiff(advDiff).text + '</span>' : '') + '</div>';
      }

      // Adjustment button – highlighted if correction exists
      var adjBtnStyle = adj ? 'color:var(--primary);font-weight:600' : '';
      var adjBtnTitle = adj ? 'Korrektur bearbeiten' : 'Korrektur hinzufügen';

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
          '<div style="display:flex;gap:4px;justify-content:center">' +
            '<button class="btn btn-ghost btn-sm btn-icon" id="' + editBtnId + '" title="Stunden bearbeiten">' +
              window.svgPencil() +
            '</button>' +
            '<button class="btn btn-ghost btn-sm" id="' + adjBtnId + '" title="' + adjBtnTitle + '" style="' + adjBtnStyle + '">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
                (adj
                  ? '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'
                  : '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>') +
              '</svg>' +
              (adj ? ' Korr.' : ' Korr.') +
            '</button>' +
          '</div>' +
        '</td>';

      tbody.appendChild(tr);

      // AM breakdown sub-row
      if (showAMExpand) {
        var flDiv = window.flDivisor(year, month);
        var amItems = agg.breakdown.filter(function (b) {
          return b.role === 'account_manager' || b.role === 'freelancer';
        });
        var amBreakdownHtml = amItems.map(function (b) {
          var isFL    = b.role === 'freelancer';
          var counted = b.counted != null ? b.counted : b.hours;
          var nameStr = b.name + (isFL ? ' <span class="fl-divider">÷' + flDiv + ' = ' + window.fmtHours(counted) + '</span>' : '');
          return '<span class="am-breakdown-item">' +
            '<span class="am-tag ' + window.getRoleCls(b.role) + '">' + window.getRoleShort(b.role) + '</span>' +
            '<span class="emp-hours">' + window.fmtHours(b.hours) + '</span>' +
            '<span class="emp-name">' + nameStr + '</span>' +
          '</span>';
        }).join('');
        if (adjAm !== 0) {
          amBreakdownHtml +=
            '<span class="am-breakdown-item" style="color:var(--primary)">' +
              '<span class="am-tag role-am">Korr.</span>' +
              '<span class="emp-hours">' + (adjAm > 0 ? '+' : '') + window.fmtHours(adjAm) + '</span>' +
              '<span class="emp-name">' + (adj && adj.note ? adj.note : '') + '</span>' +
            '</span>';
        }
        var amExpandTr = document.createElement('tr');
        amExpandTr.id        = expandId;
        amExpandTr.className = 'am-breakdown-row hidden';
        amExpandTr.innerHTML =
          '<td></td>' +
          '<td class="right" style="overflow:hidden"><div class="am-breakdown-inner am-breakdown-col">' + amBreakdownHtml + '</div></td>' +
          '<td></td><td></td><td></td><td></td>';
        tbody.appendChild(amExpandTr);
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

      // ADV breakdown sub-row
      if (showADVExpand) {
        var advItems = agg.breakdown.filter(function (b) { return b.role === 'advertising'; });
        var advBreakdownHtml = advItems.map(function (b) {
          return '<span class="am-breakdown-item">' +
            '<span class="am-tag ' + window.getRoleCls(b.role) + '">' + window.getRoleShort(b.role) + '</span>' +
            '<span class="emp-hours">' + window.fmtHours(b.hours) + '</span>' +
            '<span class="emp-name">' + b.name + '</span>' +
          '</span>';
        }).join('');
        if (adjAdv !== 0) {
          advBreakdownHtml +=
            '<span class="am-breakdown-item" style="color:var(--primary)">' +
              '<span class="am-tag role-adv">Korr.</span>' +
              '<span class="emp-hours">' + (adjAdv > 0 ? '+' : '') + window.fmtHours(adjAdv) + '</span>' +
              '<span class="emp-name">' + (adj && adj.note ? adj.note : '') + '</span>' +
            '</span>';
        }
        var advExpandTr = document.createElement('tr');
        advExpandTr.id        = advExpandId;
        advExpandTr.className = 'am-breakdown-row hidden';
        advExpandTr.innerHTML =
          '<td></td><td></td>' +
          '<td class="right" style="overflow:hidden"><div class="am-breakdown-inner am-breakdown-col">' + advBreakdownHtml + '</div></td>' +
          '<td></td><td></td><td></td>';
        tbody.appendChild(advExpandTr);
        (function (bId, eId) {
          var btn = tr.querySelector('#' + bId);
          if (btn) btn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            var open = btn.classList.toggle('open');
            var dest = document.getElementById(eId);
            if (dest) dest.classList.toggle('hidden', !open);
          });
        })(advBtnId, advExpandId);
      }

      // Edit button (employee hours)
      (function (m, mEntries) {
        var editBtn = tr.querySelector('#' + editBtnId);
        if (editBtn) editBtn.addEventListener('click', function () {
          openModal(parseInt(yearSel.value), m, mEntries);
        });
      })(month, monthEntries);

      // Adjustment button
      (function (m, existing) {
        var adjBtn = tr.querySelector('#' + adjBtnId);
        if (adjBtn) adjBtn.addEventListener('click', function () {
          openAdjModal(parseInt(yearSel.value), m, existing);
        });
      })(month, adj);
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────
  function renderSummary(entriesByMonth, adjByMonth, year, client) {
    var ym = window.currentYearMonth();
    var totAm = 0, totAdv = 0, months = 0;
    var yearAmB  = (client.am_budget  != null || client.am_budget2  != null) ? 0 : null;
    var yearAdvB = (client.adv_budget != null || client.adv_budget2 != null) ? 0 : null;
    for (var m = 1; m <= 12; m++) {
      if (year > ym.year || (year === ym.year && m > ym.month)) continue;
      var ph = getPhase(year, m, client);
      if (ph === 'before' || ph === 'after') continue;
      var agg = window.aggregateEntries(entriesByMonth[m] || [], year, m);
      var adj = adjByMonth[m] || null;
      var adjAmH  = adj ? (adj.am_hours  || 0) : 0;
      var adjAdvH = adj ? (adj.adv_hours || 0) : 0;
      var bdgM = budgetForPhase(client, ph);
      totAm  += agg.amTotal + bookingHoursForMonth(year, m);
      totAdv += agg.advH;
      if (yearAmB  != null && bdgM.am  != null) yearAmB  += bdgM.am  + adjAmH;
      if (yearAdvB != null && bdgM.adv != null) yearAdvB += bdgM.adv + adjAdvH;
      months++;
    }
    var total    = totAm + totAdv;
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

  // ── Entry modal (employee hours) ──────────────────────────────────────
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

    var flDiv = window.flDivisor(modalState ? modalState.year : 0, modalState ? modalState.month : 0);

    modalRows.querySelectorAll('.emp-hours-input[data-role="freelancer"]').forEach(function (inp) {
      var calcEl = inp.closest('.entry-row') && inp.closest('.entry-row').querySelector('.fl-calc');
      if (calcEl) {
        var flC = (parseFloat(inp.value) || 0) / flDiv;
        calcEl.textContent = flC > 0 ? '(÷' + flDiv + ' = ' + window.fmtHours(flC) + ')' : '';
      }
    });

    var amTotal = amH + flH / flDiv;
    modalTotals.classList.remove('hidden');
    modalTotals.innerHTML =
      '<strong>Account Mgmt:</strong> ' + window.fmtHours(amTotal) +
      (flH > 0 ? ' <span style="font-size:11.5px;color:var(--text-muted)">(' + window.fmtHours(amH) + ' AM + ' + window.fmtHours(flH) + ' FL÷' + flDiv + ' = ' + window.fmtHours(flH / flDiv) + ')</span>' : '') +
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

  // ── Adjustment modal ──────────────────────────────────────────────────
  function openAdjModal(year, month, existing) {
    adjState = { year: year, month: month, existing: existing || null };
    adjModalTitle.textContent = existing ? 'Korrektur bearbeiten' : 'Korrektur hinzufügen';
    adjModalInfo.textContent  = (currentClient ? currentClient.name + ' · ' : '') + window.MONTHS_DE[month - 1] + ' ' + year;
    adjAmInput.value   = existing && existing.am_hours  ? existing.am_hours  : '';
    adjAdvInput.value  = existing && existing.adv_hours ? existing.adv_hours : '';
    adjNoteInput.value = existing && existing.note      ? existing.note      : '';
    adjModalDelete.style.display = existing ? '' : 'none';
    adjModal.classList.remove('hidden');
    adjAmInput.focus();
  }

  function closeAdjModal() { adjModal.classList.add('hidden'); adjState = null; }
  adjModalClose.addEventListener('click',  closeAdjModal);
  adjModalCancel.addEventListener('click', closeAdjModal);
  adjModal.addEventListener('click', function (e) { if (e.target === adjModal) closeAdjModal(); });

  adjModalSave.addEventListener('click', function () {
    if (!adjState) return;
    var amH  = parseFloat(adjAmInput.value)  || 0;
    var advH = parseFloat(adjAdvInput.value) || 0;
    var note = adjNoteInput.value.trim() || null;

    adjModalSave.disabled    = true;
    adjModalSave.textContent = 'Speichern…';

    window.db.adjustments.upsert(clientId, adjState.year, adjState.month, amH, advH, note)
      .then(function () { closeAdjModal(); loadData(); })
      .catch(function (e) { alert('Fehler: ' + e.message); })
      .finally(function () { adjModalSave.disabled = false; adjModalSave.textContent = 'Speichern'; });
  });

  adjModalDelete.addEventListener('click', function () {
    if (!adjState || !adjState.existing) return;
    adjModalDelete.disabled    = true;
    adjModalDelete.textContent = 'Löschen…';

    window.db.adjustments.delete(clientId, adjState.year, adjState.month)
      .then(function () { closeAdjModal(); loadData(); })
      .catch(function (e) { alert('Fehler: ' + e.message); })
      .finally(function () { adjModalDelete.disabled = false; adjModalDelete.textContent = 'Korrektur löschen'; });
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
      if (adjState)   { closeAdjModal();    return; }
      if (modalState) { closeModal();       return; }
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
