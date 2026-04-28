(function () {
  'use strict';

  var yearSel     = document.getElementById('yearSelect');
  var internalPct = document.getElementById('internalPct');
  var loadBtn     = document.getElementById('loadBtn');
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
    internalPct.value = localStorage.getItem('internalPct') || '0';
  })();

  internalPct.addEventListener('change', function () {
    localStorage.setItem('internalPct', internalPct.value);
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
    var year = parseInt(yearSel.value);
    var pct  = parseFloat(internalPct.value) || 0;

    Promise.all([
      window.db.employees.listActive(),
      window.db.entries.forYear(year),
    ]).then(function (results) {
      var employees = results[0];
      var entries   = results[1];

      if (!employees.length) {
        hideLoading();
        errorEl.innerHTML = '<div class="state-box"><div class="icon">👥</div><h3>Keine aktiven Mitarbeiter</h3><p>Lege zuerst <a href="employees.html">Mitarbeiter</a> an.</p></div>';
        return;
      }

      // Group entries by employee_id → month
      var empEntries = {};
      entries.forEach(function (e) {
        if (!empEntries[e.employee_id]) empEntries[e.employee_id] = {};
        empEntries[e.employee_id][e.month] = (empEntries[e.employee_id][e.month] || 0) + (e.hours || 0);
      });

      // Available hours per month
      var available = {}, netAvail = {}, workDays = {};
      for (var m = 1; m <= 12; m++) {
        workDays[m]  = getWorkDays(year, m);
        available[m] = workDays[m] * 8;
        netAvail[m]  = available[m] * (1 - pct / 100);
      }

      renderTable(employees, empEntries, available, netAvail, workDays, year, pct);
      renderHolidayInfo(year);
      hideLoading();
      tableWrap.classList.remove('hidden');
      holidayInfo.classList.remove('hidden');
    }).catch(function (e) {
      showError('Fehler: ' + e.message);
    });
  }

  // ── Render table ──────────────────────────────────────────────────────
  function renderTable(employees, empEntries, available, netAvail, workDays, year, pct) {
    var ym = window.currentYearMonth();

    // Build info bar
    infoBar.innerHTML = '<div class="stats-row">' +
      window.MONTHS_DE.map(function (mn, i) {
        var m = i + 1;
        var isFuture = year > ym.year || (year === ym.year && m > ym.month);
        return '<div class="stat-card" style="padding:10px 14px">' +
          '<div class="label" style="font-size:10px">' + mn.substring(0,3) + '</div>' +
          '<div style="font-size:13px;font-weight:600;font-variant-numeric:tabular-nums">' +
            (isFuture ? '<span class="text-muted">—</span>' : window.fmtHours(netAvail[m])) +
          '</div>' +
          '<div style="font-size:10px;color:var(--text-muted)">' + workDays[m] + ' AT' +
            (pct > 0 ? ' · <span style="color:var(--warning)">' + pct + '% intern</span>' : '') +
          '</div>' +
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
      html += '<th class="center util-bar-cell" style="min-width:90px">' + mn.substring(0,3) +
        (isFuture ? '' : '<div style="font-size:9px;font-weight:400;color:var(--text-muted);margin-top:1px">' + window.fmtHours(netAvail[m]) + '</div>') +
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
          cells += '<td class="center util-bar-cell"><span class="text-muted" style="font-size:12px">—</span></td>';
          return;
        }

        var net = netAvail[m];
        var pctUsed = net > 0 ? (hrs / net) * 100 : 0;
        var fillCls = pctUsed > 100 ? 'high' : pctUsed > 80 ? 'medium' : 'low';
        var fillW   = Math.min(pctUsed, 100).toFixed(0);

        cells += '<td class="center util-bar-cell' +
          (pctUsed > 100 ? ' cell-over' : '') + '">' +
          '<div class="util-bar-wrap">' +
            '<div style="font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;margin-bottom:2px">' +
              (hrs > 0 ? window.fmtHours(hrs) : '<span class="text-muted">—</span>') +
            '</div>' +
            (hrs > 0 ? '<div class="util-bar-track"><div class="util-bar-fill ' + fillCls + '" style="width:' + fillW + '%"></div></div>' : '') +
            (hrs > 0 ? '<div class="util-bar-label">' + Math.round(pctUsed) + '%</div>' : '') +
          '</div>' +
        '</td>';
      });

      html += '<tr>' +
        '<td style="font-weight:500;position:sticky;left:0;background:var(--surface);z-index:1">' + emp.name + '</td>' +
        '<td><span class="role-badge ' + window.getRoleCls(emp.role) + '">' + window.getRoleShort(emp.role) + '</span></td>' +
        cells +
        '<td class="right" style="font-weight:600;font-variant-numeric:tabular-nums">' + (total > 0 ? window.fmtHours(total) : '—') + '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';
    tableWrap.innerHTML = html;
  }

  // ── Holiday info ──────────────────────────────────────────────────────
  function renderHolidayInfo(year) {
    var holidays = getGermanHolidays(year);
    var html = '<div class="card" style="padding:16px 20px">' +
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:10px">Bundesweite Feiertage ' + year + ' (nur Info – nicht als Abzug berechnet)</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px 20px">';
    var opts = { day: '2-digit', month: '2-digit' };
    holidays.forEach(function (h) {
      html += '<span style="font-size:12.5px;color:var(--text-secondary)">' +
        '<strong style="font-variant-numeric:tabular-nums">' + h.date.toLocaleDateString('de-DE', opts) + '</strong> ' + h.name + '</span>';
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
