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
      setTimeout(function () {
        localStorage.setItem('deductHolidays', deductHolidays.checked ? '1' : '0');
        loadData();
      }, 0);
    });
  }
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
      window.db.clients.list(),
    ]).then(function (results) {
      var employees   = results[0];
      var utilData    = results[1];
      var entriesData = results[2];
      var clientsData = results[3];

      if (!employees.length) {
        hideLoading();
        errorEl.innerHTML = '<div class="state-box"><div class="icon">👥</div><h3>Keine aktiven Mitarbeiter</h3><p>Lege zuerst <a href="employees.html">Mitarbeiter</a> an.</p></div>';
        return;
      }

      // Group util_hours by employee_id → month
      var empEntries = {};
      var empIntern  = {};
      utilData.forEach(function (u) {
        if (!empEntries[u.employee_id]) empEntries[u.employee_id] = {};
        empEntries[u.employee_id][u.month] = u.hours || 0;
        if (!empIntern[u.employee_id]) empIntern[u.employee_id] = {};
        empIntern[u.employee_id][u.month] = u.intern_hours || 0;
      });

      // Entries-based per-employee monthly totals (for forecast)
      var entriesPerEmp = {};
      entriesData.forEach(function (e) {
        if (!entriesPerEmp[e.employee_id]) entriesPerEmp[e.employee_id] = {};
        entriesPerEmp[e.employee_id][e.month] =
          (entriesPerEmp[e.employee_id][e.month] || 0) + (e.hours || 0);
      });

      // ── Client breakdown per employee per month (for modal) ──────────
      var clientMap = {};
      clientsData.forEach(function (c) { clientMap[c.id] = c; });

      var clientBreakdown = {}; // { empId: { month: { clientId: hours } } }
      entriesData.forEach(function (e) {
        if (!clientBreakdown[e.employee_id]) clientBreakdown[e.employee_id] = {};
        if (!clientBreakdown[e.employee_id][e.month]) clientBreakdown[e.employee_id][e.month] = {};
        var cid = e.client_id;
        clientBreakdown[e.employee_id][e.month][cid] =
          (clientBreakdown[e.employee_id][e.month][cid] || 0) + (e.hours || 0);
      });

      // Forecast: client budgets per employee per future month
      var forecastByEmp = {};
      var avgByEmp = {};
      employees.forEach(function (emp) {
        var monthMap = entriesPerEmp[emp.id] || {};
        var recent = [];
        for (var fm2 = ym.month; fm2 >= 1 && recent.length < 3; fm2--) {
          if (monthMap[fm2] > 0) recent.push(monthMap[fm2]);
        }
        if (recent.length > 0) {
          avgByEmp[emp.id] = recent.reduce(function (a, b) { return a + b; }, 0) / recent.length;
        }
      });

      if (year === ym.year && ym.month < 12) {
        for (var fm = ym.month + 1; fm <= 12; fm++) {
          employees.forEach(function (emp) {
            var budgetSum = 0;
            clientsData.forEach(function (c) {
              if (c.contract_start) {
                var cs = new Date(c.contract_start);
                var csY = cs.getUTCFullYear(), csM = cs.getUTCMonth() + 1;
                if (csY > year || (csY === year && fm < csM)) return;
              }
              if (c.is_project && c.project_end) {
                var pe = new Date(c.project_end);
                var peY = pe.getUTCFullYear(), peM = pe.getUTCMonth() + 1;
                if (year > peY || (year === peY && fm > peM)) return;
              }
              if (c.am_employee_id  === emp.id && c.am_budget)  budgetSum += c.am_budget;
              if (c.adv_employee_id === emp.id && c.adv_budget) budgetSum += c.adv_budget;
            });
            var clientHours = budgetSum > 0 ? budgetSum : (avgByEmp[emp.id] || 0);
            if (clientHours > 0) {
              if (!forecastByEmp[emp.id]) forecastByEmp[emp.id] = {};
              forecastByEmp[emp.id][fm] = Math.round(clientHours * 4) / 4;
            }
          });
        }
      }

      // Internal % from util_hours.intern_hours
      var internalPctByEmp = {};
      employees.forEach(function (emp) {
        internalPctByEmp[emp.id] = {};
        for (var mi = 1; mi <= 12; mi++) {
          var tot    = (empEntries[emp.id] || {})[mi] || 0;
          var intern = (empIntern[emp.id]  || {})[mi] || 0;
          if (tot > 0 && intern > 0) {
            internalPctByEmp[emp.id][mi] = Math.round(intern / tot * 100);
          }
        }
      });

      renderTable(employees, empEntries, forecastByEmp, internalPctByEmp,
                  available, netAvail, workDays, year, subtract, holidayDays,
                  clientBreakdown, clientMap);
      renderHolidayInfo(year);
      hideLoading();
      tableWrap.classList.remove('hidden');
      holidayInfo.classList.remove('hidden');
    }).catch(function (e) {
      showError('Fehler: ' + e.message);
    });
  }

  // ── Donut chart (pure SVG, no library) ───────────────────────────────
  function buildDonut(segments, size) {
    var R  = size / 2;
    var r  = R * 0.58;
    var cx = R, cy = R;
    var total = segments.reduce(function (s, x) { return s + x.value; }, 0);
    if (!total) return '<svg width="' + size + '" height="' + size + '"></svg>';

    // Single segment → full circle
    if (segments.length === 1) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="' + segments[0].color + '"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="var(--surface)"/>' +
        '</svg>';
    }

    var paths = '';
    var startAngle = -Math.PI / 2;

    segments.forEach(function (seg) {
      var sweep    = (seg.value / total) * Math.PI * 2;
      var endAngle = startAngle + sweep;
      var large    = sweep > Math.PI ? 1 : 0;

      var ox1 = cx + R * Math.cos(startAngle);
      var oy1 = cy + R * Math.sin(startAngle);
      var ox2 = cx + R * Math.cos(endAngle);
      var oy2 = cy + R * Math.sin(endAngle);
      var ix1 = cx + r * Math.cos(endAngle);
      var iy1 = cy + r * Math.sin(endAngle);
      var ix2 = cx + r * Math.cos(startAngle);
      var iy2 = cy + r * Math.sin(startAngle);

      var d = 'M ' + ox1.toFixed(2) + ' ' + oy1.toFixed(2) +
              ' A ' + R + ' ' + R + ' 0 ' + large + ' 1 ' + ox2.toFixed(2) + ' ' + oy2.toFixed(2) +
              ' L ' + ix1.toFixed(2) + ' ' + iy1.toFixed(2) +
              ' A ' + r + ' ' + r + ' 0 ' + large + ' 0 ' + ix2.toFixed(2) + ' ' + iy2.toFixed(2) +
              ' Z';

      paths += '<path d="' + d + '" fill="' + seg.color + '"/>';
      startAngle = endAngle;
    });

    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      paths + '</svg>';
  }

  // ── Month detail modal ────────────────────────────────────────────────
  var CHART_COLORS = [
    '#4f46e5','#10b981','#f59e0b','#06b6d4',
    '#ef4444','#8b5cf6','#ec4899','#84cc16',
    '#f97316','#14b8a6','#3b82f6','#a78bfa',
  ];

  function showMonthDetail(emp, month, year, clientBreakdown, clientMap, available) {
    var existing = document.getElementById('util-month-modal');
    if (existing) existing.remove();

    var monthName = window.MONTHS_DE[month - 1];
    var avail     = available[month] || 0;

    // Build breakdown array from stored { clientId: hours }
    var raw = (clientBreakdown[emp.id] || {})[month] || {};
    var segments = Object.keys(raw).map(function (cid) {
      return {
        name:  (clientMap[cid] || {}).name || 'Unbekannt',
        hours: raw[cid],
      };
    }).sort(function (a, b) { return b.hours - a.hours; });

    var totalHrs = segments.reduce(function (s, x) { return s + x.hours; }, 0);

    if (!segments.length) {
      // No client data — show simple notice
      segments = [];
    }

    segments.forEach(function (s, i) {
      s.color = CHART_COLORS[i % CHART_COLORS.length];
      s.pct   = totalHrs > 0 ? Math.round(s.hours / totalHrs * 100) : 0;
    });

    var utilPct = avail > 0 ? Math.round(totalHrs / avail * 100) : 0;
    var donutSvg = buildDonut(
      segments.map(function (s) { return { value: s.hours, color: s.color }; }),
      160
    );

    var listHtml = segments.length
      ? segments.map(function (s) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-light)">' +
            '<div style="width:10px;height:10px;border-radius:50%;background:' + s.color + ';flex-shrink:0"></div>' +
            '<div style="flex:1;font-size:13px;font-weight:500">' + s.name + '</div>' +
            '<div style="font-size:13px;font-variant-numeric:tabular-nums;font-weight:600">' + window.fmtHours(s.hours) + '</div>' +
            '<div style="font-size:12px;color:var(--text-muted);width:36px;text-align:right">' + s.pct + '%</div>' +
          '</div>';
        }).join('') +
        '<div style="display:flex;justify-content:space-between;padding-top:9px;font-size:13px">' +
          '<span style="font-weight:600;color:var(--text-muted)">Kundenstunden</span>' +
          '<span style="font-weight:700;font-variant-numeric:tabular-nums">' + window.fmtHours(totalHrs) + '</span>' +
        '</div>'
      : '<div style="text-align:center;padding:20px 0;color:var(--text-muted);font-size:13px">Keine Kundenstunden für diesen Monat</div>';

    var modal = document.createElement('div');
    modal.id = 'util-month-modal';
    modal.style.cssText =
      'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;' +
      'padding:20px;background:rgba(15,23,42,.45);backdrop-filter:blur(3px)';

    modal.innerHTML =
      '<div style="background:var(--surface);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.22);' +
              'width:100%;max-width:540px;max-height:90vh;overflow-y:auto">' +

        // Header
        '<div style="display:flex;align-items:center;justify-content:space-between;' +
                'padding:18px 20px;border-bottom:1px solid var(--border)">' +
          '<div>' +
            '<div style="font-size:16px;font-weight:700">' + emp.name + '</div>' +
            '<div style="font-size:12.5px;color:var(--text-secondary);margin-top:2px">' +
              monthName + ' ' + year +
              ' &nbsp;·&nbsp; ' + window.fmtHours(totalHrs) + ' von ' + window.fmtHours(avail) +
              ' &nbsp;·&nbsp; <strong style="color:' + (utilPct > 100 ? '#dc2626' : utilPct > 80 ? '#d97706' : '#059669') + '">' + utilPct + '%</strong> Auslastung' +
            '</div>' +
          '</div>' +
          '<button id="util-modal-close" style="border:none;background:var(--bg);color:var(--text-secondary);' +
                  'border-radius:6px;width:32px;height:32px;font-size:20px;cursor:pointer;' +
                  'display:flex;align-items:center;justify-content:center;line-height:1;flex-shrink:0">×</button>' +
        '</div>' +

        // Body
        '<div style="padding:20px;display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap">' +

          // Donut
          '<div style="position:relative;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
            donutSvg +
            '<div style="position:absolute;text-align:center;pointer-events:none;user-select:none">' +
              '<div style="font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.2">' +
                window.fmtHours(totalHrs) +
              '</div>' +
              '<div style="font-size:11px;color:var(--text-muted);margin-top:1px">' + utilPct + '%</div>' +
            '</div>' +
          '</div>' +

          // List
          '<div style="flex:1;min-width:200px">' + listHtml + '</div>' +

        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    document.getElementById('util-modal-close').addEventListener('click', function () {
      modal.remove();
    });
    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.remove();
    });
    function onKey(e) {
      if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); }
    }
    document.addEventListener('keydown', onKey);
  }

  // ── Render table ──────────────────────────────────────────────────────
  function renderTable(employees, empEntries, forecastByEmp, internalPctByEmp,
                       available, netAvail, workDays, year, subtract, holidayDays,
                       clientBreakdown, clientMap) {
    var ym = window.currentYearMonth();

    var teamFcastByMonth = {};
    for (var tfm = 1; tfm <= 12; tfm++) {
      teamFcastByMonth[tfm] = employees.reduce(function (sum, emp) {
        return sum + ((forecastByEmp[emp.id] || {})[tfm] || 0);
      }, 0);
    }

    // Info bar
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

    html += '<thead><tr>' +
      '<th style="min-width:160px;position:sticky;left:0;background:var(--bg);z-index:1">Mitarbeiter</th>' +
      '<th style="min-width:80px">Rolle</th>';
    window.MONTHS_DE.forEach(function (mn, i) {
      var m = i + 1;
      var isFuture = year > ym.year || (year === ym.year && m > ym.month);
      var hdNote = window.fmtHours(netAvail[m]);
      if (subtract && holidayDays[m]) hdNote += ' <span style="color:var(--text-muted)">-' + holidayDays[m] + 'FT</span>';
      html += '<th class="center util-bar-cell" style="min-width:90px' + (isFuture ? ';opacity:.6' : '') + '">' +
        mn.substring(0,3) +
        '<div style="font-size:9px;font-weight:400;color:var(--text-muted);margin-top:1px' + (isFuture ? ';font-style:italic' : '') + '">' + hdNote + '</div>' +
        '</th>';
    });
    html += '<th class="right" style="min-width:90px">Gesamt</th></tr></thead><tbody>';

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
          var fcastClient = (forecastByEmp[emp.id] || {})[m] || 0;
          var fcast = fcastClient ? Math.round((fcastClient + netAvail[m] * 0.15) * 4) / 4 : null;
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

        var net     = netAvail[m];
        var pctUsed = net > 0 ? (hrs / net) * 100 : 0;
        var fillCls = pctUsed > 100 ? 'high' : pctUsed > 80 ? 'medium' : 'low';
        var fillW   = Math.min(pctUsed, 100).toFixed(0);
        var intPct  = (internalPctByEmp[emp.id] || {})[m];

        // Clickable if there are hours tracked
        var hasData = hrs > 0;
        var clickAttrs = hasData
          ? ' data-emp-id="' + emp.id + '" data-month="' + m + '" class="center util-bar-cell util-month-clickable' + (pctUsed > 100 ? ' cell-over' : '') + '"'
          : ' class="center util-bar-cell' + (pctUsed > 100 ? ' cell-over' : '') + '"';

        cells += '<td' + clickAttrs + '>' +
          '<div class="util-bar-wrap">' +
            '<div style="font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;margin-bottom:2px">' +
              (hrs > 0 ? window.fmtHours(hrs) : '<span class="text-muted">—</span>') +
            '</div>' +
            (hrs > 0 ? '<div class="util-bar-track"><div class="util-bar-fill ' + fillCls + '" style="width:' + fillW + '%"></div></div>' : '') +
            (hrs > 0 ? '<div class="util-bar-label">' + Math.round(pctUsed) + '%</div>' : '') +
            (hrs > 0 && intPct !== undefined ? '<div style="font-size:9px;color:var(--text-muted);margin-top:1px">' + intPct + '% intern</div>' : '') +
            (hasData ? '<div style="font-size:9px;color:var(--primary);margin-top:3px;opacity:.7">▼ Details</div>' : '') +
          '</div>' +
        '</td>';
      });

      var empFcastMap = forecastByEmp[emp.id] || {};
      var projected = null;
      if (Object.keys(empFcastMap).length > 0) {
        var projSum = 0;
        for (var pm = ym.month + 1; pm <= 12; pm++) {
          var pmClient = empFcastMap[pm] || 0;
          if (pmClient > 0) projSum += pmClient + netAvail[pm] * 0.15;
        }
        if (projSum > 0) projected = total + Math.round(projSum * 4) / 4;
      }

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

    var hasForecast = Object.keys(forecastByEmp).length > 0;
    if (hasForecast) {
      html += '<div style="margin-top:10px;font-size:11px;color:var(--text-muted);padding:0 4px">' +
        '<span style="opacity:.5;font-style:italic">~ Prognose</span> · Summe Kundenbudgets (AM+ADV) + 15% der verfügbaren Stunden · gedimmte Zellen = Schätzwerte</div>';
    }

    tableWrap.innerHTML = html;

    // ── Event delegation for month-detail clicks ──────────────────────
    tableWrap.addEventListener('click', function (e) {
      var td = e.target.closest('td.util-month-clickable');
      if (!td) return;
      var empId = td.getAttribute('data-emp-id');
      var month = parseInt(td.getAttribute('data-month'), 10);
      var yr    = parseInt(yearSel.value);
      var emp   = employees.find(function (em) { return em.id === empId; });
      if (!emp) return;
      showMonthDetail(emp, month, yr, clientBreakdown, clientMap, available);
    });
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
