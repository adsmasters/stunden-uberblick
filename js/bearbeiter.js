(function () {
  'use strict';

  var empSelect  = document.getElementById('empSelect');
  var monthPick  = document.getElementById('monthPick');
  var loadingEl  = document.getElementById('loading');
  var errorEl    = document.getElementById('error');
  var summaryEl  = document.getElementById('summary');
  var tableWrap  = document.getElementById('tableWrap');
  var tbody      = document.getElementById('tableBody');
  var setupHint  = document.getElementById('setupHint');
  var emptyState = document.getElementById('emptyState');

  // Default to current month
  var ym = window.currentYearMonth();
  monthPick.value = ym.year + '-' + String(ym.month).padStart(2, '0');

  // ── Phase helpers ─────────────────────────────────────────────────────
  function getPhase(year, month, client) {
    if (client.contract_start) {
      var cs = new Date(client.contract_start);
      var csY = cs.getUTCFullYear(), csM = cs.getUTCMonth() + 1;
      if (year < csY || (year === csY && month < csM)) return 'before';
    }
    if (client.budget_switch) {
      var bs = new Date(client.budget_switch);
      var bsY = bs.getUTCFullYear(), bsM = bs.getUTCMonth() + 1;
      if (year > bsY || (year === bsY && month >= bsM)) return 'phase2';
    }
    if (!client.budget_switch) {
      var end = client.contract_end || client.project_end || null;
      if (end) {
        var ed = new Date(end);
        var edY = ed.getUTCFullYear(), edM = ed.getUTCMonth() + 1;
        if (year > edY || (year === edY && month > edM)) return 'after';
      }
    }
    return 'phase1';
  }

  function budgetForPhase(client, phase) {
    if (phase === 'phase2') return { am: client.am_budget2, adv: client.adv_budget2 };
    return { am: client.am_budget, adv: client.adv_budget };
  }

  function bookingHoursForMonth(bookings, year, month) {
    var total = 0;
    (bookings || []).forEach(function (b) {
      var start = new Date(b.start_month);
      var sY = start.getUTCFullYear(), sM = start.getUTCMonth() + 1;
      var startIdx = sY * 12 + sM - 1;
      var curIdx   = year * 12 + month - 1;
      if (curIdx >= startIdx && curIdx < startIdx + (b.months_count || 1)) {
        total += (b.amount || 0) / (b.hourly_rate || 1);
      }
    });
    return total;
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── UI helpers ────────────────────────────────────────────────────────
  function showLoading() {
    loadingEl.innerHTML = '<div class="loading-bar"><div class="spinner"></div>Daten werden geladen…</div>';
    loadingEl.classList.remove('hidden');
    tableWrap.classList.add('hidden');
    summaryEl.classList.add('hidden');
    emptyState.classList.add('hidden');
    errorEl.innerHTML = '';
  }

  function showError(msg) {
    loadingEl.classList.add('hidden');
    errorEl.innerHTML = '<div class="alert alert-danger">⚠️ ' + msg + '</div>';
  }

  // ── Init: populate employee dropdown ──────────────────────────────────
  function init() {
    window.db.employees.listActive().then(function (emps) {
      emps.forEach(function (e) {
        if (e.role !== 'account_manager' && e.role !== 'advertising') return;
        var o = document.createElement('option');
        o.value = e.id;
        o.textContent = e.name + ' (' + window.getRoleShort(e.role) + ')';
        empSelect.appendChild(o);
      });
      if (empSelect.options.length > 1) loadData();
    }).catch(function (e) {
      showError('Fehler beim Laden der Mitarbeiter: ' + e.message);
    });
  }

  empSelect.addEventListener('change', loadData);
  monthPick.addEventListener('change', loadData);

  // ── Load data ─────────────────────────────────────────────────────────
  function loadData() {
    var empId    = empSelect.value;
    var monthVal = monthPick.value;
    if (!empId || !monthVal) return;

    var parts = monthVal.split('-');
    var year  = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10);

    showLoading();

    Promise.all([
      window.db.clients.list(),
      window.db.entries.forMonth(year, month),
      window.db.adjustments.forYear(year),
    ]).then(function (results) {
      var allClients = results[0];
      var entries    = results[1];
      var allAdjs    = results[2];

      // Filter to clients where selected employee is AM or ADV
      var myClients = [];
      allClients.forEach(function (c) {
        var isAM  = c.am_employee_id  === empId;
        var isADV = c.adv_employee_id === empId;
        if (isAM)           myClients.push({ client: c, role: 'am' });
        else if (isADV)     myClients.push({ client: c, role: 'adv' });
      });

      // Adjustments indexed by client_id for this month
      var adjByClient = {};
      allAdjs.forEach(function (a) {
        if (a.month === month) adjByClient[a.client_id] = a;
      });

      // Entries grouped by client_id
      var entriesByClient = {};
      entries.forEach(function (e) {
        if (!entriesByClient[e.client_id]) entriesByClient[e.client_id] = [];
        entriesByClient[e.client_id].push(e);
      });

      var clientIds = myClients.map(function (mc) { return mc.client.id; });
      return window.db.projectBookings.forClientIds(clientIds).then(function (bookings) {
        var bookingsByClient = {};
        (bookings || []).forEach(function (b) {
          if (!bookingsByClient[b.client_id]) bookingsByClient[b.client_id] = [];
          bookingsByClient[b.client_id].push(b);
        });
        render(myClients, entriesByClient, adjByClient, bookingsByClient, year, month);
      });
    }).catch(function (e) {
      showError('Fehler: ' + e.message);
    });
  }

  // ── Render ────────────────────────────────────────────────────────────
  function render(myClients, entriesByClient, adjByClient, bookingsByClient, year, month) {
    loadingEl.classList.add('hidden');

    if (!myClients.length) {
      emptyState.classList.remove('hidden');
      return;
    }

    var rows = myClients.map(function (mc) {
      var c    = mc.client;
      var role = mc.role;

      var phase       = getPhase(year, month, c);
      var outOfPeriod = phase === 'before' || phase === 'after';
      var bdg         = budgetForPhase(c, phase);
      var adj         = adjByClient[c.id] || null;

      // Phase-aware budget + adjustment
      var rawBdg     = outOfPeriod ? null : (role === 'am' ? bdg.am : bdg.adv);
      var adjHours   = adj ? (role === 'am' ? (adj.am_hours || 0) : (adj.adv_hours || 0)) : 0;
      var monthBudget = rawBdg != null ? rawBdg + adjHours : null;

      // Tracked hours
      var clientEntries = entriesByClient[c.id] || [];
      var agg     = window.aggregateEntries(clientEntries, year, month);
      var tracked = role === 'am' ? agg.amTotal : agg.advH;

      // Add project bookings to AM tracked hours
      var clientBookings = bookingsByClient[c.id] || [];
      var bookingH = bookingHoursForMonth(clientBookings, year, month);
      if (role === 'am') tracked += bookingH;

      var remaining = monthBudget != null ? monthBudget - tracked : null;

      return {
        client:      c,
        role:        role,
        outOfPeriod: outOfPeriod,
        phase:       phase,
        tracked:     tracked,
        monthBudget: monthBudget,
        remaining:   remaining,
        bookingH:    bookingH,
      };
    });

    // Sort: active clients first, then alphabetically
    rows.sort(function (a, b) {
      if (a.outOfPeriod !== b.outOfPeriod) return a.outOfPeriod ? 1 : -1;
      return a.client.name.localeCompare(b.client.name, 'de');
    });

    // Summary totals (active clients only)
    var totTracked = 0, totBudget = 0, hasBudget = false;
    rows.forEach(function (r) {
      if (r.outOfPeriod) return;
      totTracked += r.tracked;
      if (r.monthBudget != null) { totBudget += r.monthBudget; hasBudget = true; }
    });
    var totRemaining = hasBudget ? totBudget - totTracked : null;

    renderSummary(totTracked, totBudget, totRemaining, hasBudget, year, month);
    summaryEl.classList.remove('hidden');

    tbody.innerHTML = '';
    rows.forEach(function (r) { tbody.appendChild(renderRow(r)); });
    tableWrap.classList.remove('hidden');
    emptyState.classList.add('hidden');
  }

  function renderSummary(totTracked, totBudget, totRemaining, hasBudget, year, month) {
    var monthName = window.MONTHS_DE[month - 1] + ' ' + year;

    var remColor = '';
    var remText  = '—';
    if (totRemaining != null) {
      remText  = (totRemaining > 0 ? '+' : '') + window.fmtHours(totRemaining);
      remColor = totRemaining > 0.05 ? 'color:var(--success)' :
                 totRemaining < -0.05 ? 'color:var(--danger)'  : 'color:var(--text-muted)';
    }

    summaryEl.innerHTML =
      '<div class="stats-row">' +
        '<div class="stat-card"><div class="label">Budget ' + escHtml(monthName) + '</div>' +
          '<div class="value">' + (hasBudget ? window.fmtHours(totBudget) : '—') + '</div></div>' +
        '<div class="stat-card"><div class="label">Geleistet</div>' +
          '<div class="value">' + window.fmtHours(totTracked) + '</div></div>' +
        '<div class="stat-card"><div class="label">Offen</div>' +
          '<div class="value" style="' + remColor + '">' + remText + '</div></div>' +
      '</div>';
  }

  function renderRow(r) {
    var tr = document.createElement('tr');
    if (r.outOfPeriod) tr.style.opacity = '0.45';

    var roleCls   = r.role === 'am' ? 'role-am' : 'role-adv';
    var roleLabel = r.role === 'am' ? 'AM' : 'ADV';

    // Remaining cell
    var remText  = '—';
    var remStyle = '';
    if (r.remaining != null && !r.outOfPeriod) {
      remText  = (r.remaining > 0 ? '+' : '') + window.fmtHours(r.remaining);
      remStyle = r.remaining > 0.05  ? 'color:var(--success);font-weight:600' :
                 r.remaining < -0.05 ? 'color:var(--danger);font-weight:600'  : 'color:var(--text-muted)';
    }

    // Progress bar
    var progressHtml = '';
    if (r.monthBudget && r.monthBudget > 0 && !r.outOfPeriod) {
      var pct    = Math.min(100, Math.round((r.tracked / r.monthBudget) * 100));
      var fillCls = pct >= 100 ? 'high' : pct >= 80 ? 'medium' : 'low';
      progressHtml =
        '<div class="util-bar-track" style="width:100%">' +
          '<div class="util-bar-fill ' + fillCls + '" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<div class="util-bar-label">' + pct + '%</div>';
    }

    // Booking badge
    var bookBadge = '';
    if (r.bookingH > 0 && !r.outOfPeriod) {
      bookBadge = ' <span class="adj-badge">+' + window.fmtHours(r.bookingH) + ' Buchung</span>';
    }

    // Budget cell
    var budgetCell = '—';
    if (r.outOfPeriod) {
      budgetCell = '<span class="text-muted" style="font-size:12px">' +
        (r.phase === 'before' ? 'Vor Laufzeit' : 'Nach Laufzeit') + '</span>';
    } else if (r.monthBudget != null) {
      budgetCell = window.fmtHours(r.monthBudget);
    }

    tr.innerHTML =
      '<td><a href="detail.html?id=' + r.client.id + '" class="client-link">' +
        escHtml(r.client.name) + '</a></td>' +
      '<td><span class="role-badge ' + roleCls + '">' + roleLabel + '</span></td>' +
      '<td class="num">' + budgetCell + '</td>' +
      '<td class="num">' + (r.outOfPeriod ? '—' : window.fmtHours(r.tracked) + bookBadge) + '</td>' +
      '<td class="num" style="' + remStyle + '">' + remText + '</td>' +
      '<td class="util-bar-cell" style="padding:8px 10px">' +
        '<div class="util-bar-wrap">' + progressHtml + '</div>' +
      '</td>';

    return tr;
  }

  // ── Boot ──────────────────────────────────────────────────────────────
  if (!window.isConfigured()) {
    setupHint.classList.remove('hidden');
  } else {
    init();
  }
})();
