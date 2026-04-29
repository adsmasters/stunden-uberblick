(function () {
  'use strict';

  var yearSel        = document.getElementById('yearSelect');
  var deductHolidays = document.getElementById('deductHolidays');
  var loadBtn        = document.getElementById('loadBtn');
  var tableWrap   = document.getElementById('tableWrap');
  var loadingEl   = document.getElementById('loading');
  var errorEl     = document.getElementById('error');
  var setupHint   = document.getElementById('setupHint');
  var infoBar     = document.getElementById('infoBar');
  var holidayInfo = document.getElementById('holidayInfo');

  // ── Init ──────────────────────────────────────────────────────────────
  (function () {
    var ym = window.currentYearMonth();
    for (var y = ym.year; y >= ym.year - 4; y--) {
      var o = document.createElement('option');
      o.value = y; o.textContent = y;
      yearSel.appendChild(o);
    }
    deductHolidays.checked = localStorage.getItem('deductHolidays') === '1';
  })();

  // Dashlane intercepts clicks on the checkbox itself — listen on label instead
  var deductHolidaysLabel = document.querySelector('label[for="deductHolidays"]');
  if (deductHolidaysLabel) {
    deductHolidaysLabel.addEventListener('click', function () {
      // Let the browser toggle checked state first, then reload
      setTimeout(function () {
        localStorage.setItem('deductHolidays', deductHolidays.checked ? '1' : '0');
        loadData();
      }, 0);
    });
  }
  // Fallback: also keep click on checkbox for browsers without extensions
  deductHolidays.addEventListener('click', function () {
    localStorage.setItem('deductHolidays', deductHolidays.checked ? '1' : '0');
    loadData();
  });

  // ── Working days calculation ──────────────────────────────────────────
  function getWorkDays(year, month) {
    var count = 0;
    var days  = new Date(year, month, 0).getDate();
    for (var d = 1; d <= days; d++) {
      var dow = new Date(year, month - 1, d).getDay();
      if (dow >= 1 && dow <= 5) count++;
    }
    return count;
  }

  // ── German public holidays ────────────────────────────────────────────
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
      { name:'Neujahr',                   date: new Date(year,0,1)  },
      { name:'Karfreitag',                date: add(E,-2)           },
      { name:'Ostermontag',               date: add(E,1)            },
      { name:'Tag der Arbeit',            date: new Date(year,4,1)  },
      { name:'Christi Himmelfahrt',       date: add(E,39)           },
      { name:'Pfingstmontag',             date: add(E,50)           },
      { name:'Tag der Deutschen Einheit', date: new Date(year,9,3)  },
      { name:'1. Weihnachtstag',          date: new Date(year,11,25)},
      { name:'2. Weihnachtstag',          date: new Date(year,11,26)},
    ];
  }

  function holidayCountByMonth(year) {
    var counts = {};
    getGermanHolidays(year).forEach(function (h) {
      var m = h.date.getMonth() + 1;
      counts[m] = (counts[m] || 0) + 1;
    });
    return counts;
  }

  // Count only holidays that fall on Mon–Fri (actual work-day deductions)
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

  // ── State helpers ─────────────────────────────────────────────────────
  function showLoading() {
    loadingEl.innerHTML = '<div class="loading-bar"><div class="spinner"></div>Lade Daten…</div>';
    loadingEl.classList.remove('hidden');
    tableWrap.classList.add('hidden');
    infoBar.classList.add('hidden');
    holidayInfo.classList.add('hidden');
    errorEl.innerHTML = '';
  }
  function hideLoading() { loadingEl.classList.add('hidden'); }
  function showError(msg) {
    errorEl.innerHTML = '<div class="alert alert-danger">⚠️ ' + msg + '</div>';
    loadingEl.classList.add('hidden');
  }

  // ── Load data ─────────────────────────────────────────────────────────
  function loadData() {
    showLoading();
    var ym          = window.currentYearMonth();
    var year        = parseInt(yearSel.value);
    var subtract    = deductHolidays.checked;
    var holidayDays = subtract ? holidayWorkdaysByMonth(year) : {};

    // Pre-compute available hours
    var available = {}, netAvail = {}, workDays = {};
    for (var m = 1; m <= 12; m++) {
      workDays[m]  = getWorkDays(year, m);
      var effDays  = workDays[m] - (holidayDays[m] || 0);
      available[m] = effDays * 8;
      netAvail[m]  = available[m];
    }

    Promise.all([
      window.db.employees.listActive(),
      window.db.utilHours.forYear(year),
      window.db.entries.forYear(year),
    ]).then(function (results) {
      var employees   = results[0];
      var utilData    = results[1];
      var entriesData = results[2];

      if (!employees.length) {
        hideLoading();
        errorEl.innerHTML = '<div class="state-box"><div class="icon">👥</div><h3>Keine aktiven Mitarbeiter</h3><p>Lege zuerst <a href="employees.html">Mitarbeiter</a> an.</p></div>';
        return;
      }

      // Group util_hours by employee_id → month (total incl. internal time)
      var empEntries = {};
      utilData.forEach(function (u) {
        if (!empEntries[u.employee_id]) empEntries[u.employee_id] = {};
        empEntries[u.employee_id][u.month] = u.hours || 0;
      });

      // ── Entries-based per-employee monthly totals (for forecast) ─────
      var entriesPerEmp = {};
      entriesData.forEach(function (e) {
        if (!entriesPerEmp[e.employee_id]) entriesPerEmp[e.employee_id] = {};
        entriesPerEmp[e.employee_id][e.month] =
          (entriesPerEmp[e.employee_id][e.month] || 0) + (e.hours || 0);
      });

      // ── Forecast: rolling 3-month average from client entries ─────────
      var forecastByEmp = {};
      if (year === ym.year && ym.month < 12) {
        employees.forEach(function (emp) {
          var monthMap = entriesPerEmp[emp.id] || {};
          var recent = [];
          for (var fm = ym.month; fm >= 1 && recent.length < 3; fm--) {
            if (monthMap[fm] > 0) recent.push(monthMap[fm]);
          }
          if (recent.length > 0) {
            var avg = recent.reduce(function (a, b) { return a + b; }, 0) / recent.length;
            // Store client-hours average; total forecast = avg / 0.85 (15% internal)
            forecastByEmp[emp.id] = Math.round((avg / 0.85) * 4) / 4;
          }
        });
      }

      // ── Internal % per employee per month (util_hours vs client entries) ─
      var internalPctByEmp = {};
      employees.forEach(function (emp) {
        internalPctByEmp[emp.id] = {};
        for (var mi = 1; mi <= 12; mi++) {
          var tot = (empEntries[emp.id] || {})[mi] || 0;
          var cli = (entriesPerEmp[emp.id] || {})[mi] || 0;
          if (tot > 0) {
            internalPctByEmp[emp.id][mi] = Math.round(Math.max(0, tot - cli) / tot * 100);
          }
        }
      });

      renderTable(employees, empEntries, forecastByEmp, internalPctByEmp, available, netAvail, workDays, year, subtract, holidayDays);
      renderHolidayInfo(year);
      hideLoading();
      tableWrap.classList.remove('hidden');
      holidayInfo.classList.remove('hidden');
    }).catch(function (e) {
      showError('Fehler: ' + e.message);
    });
  }

  // ── Render table ──────────────────────────────────────────────────────
  function renderTable(employees, empEntries, forecastByEmp, internalPctByEmp, available, netAvail, workDays, year, subtract, holidayDays) {
    var ym = window.currentYearMonth();

    // Pre-calculate team forecast total (sum of all employees)
    var teamFcast = employees.reduce(function (sum, emp) {
      return sum + (forecastByEmp[emp.id] || 0);
    }, 0);

    // Build info bar
    infoBar.innerHTML = '<div class="stats-row">' +
      window.MONTHS_DE.map(function (mn, i) {
        var m = i + 1;
        var isFuture = year > ym.year || (year === ym.year && m > ym.month);
        var dayLabel = subtract && holidayDays[m]
          ? (workDays[m] - holidayDays[m]) + ' AT <span style="color:var(--text-muted)">(-' + holidayDays[m] + ' FT)</span>'
          : workDays[m] + ' AT';
        return '<div class="stat-card" style="padding:10px 14px' + (isFuture ? ';opacity:.6' : '') + '">' +
          '<div class="label" style="font-size:10px">' + mn.substring(0,3) + '</div>' +
          '<div style="font-size:13px;font-weight:600;font-variant-numeric:tabular-nums' + (isFuture ? ';font-style:italic' : '') + '">' +
            window.fmtHours(netAvail[m]) +
          '</div>' +
          '<div style="font-size:10px;color:var(--text-muted)">' + dayLabel + '</div>' +
        '</div>';
      }).join('') +
    '</div>';
    infoBar.classList.remove('hidden');

    // Table
    var html = '<div class="table-wrap"><table>';

    // Header
    html += '<thead><tr>' +
      '<th style="min-width:160px;position:sticky;left:0;background:var(--bg);z-index:1">Mitarbeiter</th>' +
      '<th style="min-width:80px">Rolle</th>';
    window.MONTHS_DE.forEach(function (mn, i) {
      var m = i + 1;
      var isFuture = year > ym.year || (year === ym.year && m > ym.month);
      var hdNote = window.fmtHours(netAvail[m]);
      if (subtract && holidayDays[m]) hdNote += ' <span style="color:var(--text-muted)">-' + holidayDays[m] + 'FT</span>';
      html += '<th class="center util-bar-cell" style="min-width:90px' + (isFuture ? ';opacity:.6' : '') + '">' + mn.substring(0,3) +
        '<div style="font-size:9px;font-weight:400;color:var(--text-muted);margin-top:1px' + (isFuture ? ';font-style:italic' : '') + '">' + hdNote + '</div>' +
        '</th>';
    });
    html += '<th class="right" style="min-width:90px">Gesamt</th></tr></thead><tbody>';

    // Employee rows
    employees.forEach(function (emp) {
      var monthMap = empEntries[emp.id] || {};
      var total = 0;
      var cells = '';

      window.MONTHS_DE.forEach(function (mn, i) {
        var m = i + 1;
        var isFuture = year > ym.year || (year === ym.year && m > ym.month);
        var hrs = monthMap[m] || 0;
        total += hrs;

        if (isFuture) {
          var fcast = forecastByEmp[emp.id];
          if (fcast) {
            var fnet = netAvail[m];
            var fPct = fnet > 0 ? (fcast / fnet) * 100 : 0;
            var fCls = fPct > 100 ? 'high' : fPct > 80 ? 'medium' : 'low';
            var fW   = Math.min(fPct, 100).toFixed(0);
            cells += '<td class="center util-bar-cell" style="opacity:.5">' +
              '<div class="util-bar-wrap">' +
                '<div style="font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;margin-bottom:2px;font-style:italic">~' + window.fmtHours(fcast) + '</div>' +
                '<div class="util-bar-track"><div class="util-bar-fill ' + fCls + '" style="width:' + fW + '%;background-image:repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(255,255,255,.35) 3px,rgba(255,255,255,.35) 6px)"></div></div>' +
                '<div class="util-bar-label" style="font-style:italic">~' + Math.round(fPct) + '%</div>' +
                '<div style="font-size:9px;color:var(--text-muted);font-style:italic;margin-top:1px">15% intern</div>' +
              '</div>' +
            '</td>';
          } else {
            cells += '<td class="center util-bar-cell"><span class="text-muted" style="font-size:12px">—</span></td>';
          }
          return;
        }

        var net = netAvail[m];
        var pctUsed = net > 0 ? (hrs / net) * 100 : 0;
        var fillCls = pctUsed > 100 ? 'high' : pctUsed > 80 ? 'medium' : 'low';
        var fillW   = Math.min(pctUsed, 100).toFixed(0);
        var intPct  = (internalPctByEmp[emp.id] || {})[m];

        cells += '<td class="center util-bar-cell' +
          (pctUsed > 100 ? ' cell-over' : '') + '">' +
          '<div class="util-bar-wrap">' +
            '<div style="font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;margin-bottom:2px">' +
              (hrs > 0 ? window.fmtHours(hrs) : '<span class="text-muted">—</span>') +
            '</div>' +
            (hrs > 0 ? '<div class="util-bar-track"><div class="util-bar-fill ' + fillCls + '" style="width:' + fillW + '%"></div></div>' : '') +
            (hrs > 0 ? '<div class="util-bar-label">' + Math.round(pctUsed) + '%</div>' : '') +
            (hrs > 0 && intPct !== undefined ? '<div style="font-size:9px;color:var(--text-muted);margin-top:1px">' + intPct + '% intern</div>' : '') +
          '</div>' +
        '</td>';
      });

      // Jahresprognose: actual + (remaining months × forecast)
      var fcast = forecastByEmp[emp.id];
      var remainingMonths = year === ym.year ? 12 - ym.month : 0;
      var projected = fcast ? total + fcast * remainingMonths : null;

      html += '<tr>' +
        '<td style="font-weight:500;position:sticky;left:0;background:var(--surface);z-index:1">' + emp.name + '</td>' +
        '<td><span class="role-badge ' + window.getRoleCls(emp.role) + '">' + window.getRoleShort(emp.role) + '</span></td>' +
        cells +
        '<td class="right" style="font-variant-numeric:tabular-nums">' +
          '<div style="font-weight:600">' + (total > 0 ? window.fmtHours(total) : '—') + '</div>' +
          (projected ? '<div style="font-size:11px;color:var(--text-muted);font-style:italic;margin-top:2px">~' + window.fmtHours(projected) + ' Prog.</div>' : '') +
        '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';

    // Legend (only when forecast is shown)
    var hasForecast = Object.keys(forecastByEmp).length > 0;
    if (hasForecast) {
      html += '<div style="margin-top:10px;font-size:11px;color:var(--text-muted);padding:0 4px">' +
        '<span style="opacity:.5;font-style:italic">~ Prognose</span> · Ø letzte 3 Monate (Kundenstunden) + 15% interne Zeit · gedimmte Zellen = Schätzwerte</div>';
    }

    tableWrap.innerHTML = html;
  }

  // ── Holiday info ──────────────────────────────────────────────────────
  function renderHolidayInfo(year) {
    var holidays  = getGermanHolidays(year);
    var deducting = deductHolidays.checked;
    var label = deducting
      ? 'Bundesweite Feiertage ' + year + ' – werden als Abzug berechnet (nur Mo–Fr)'
      : 'Bundesweite Feiertage ' + year + ' (nur Info – nicht als Abzug berechnet)';
    var html = '<div class="card" style="padding:16px 20px">' +
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:10px">' + label + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px 20px">';
    var opts = { day: '2-digit', month: '2-digit' };
    holidays.forEach(function (h) {
      var dow = h.date.getDay();
      var isWeekend = dow === 0 || dow === 6;
      var dimmed = deducting && isWeekend ? ';opacity:.45' : '';
      html += '<span style="font-size:12.5px;color:var(--text-secondary)' + dimmed + '">' +
        '<strong style="font-variant-numeric:tabular-nums">' + h.date.toLocaleDateString('de-DE', opts) + '</strong> ' + h.name +
        (isWeekend ? ' <span style="font-size:10px;color:var(--text-muted)">(WE)</span>' : '') +
        '</span>';
    });
    html += '</div></div>';
    holidayInfo.innerHTML = html;
  }

  // ── Boot ──────────────────────────────────────────────────────────────
  if (!window.isConfigured()) {
    setupHint.classList.remove('hidden');
  } else {
    loadData();
  }
  loadBtn.addEventListener('click', loadData);
})();
