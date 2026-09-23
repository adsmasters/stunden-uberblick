(function () {
  'use strict';

  var HOURS_PER_DAY = 8;

  var yearSel   = document.getElementById('yearSelect');
  var loadBtn   = document.getElementById('loadBtn');
  var loadingEl = document.getElementById('loading');
  var errorEl   = document.getElementById('error');
  var contentEl = document.getElementById('content');
  var setupHint = document.getElementById('setupHint');

  // ── Working days (same logic as utilization.js) ───────────────────────
  function getWorkDays(year, month) {
    var count = 0;
    var days  = new Date(year, month, 0).getDate();
    for (var d = 1; d <= days; d++) {
      var dow = new Date(year, month - 1, d).getDay();
      if (dow >= 1 && dow <= 5) count++;
    }
    return count;
  }

  function getGermanHolidays(year) {
    var a = year%19, b = Math.floor(year/100), c = year%100;
    var d = Math.floor(b/4), e = b%4, f = Math.floor((b+8)/25);
    var g = Math.floor((b-f+1)/3), h = (19*a+b-d-g+15)%30;
    var i = Math.floor(c/4), k = c%4, l = (32+2*e+2*i-h-k)%7;
    var m = Math.floor((a+11*h+22*l)/451);
    var mo = Math.floor((h+l-7*m+114)/31);
    var dy = ((h+l-7*m+114)%31)+1;
    var E  = new Date(year, mo-1, dy);
    function add(dt, n) { var r = new Date(dt); r.setDate(r.getDate()+n); return r; }
    return [
      { date: new Date(year,0,1)   },
      { date: add(E,-2)            },
      { date: add(E,1)             },
      { date: new Date(year,4,1)   },
      { date: add(E,39)            },
      { date: add(E,50)            },
      { date: add(E,60)            },
      { date: new Date(year,9,3)   },
      { date: new Date(year,11,25) },
      { date: new Date(year,11,26) },
    ];
  }

  function holidayWorkdaysByMonth(year) {
    var counts = {};
    getGermanHolidays(year).forEach(function (h) {
      var dow = h.date.getDay();
      if (dow >= 1 && dow <= 5) {
        var m = h.date.getMonth() + 1;
        counts[m] = (counts[m] || 0) + 1;
      }
    });
    return counts;
  }

  function getSollHours(year, month, holidayDays) {
    var effDays = getWorkDays(year, month) - (holidayDays[month] || 0);
    return effDays * HOURS_PER_DAY;
  }

  // ── State ─────────────────────────────────────────────────────────────
  var currentYear      = null;
  var currentEmployees = [];
  var currentUtilMap   = {};
  var currentVacMap    = {};   // { empId: { month: days } } — in-memory, saved to DB on change
  var currentHolidays  = {};

  // ── Init year select ──────────────────────────────────────────────────
  (function () {
    var ym = window.currentYearMonth();
    for (var y = ym.year; y >= ym.year - 3; y--) {
      var o = document.createElement('option');
      o.value = y; o.textContent = y;
      yearSel.appendChild(o);
    }
  })();

  // ── State helpers ─────────────────────────────────────────────────────
  function showLoading() {
    loadingEl.innerHTML = '<div class="loading-bar"><div class="spinner"></div>Lade Daten…</div>';
    loadingEl.classList.remove('hidden');
    contentEl.innerHTML = '';
    errorEl.innerHTML   = '';
  }
  function hideLoading() { loadingEl.classList.add('hidden'); }
  function showError(msg) {
    errorEl.innerHTML = '<div class="alert alert-danger">⚠️ ' + msg + '</div>';
    loadingEl.classList.add('hidden');
  }

  // ── Load data ─────────────────────────────────────────────────────────
  function loadData() {
    showLoading();
    currentYear     = parseInt(yearSel.value, 10);
    currentHolidays = holidayWorkdaysByMonth(currentYear);

    Promise.all([
      window.db.employees.listActive(),
      window.db.utilHours.forYear(currentYear),
      window.db.absences.forYear(currentYear),
    ]).then(function (results) {
      var employees   = results[0];
      var utilData    = results[1];
      var absenceData = results[2];

      // Only employees opted-in (monthly_target_hours != null)
      currentEmployees = employees.filter(function (e) {
        return e.monthly_target_hours != null && e.active === true;
      });

      // Build util map: { empId: { month: hours } }
      currentUtilMap = {};
      utilData.forEach(function (u) {
        if (!currentUtilMap[u.employee_id]) currentUtilMap[u.employee_id] = {};
        currentUtilMap[u.employee_id][u.month] = u.hours || 0;
      });

      // Build vac map from DB: { empId: { month: vacationDays } }
      currentVacMap = {};
      absenceData.forEach(function (a) {
        if (!currentVacMap[a.employee_id]) currentVacMap[a.employee_id] = {};
        currentVacMap[a.employee_id][a.month] = a.vacation_days || 0;
      });

      hideLoading();
      renderContent();
    }).catch(function (e) {
      showError('Fehler beim Laden: ' + e.message);
    });
  }

  // ── Save vacation days for one cell ──────────────────────────────────
  function saveVacation(empId, month, days) {
    if (!currentVacMap[empId]) currentVacMap[empId] = {};
    currentVacMap[empId][month] = days;
    window.db.absences.upsert(empId, currentYear, month, days, 0)
      .catch(function () {
        // silently ignore — data stays in memory for the session
      });
    rerenderTotals(empId);
  }

  // ── Re-render just the totals row for one employee ────────────────────
  function rerenderTotals(empId) {
    var ym       = window.currentYearMonth();
    var maxMonth = (currentYear === ym.year) ? ym.month : 12;
    var empVac   = currentVacMap[empId] || {};
    var empUtil  = currentUtilMap[empId] || {};

    var totalTracked = 0, totalTarget = 0, totalAdj = 0, totalOT = 0, totalVac = 0;
    for (var m = 1; m <= maxMonth; m++) {
      var tracked   = empUtil[m]  || 0;
      var vacDays   = empVac[m]   || 0;
      var target    = getSollHours(currentYear, m, currentHolidays);
      var adjTarget = Math.max(0, target - vacDays * HOURS_PER_DAY);
      var overtime  = Math.max(0, tracked - adjTarget);
      totalTracked += tracked;
      totalTarget  += target;
      totalAdj     += adjTarget;
      totalOT      += overtime;
      totalVac     += vacDays;

      // Update overtime cell for this row
      var otCell = document.getElementById('ot-' + empId + '-' + m);
      if (otCell) {
        otCell.textContent = overtime > 0 ? window.fmtHours(overtime) : '—';
        otCell.style.color = overtime > 0 ? '#dc2626' : 'var(--text-muted)';
        otCell.style.fontWeight = overtime > 0 ? '700' : '';
      }
      // Update adjTarget cell
      var adjCell = document.getElementById('adj-' + empId + '-' + m);
      if (adjCell) {
        adjCell.textContent = window.fmtHours(adjTarget);
      }
    }

    var foot = document.getElementById('foot-' + empId);
    if (!foot) return;
    foot.cells[1].textContent = window.fmtHours(totalTarget);
    foot.cells[2].textContent = totalVac > 0 ? totalVac : '—';
    foot.cells[2].style.color = totalVac > 0 ? 'var(--primary)' : 'var(--text-muted)';
    foot.cells[3].textContent = window.fmtHours(totalAdj);
    foot.cells[4].textContent = totalTracked > 0 ? window.fmtHours(totalTracked) : '—';
    foot.cells[5].textContent = totalOT > 0 ? window.fmtHours(totalOT) : '—';
    foot.cells[5].style.color = totalOT > 0 ? '#dc2626' : 'var(--text-muted)';
    foot.cells[5].style.fontWeight = totalOT > 0 ? '700' : '';
  }

  // ── Render ────────────────────────────────────────────────────────────
  function renderContent() {
    var ym       = window.currentYearMonth();
    var maxMonth = (currentYear === ym.year) ? ym.month : 12;

    if (!currentEmployees.length) {
      contentEl.innerHTML =
        '<div class="state-box">' +
          '<div class="icon">👥</div>' +
          '<h3>Keine Mitarbeiter für Überstunden-Tracking</h3>' +
          '<p>Aktiviere das Tracking für <a href="employees.html">Mitarbeiter</a> indem du das Sollstunden-Feld setzt.</p>' +
        '</div>';
      return;
    }

    var html = '';

    currentEmployees.forEach(function (emp) {
      var empUtil = currentUtilMap[emp.id] || {};
      var empVac  = currentVacMap[emp.id]  || {};

      var totalTracked = 0, totalTarget = 0, totalAdj = 0, totalOT = 0, totalVac = 0;
      var rowsHtml = '';

      for (var m = 1; m <= maxMonth; m++) {
        var tracked   = empUtil[m] || 0;
        var vacDays   = empVac[m]  || 0;
        var target    = getSollHours(currentYear, m, currentHolidays);
        var adjTarget = Math.max(0, target - vacDays * HOURS_PER_DAY);
        var overtime  = Math.max(0, tracked - adjTarget);

        totalTracked += tracked;
        totalTarget  += target;
        totalAdj     += adjTarget;
        totalOT      += overtime;
        totalVac     += vacDays;

        var isCurrent = (currentYear === ym.year && m === ym.month);
        var rowCls    = isCurrent ? ' class="month-current"' : '';

        rowsHtml +=
          '<tr' + rowCls + '>' +
            '<td>' + window.MONTHS_DE[m - 1] + '</td>' +
            '<td class="right" style="font-variant-numeric:tabular-nums">' + window.fmtHours(target) + '</td>' +
            '<td class="center">' +
              '<input type="number" min="0" max="31" step="1"' +
                ' data-emp="' + emp.id + '" data-month="' + m + '"' +
                ' value="' + (vacDays || '') + '"' +
                ' placeholder="0"' +
                ' style="width:56px;text-align:center;padding:3px 6px;border:1px solid var(--border);' +
                         'border-radius:4px;font-size:13px;background:var(--surface)">' +
            '</td>' +
            '<td class="right" id="adj-' + emp.id + '-' + m + '" style="font-variant-numeric:tabular-nums">' + window.fmtHours(adjTarget) + '</td>' +
            '<td class="right" style="font-variant-numeric:tabular-nums">' +
              (tracked > 0 ? window.fmtHours(tracked) : '<span style="color:var(--text-muted)">—</span>') +
            '</td>' +
            '<td class="right" id="ot-' + emp.id + '-' + m + '"' +
              (overtime > 0 ? ' style="color:#dc2626;font-weight:700"' : ' style="color:var(--text-muted)"') + '>' +
              (overtime > 0 ? window.fmtHours(overtime) : '—') +
            '</td>' +
          '</tr>';
      }

      html +=
        '<div class="card" style="margin-bottom:20px">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;' +
               'padding-bottom:12px;border-bottom:1px solid var(--border)">' +
            '<span style="font-size:16px;font-weight:700">' + emp.name + '</span>' +
            '<span class="role-badge ' + window.getRoleCls(emp.role) + '">' +
              window.getRoleShort(emp.role) +
            '</span>' +
          '</div>' +
          '<div class="table-wrap">' +
            '<table>' +
              '<thead>' +
                '<tr>' +
                  '<th>Monat</th>' +
                  '<th class="right">Soll (h)</th>' +
                  '<th class="center">Urlaub (Tage)</th>' +
                  '<th class="right">Angepasstes Soll</th>' +
                  '<th class="right">Geleistet</th>' +
                  '<th class="right">Überstunden</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' + rowsHtml + '</tbody>' +
              '<tfoot>' +
                '<tr id="foot-' + emp.id + '" style="font-weight:700;border-top:2px solid var(--border)">' +
                  '<td>Gesamt</td>' +
                  '<td class="right" style="font-variant-numeric:tabular-nums">' + window.fmtHours(totalTarget) + '</td>' +
                  '<td class="center" style="color:' + (totalVac > 0 ? 'var(--primary)' : 'var(--text-muted)') + '">' +
                    (totalVac > 0 ? totalVac : '—') +
                  '</td>' +
                  '<td class="right" style="font-variant-numeric:tabular-nums">' + window.fmtHours(totalAdj) + '</td>' +
                  '<td class="right" style="font-variant-numeric:tabular-nums">' +
                    (totalTracked > 0 ? window.fmtHours(totalTracked) : '—') +
                  '</td>' +
                  '<td class="right"' +
                    (totalOT > 0 ? ' style="color:#dc2626;font-weight:700"' : ' style="color:var(--text-muted)"') + '>' +
                    (totalOT > 0 ? window.fmtHours(totalOT) : '—') +
                  '</td>' +
                '</tr>' +
              '</tfoot>' +
            '</table>' +
          '</div>' +
        '</div>';
    });

    contentEl.innerHTML = html;

    // Attach input listeners for vacation cells
    contentEl.querySelectorAll('input[data-emp]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var empId = inp.getAttribute('data-emp');
        var month = parseInt(inp.getAttribute('data-month'), 10);
        var days  = Math.max(0, parseInt(inp.value, 10) || 0);
        inp.value = days || '';
        saveVacation(empId, month, days);
      });
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────
  if (!window.isConfigured()) {
    setupHint.classList.remove('hidden');
  } else {
    window.settingsReady.then(function () {
      loadData();
    });
  }
  loadBtn.addEventListener('click', loadData);

})();
