(function () {
  'use strict';

  var HOURS_PER_DAY = 8;

  var yearSel   = document.getElementById('yearSelect');
  var empSel    = document.getElementById('empSelect');
  var loadBtn   = document.getElementById('loadBtn');
  var loadingEl = document.getElementById('loading');
  var errorEl   = document.getElementById('error');
  var summaryEl = document.getElementById('summary');
  var contentEl = document.getElementById('content');
  var setupHint = document.getElementById('setupHint');

  // ── Working days (same as utilization.js) ────────────────────────────
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
    return (getWorkDays(year, month) - (holidayDays[month] || 0)) * HOURS_PER_DAY;
  }

  // ── State ─────────────────────────────────────────────────────────────
  var allEmployees    = [];
  var vacEntitlements = {}; // key: "vac_ent_{empId}_{year}" → days
  var abbauMap        = {}; // key: "ot_abbau_{empId}_{year}_{month}" → hours
  var currentYear     = null;
  var currentHolidays = {};
  var utilMap         = {}; // { empId: { month: hours } }
  var vacMap          = {}; // { empId: { month: days } }

  function entKey(empId, year)         { return 'vac_ent_' + empId + '_' + year; }
  function abbauKey(empId, year, month) { return 'ot_abbau_' + empId + '_' + year + '_' + month; }

  function getAbbau(empId, month) {
    return abbauMap[abbauKey(empId, currentYear, month)] || 0;
  }
  function setAbbau(empId, month, hours) {
    var k = abbauKey(empId, currentYear, month);
    abbauMap[k] = hours;
    try { localStorage.setItem(k, String(hours)); } catch (e) {}
  }

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
    summaryEl.classList.add('hidden');
    contentEl.innerHTML = '';
    errorEl.innerHTML   = '';
  }
  function hideLoading() { loadingEl.classList.add('hidden'); }
  function showError(msg) {
    errorEl.innerHTML = '<div class="alert alert-danger">⚠️ ' + msg + '</div>';
    loadingEl.classList.add('hidden');
  }

  // ── Populate employee dropdown ─────────────────────────────────────────
  function populateDropdown(employees) {
    while (empSel.options.length > 1) empSel.remove(1);
    employees.forEach(function (emp) {
      var o = document.createElement('option');
      o.value = emp.id;
      o.textContent = emp.name;
      empSel.appendChild(o);
    });
    // no auto-select — user picks an employee
  }

  // ── Load data ─────────────────────────────────────────────────────────
  function loadData() {
    if (!empSel.value) return;
    showLoading();
    currentYear     = parseInt(yearSel.value, 10);
    currentHolidays = holidayWorkdaysByMonth(currentYear);

    Promise.all([
      window.db.utilHours.forYear(currentYear).catch(function () { return []; }),
      window.db.absences.forYear(currentYear).catch(function () { return []; }),
    ]).then(function (results) {
      utilMap = {};
      results[0].forEach(function (u) {
        if (!utilMap[u.employee_id]) utilMap[u.employee_id] = {};
        utilMap[u.employee_id][u.month] = u.hours || 0;
      });

      vacMap = {};
      results[1].forEach(function (a) {
        if (!vacMap[a.employee_id]) vacMap[a.employee_id] = {};
        vacMap[a.employee_id][a.month] = a.vacation_days || 0;
      });

      hideLoading();
      render();
    }).catch(function (e) {
      showError('Fehler beim Laden: ' + e.message);
    });
  }

  // ── Save vacation days (per month) ────────────────────────────────────
  function saveVacation(empId, month, days) {
    if (!vacMap[empId]) vacMap[empId] = {};
    vacMap[empId][month] = days;
    window.db.absences.upsert(empId, currentYear, month, days, 0).catch(function () {});
    rerenderDynamic(empId);
  }

  // ── Save vacation entitlement (per year) ──────────────────────────────
  function saveEntitlement(empId, year, days) {
    var key = entKey(empId, year);
    vacEntitlements[key] = days;
    try { localStorage.setItem('ot_' + key, String(days)); } catch (e) {}
    rerenderDynamic(empId);
  }

  // ── Re-render dynamic cells without full redraw ───────────────────────
  function rerenderDynamic(empId) {
    var ym       = window.currentYearMonth();
    var maxMonth = (currentYear === ym.year) ? ym.month : 12;
    var empVac   = vacMap[empId]  || {};
    var empUtil  = utilMap[empId] || {};

    var totalVac = 0, totalOT = 0, totalAdj = 0, totalTarget = 0, totalTracked = 0;

    var totalAbbau = 0;

    for (var m = 1; m <= maxMonth; m++) {
      var tracked   = empUtil[m] || 0;
      var vacDays   = empVac[m]  || 0;
      var abbau     = getAbbau(empId, m);
      var target    = getSollHours(currentYear, m, currentHolidays);
      var adjTarget = Math.max(0, target - vacDays * HOURS_PER_DAY);
      var overtime  = Math.max(0, tracked - adjTarget);

      totalTracked += tracked;
      totalTarget  += target;
      totalAdj     += adjTarget;
      totalOT      += overtime;
      totalVac     += vacDays;
      totalAbbau   += abbau;

      var adjCell = document.getElementById('adj-' + m);
      if (adjCell) adjCell.textContent = window.fmtHours(adjTarget);

      var otCell = document.getElementById('ot-' + m);
      if (otCell) {
        otCell.textContent      = overtime > 0 ? window.fmtHours(overtime) : '—';
        otCell.style.color      = overtime > 0 ? '#dc2626' : 'var(--text-muted)';
        otCell.style.fontWeight = overtime > 0 ? '700' : '';
      }

      var saldo = overtime - abbau;
      var saldoCell = document.getElementById('saldo-' + m);
      if (saldoCell) {
        saldoCell.textContent     = saldo > 0 ? window.fmtHours(saldo) : saldo < 0 ? '-' + window.fmtHours(-saldo) : '—';
        saldoCell.style.color     = saldo > 0 ? '#dc2626' : saldo < 0 ? '#16a34a' : 'var(--text-muted)';
        saldoCell.style.fontWeight = saldo !== 0 ? '700' : '';
      }
    }

    var netOT = totalOT - totalAbbau;

    // Update footer
    var foot = document.getElementById('tfoot-row');
    if (foot) {
      foot.cells[1].textContent = window.fmtHours(totalTarget);
      foot.cells[2].textContent     = totalVac > 0 ? totalVac : '—';
      foot.cells[2].style.color     = totalVac > 0 ? 'var(--primary)' : 'var(--text-muted)';
      foot.cells[2].style.textAlign = 'right';
      foot.cells[3].textContent = window.fmtHours(totalAdj);
      foot.cells[4].textContent     = totalOT > 0 ? window.fmtHours(totalOT) : '—';
      foot.cells[4].style.color     = totalOT > 0 ? '#dc2626' : 'var(--text-muted)';
      foot.cells[4].style.fontWeight = totalOT > 0 ? '700' : '';
      foot.cells[5].textContent     = totalAbbau > 0 ? window.fmtHours(totalAbbau) : '—';
      foot.cells[5].style.color     = totalAbbau > 0 ? 'var(--primary)' : 'var(--text-muted)';
      foot.cells[6].textContent     = netOT > 0 ? window.fmtHours(netOT) : (netOT < 0 ? '-' + window.fmtHours(-netOT) : '—');
      foot.cells[6].style.color     = netOT > 0 ? '#dc2626' : (netOT < 0 ? '#16a34a' : 'var(--text-muted)');
      foot.cells[6].style.fontWeight = netOT !== 0 ? '700' : '';
    }

    // Update summary bar
    var entitlement = vacEntitlements[entKey(empId, currentYear)];
    if (entitlement == null) {
      var emp = allEmployees.find(function (e) { return e.id === empId; });
      if (emp && emp.monthly_target_hours != null) entitlement = emp.monthly_target_hours;
    }
    renderSummary(empId, totalVac, entitlement);
  }

  // ── Render vacation summary bar ───────────────────────────────────────
  function renderSummary(empId, usedDays, entitlement) {
    var remaining = entitlement != null ? entitlement - usedDays : null;
    var remColor  = remaining != null && remaining < 0 ? '#dc2626' : 'var(--success, #16a34a)';

    summaryEl.innerHTML =
      '<div class="card" style="padding:16px 20px">' +
        '<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">' +
          '<div style="font-size:13px;color:var(--text-secondary);font-weight:500">Urlaubsanspruch ' + currentYear + '</div>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<input type="number" id="entitlementInput" min="0" max="60" step="1"' +
              ' value="' + (entitlement != null ? entitlement : '') + '"' +
              ' placeholder="—"' +
              ' data-emp="' + empId + '"' +
              ' style="width:60px;text-align:center;padding:4px 8px;border:1px solid var(--border);' +
                       'border-radius:6px;font-size:14px;font-weight:600;background:var(--surface)">' +
            '<span style="font-size:13px;color:var(--text-muted)">Tage gesamt</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<span style="font-size:22px;font-weight:700;color:var(--primary)">' + usedDays + '</span>' +
            '<span style="font-size:13px;color:var(--text-muted)">Tage genommen</span>' +
          '</div>' +
          (remaining != null
            ? '<div style="display:flex;align-items:center;gap:6px">' +
                '<span style="font-size:22px;font-weight:700;color:' + remColor + '">' + remaining + '</span>' +
                '<span style="font-size:13px;color:var(--text-muted)">Tage verbleibend</span>' +
              '</div>'
            : '') +
        '</div>' +
      '</div>';

    var entInput = document.getElementById('entitlementInput');
    if (entInput) {
      entInput.addEventListener('change', function () {
        var days = Math.max(0, parseInt(entInput.value, 10) || 0);
        entInput.value = days || '';
        saveEntitlement(entInput.getAttribute('data-emp'), currentYear, days);
      });
    }

    summaryEl.classList.remove('hidden');
  }

  // ── Main render ───────────────────────────────────────────────────────
  function render() {
    var empId = empSel.value;
    if (!empId) {
      contentEl.innerHTML = '';
      summaryEl.classList.add('hidden');
      return;
    }

    var emp = allEmployees.find(function (e) { return e.id === empId; });
    if (!emp) return;

    var ym       = window.currentYearMonth();
    var maxMonth = (currentYear === ym.year) ? ym.month : 12;
    var empUtil  = utilMap[empId]  || {};
    var empVac   = vacMap[empId]   || {};

    var totalTracked = 0, totalTarget = 0, totalAdj = 0, totalOT = 0, totalVac = 0, totalAbbau = 0;
    var rowsHtml = '';

    for (var m = 1; m <= maxMonth; m++) {
      var tracked   = empUtil[m] || 0;
      var vacDays   = empVac[m]  || 0;
      var abbau     = getAbbau(empId, m);
      var target    = getSollHours(currentYear, m, currentHolidays);
      var adjTarget = Math.max(0, target - vacDays * HOURS_PER_DAY);
      var overtime  = Math.max(0, tracked - adjTarget);
      var saldo     = overtime - abbau;

      totalTracked += tracked;
      totalTarget  += target;
      totalAdj     += adjTarget;
      totalOT      += overtime;
      totalVac     += vacDays;
      totalAbbau   += abbau;

      var isCurrent = (currentYear === ym.year && m === ym.month);
      var rowCls    = isCurrent ? ' class="month-current"' : '';

      var inputStyle = 'width:52px;text-align:center;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:13px;background:var(--surface)';

      rowsHtml +=
        '<tr' + rowCls + '>' +
          '<td>' + window.MONTHS_DE[m - 1] + '</td>' +
          '<td class="right" style="color:var(--text-secondary)">' + window.fmtHours(target) + '</td>' +
          '<td class="center">' +
            '<input type="number" min="0" max="31" step="1" data-type="vac"' +
              ' data-month="' + m + '" data-emp="' + empId + '"' +
              ' value="' + (vacDays || '') + '" placeholder="—" style="' + inputStyle + '">' +
          '</td>' +
          '<td class="right" id="adj-' + m + '" style="color:var(--text-secondary)">' + window.fmtHours(adjTarget) + '</td>' +
          '<td class="right" id="ot-' + m + '"' +
            (overtime > 0
              ? ' style="color:#dc2626;font-weight:700">' + window.fmtHours(overtime)
              : ' style="color:var(--text-muted)">—') +
          '</td>' +
          '<td class="center">' +
            '<input type="number" min="0" step="0.25" data-type="abbau"' +
              ' data-month="' + m + '" data-emp="' + empId + '"' +
              ' value="' + (abbau || '') + '" placeholder="—" style="' + inputStyle + '">' +
          '</td>' +
          '<td class="right" id="saldo-' + m + '"' +
            (saldo > 0
              ? ' style="color:#dc2626;font-weight:700">' + window.fmtHours(saldo)
              : saldo < 0
                ? ' style="color:#16a34a;font-weight:700">-' + window.fmtHours(-saldo)
                : ' style="color:var(--text-muted)">—') +
          '</td>' +
        '</tr>';
    }

    var netOT = totalOT - totalAbbau;

    contentEl.innerHTML =
      '<div class="card">' +
        '<div class="table-wrap">' +
          '<table style="table-layout:fixed;width:100%;min-width:710px">' +
            '<thead>' +
              '<tr>' +
                '<th style="width:110px">Monat</th>' +
                '<th class="right" style="width:110px">Soll (h)</th>' +
                '<th class="center" style="width:110px">Urlaub (Tage)</th>' +
                '<th class="right" style="width:140px">Angepasstes Soll</th>' +
                '<th class="right" style="width:110px">Überstunden</th>' +
                '<th class="center" style="width:100px">Abbau (h)</th>' +
                '<th class="right" style="width:100px">Saldo</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
            '<tfoot>' +
              '<tr id="tfoot-row" style="font-weight:700;border-top:2px solid var(--border)">' +
                '<td>Gesamt</td>' +
                '<td class="right">' + window.fmtHours(totalTarget) + '</td>' +
                '<td class="right" style="color:' + (totalVac > 0 ? 'var(--primary)' : 'var(--text-muted)') + '">' +
                  (totalVac > 0 ? totalVac : '—') +
                '</td>' +
                '<td class="right">' + window.fmtHours(totalAdj) + '</td>' +
                '<td class="right"' + (totalOT > 0 ? ' style="color:#dc2626">' + window.fmtHours(totalOT) : ' style="color:var(--text-muted)">—') + '</td>' +
                '<td class="right" style="color:' + (totalAbbau > 0 ? 'var(--primary)' : 'var(--text-muted)') + '">' +
                  (totalAbbau > 0 ? window.fmtHours(totalAbbau) : '—') +
                '</td>' +
                '<td class="right"' +
                  (netOT > 0
                    ? ' style="color:#dc2626;font-weight:700">' + window.fmtHours(netOT)
                    : netOT < 0
                      ? ' style="color:#16a34a;font-weight:700">-' + window.fmtHours(-netOT)
                      : ' style="color:var(--text-muted)">—') +
                '</td>' +
              '</tr>' +
            '</tfoot>' +
          '</table>' +
        '</div>' +
      '</div>';

    // Input listeners
    contentEl.querySelectorAll('input[data-type]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var type  = inp.getAttribute('data-type');
        var empId = inp.getAttribute('data-emp');
        var month = parseInt(inp.getAttribute('data-month'), 10);
        if (type === 'vac') {
          var days = Math.max(0, parseInt(inp.value, 10) || 0);
          inp.value = days || '';
          saveVacation(empId, month, days);
        } else {
          var hours = Math.max(0, parseFloat(inp.value) || 0);
          inp.value = hours || '';
          setAbbau(empId, month, hours);
          rerenderDynamic(empId);
        }
      });
    });

    // Render summary bar
    var entitlement = vacEntitlements[entKey(empId, currentYear)];
    if (entitlement == null && emp.monthly_target_hours != null) {
      entitlement = emp.monthly_target_hours;
    }
    renderSummary(empId, totalVac, entitlement);
  }

  // ── Boot ──────────────────────────────────────────────────────────────
  if (!window.isConfigured()) {
    setupHint.classList.remove('hidden');
  } else {
    window.settingsReady.then(function () {
      window.db.employees.listActive().catch(function () { return []; }).then(function (employees) {
        allEmployees = employees.filter(function (e) {
          return e.monthly_target_hours != null && e.active !== false;
        });

        // Load entitlements + abbau from localStorage
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var lsKey = localStorage.key(i);
            if (!lsKey) continue;
            if (lsKey.indexOf('ot_vac_ent_') === 0) {
              vacEntitlements[lsKey.slice(3)] = parseInt(localStorage.getItem(lsKey), 10) || 0;
            } else if (lsKey.indexOf('ot_abbau_') === 0) {
              abbauMap[lsKey] = parseFloat(localStorage.getItem(lsKey)) || 0;
            }
          }
        } catch (e) {}

        populateDropdown(allEmployees);

        if (allEmployees.length === 0) {
          contentEl.innerHTML =
            '<div class="state-box">' +
              '<div class="icon">👥</div>' +
              '<h3>Keine Mitarbeiter für Überstunden-Tracking</h3>' +
              '<p>Setze bei <a href="employees.html">Mitarbeitern</a> das Feld "Urlaubsanspruch", um sie hier einzuschließen.</p>' +
            '</div>';
        }
      }).catch(function (e) {
        showError('Fehler beim Laden: ' + e.message);
      });
    });
  }

  loadBtn.addEventListener('click', loadData);
  empSel.addEventListener('change', function () {
    if (utilMap && Object.keys(utilMap).length > 0) render();
    else loadData();
  });
  yearSel.addEventListener('change', loadData);

})();
