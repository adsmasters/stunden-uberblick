(function () {
  'use strict';

  var CALENDAR_ID  = 'c_ccc8810b3cb48e05f29dede0af9a2d9dd2c3f9ee8f39c4ae9945a761e7cd6d6b@group.calendar.google.com';
  var HOURS_PER_DAY = 8;

  var yearSel   = document.getElementById('yearSelect');
  var loadBtn   = document.getElementById('loadBtn');
  var loadingEl = document.getElementById('loading');
  var errorEl   = document.getElementById('error');
  var contentEl = document.getElementById('content');
  var setupHint = document.getElementById('setupHint');
  var calWarn   = document.getElementById('calWarn');

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

  // Returns { month: holidayWorkdayCount }
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

  // Soll hours for a given year/month (same formula as Auslastung)
  function getSollHours(year, month, holidayDays) {
    var effDays = getWorkDays(year, month) - (holidayDays[month] || 0);
    return effDays * HOURS_PER_DAY;
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

  // ── Calendar helpers ──────────────────────────────────────────────────

  // Count Mon–Fri days (UTC) of [startDate, endDate) that fall in year/month
  function countVacDaysInMonth(startDate, endDate, year, month) {
    var count = 0;
    var cur   = new Date(startDate.getTime());
    while (cur < endDate) {
      var dow = cur.getUTCDay();
      if (cur.getUTCFullYear() === year &&
          cur.getUTCMonth() + 1 === month &&
          dow >= 1 && dow <= 5) {
        count++;
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return count;
  }

  // Case-insensitive: does event summary contain any word (>2 chars) from employee name?
  function matchesEmployee(summary, empName) {
    if (!summary) return false;
    var sumLower = summary.toLowerCase();
    var words    = empName.toLowerCase().split(/\s+/).filter(function (w) { return w.length > 2; });
    return words.some(function (w) { return sumLower.indexOf(w) !== -1; });
  }

  // Fetch all-day events from Google Calendar for the given year
  function fetchCalendarEvents(year, apiKey) {
    var encodedId = encodeURIComponent(CALENDAR_ID);
    var url = 'https://www.googleapis.com/calendar/v3/calendars/' +
      encodedId + '/events' +
      '?key=' + encodeURIComponent(apiKey) +
      '&timeMin=' + year + '-01-01T00:00:00Z' +
      '&timeMax=' + (year + 1) + '-01-01T00:00:00Z' +
      '&singleEvents=true&maxResults=500';

    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('Google Calendar API – HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      // Keep only all-day events (have start.date, not start.dateTime)
      return (data.items || []).filter(function (e) {
        return e.start && e.start.date && !e.start.dateTime;
      });
    });
  }

  // Build vacation map: { empId: { month: days } }
  function buildVacMap(employees, events, year) {
    var map = {};
    employees.forEach(function (emp) {
      map[emp.id] = {};
      events.forEach(function (evt) {
        if (!matchesEmployee(evt.summary, emp.name)) return;
        // Google Calendar end date is exclusive
        var startDate = new Date(evt.start.date + 'T00:00:00Z');
        var endDate   = new Date(evt.end.date   + 'T00:00:00Z');
        for (var m = 1; m <= 12; m++) {
          var days = countVacDaysInMonth(startDate, endDate, year, m);
          if (days > 0) {
            map[emp.id][m] = (map[emp.id][m] || 0) + days;
          }
        }
      });
    });
    return map;
  }

  // ── State helpers ─────────────────────────────────────────────────────
  function showLoading() {
    loadingEl.innerHTML = '<div class="loading-bar"><div class="spinner"></div>Lade Daten…</div>';
    loadingEl.classList.remove('hidden');
    contentEl.innerHTML = '';
    errorEl.innerHTML   = '';
    calWarn.classList.add('hidden');
  }
  function hideLoading() { loadingEl.classList.add('hidden'); }
  function showError(msg) {
    errorEl.innerHTML = '<div class="alert alert-danger">⚠️ ' + msg + '</div>';
    loadingEl.classList.add('hidden');
  }

  // ── Load data ─────────────────────────────────────────────────────────
  function loadData() {
    showLoading();
    var year        = parseInt(yearSel.value, 10);
    var holidayDays = holidayWorkdaysByMonth(year);
    var apiKey      = localStorage.getItem('googleCalendarApiKey');

    // null result means "no key"; [] means "key present, fetch failed or no events"
    var calPromise = apiKey
      ? fetchCalendarEvents(year, apiKey).catch(function () { return []; })
      : Promise.resolve(null);

    Promise.all([
      window.db.employees.listActive(),
      window.db.utilHours.forYear(year),
      calPromise,
    ]).then(function (results) {
      var employees = results[0];
      var utilData  = results[1];
      var events    = results[2]; // null = no API key

      // Include all active employees except those explicitly excluded (monthly_target_hours === null)
      var targetEmps = employees.filter(function (e) {
        return e.monthly_target_hours != null && e.active === true;
      });

      // Show calendar warning when no API key
      if (!apiKey) {
        calWarn.classList.remove('hidden');
      }

      // Build util map: { empId: { month: hours } }
      var utilMap = {};
      utilData.forEach(function (u) {
        if (!utilMap[u.employee_id]) utilMap[u.employee_id] = {};
        utilMap[u.employee_id][u.month] = u.hours || 0;
      });

      // Build vacation map (empty if no calendar data)
      var vacMap = (events !== null && events.length > 0)
        ? buildVacMap(targetEmps, events, year)
        : {};

      hideLoading();
      renderContent(targetEmps, utilMap, vacMap, year, holidayDays);
    }).catch(function (e) {
      showError('Fehler beim Laden: ' + e.message);
    });
  }

  // ── Render ────────────────────────────────────────────────────────────
  function renderContent(employees, utilMap, vacMap, year, holidayDays) {
    var ym = window.currentYearMonth();
    var maxMonth = (year === ym.year) ? ym.month : 12;

    if (!employees.length) {
      contentEl.innerHTML =
        '<div class="state-box">' +
          '<div class="icon">👥</div>' +
          '<h3>Keine Mitarbeiter für Überstunden-Tracking</h3>' +
          '<p>Aktiviere das Tracking für <a href="employees.html">Mitarbeiter</a> indem du das Sollstunden-Feld setzt.</p>' +
        '</div>';
      return;
    }

    var html = '';

    employees.forEach(function (emp) {
      var empUtil = utilMap[emp.id] || {};
      var empVac  = vacMap[emp.id]  || {};

      var totalTracked = 0, totalTarget = 0, totalAdj = 0, totalOT = 0, totalVac = 0;
      var rowsHtml = '';

      for (var m = 1; m <= maxMonth; m++) {
        var tracked   = empUtil[m] || 0;
        var vacDays   = empVac[m]  || 0;
        var target    = getSollHours(year, m, holidayDays);
        var adjTarget = Math.max(0, target - vacDays * HOURS_PER_DAY);
        var overtime  = Math.max(0, tracked - adjTarget);

        totalTracked += tracked;
        totalTarget  += target;
        totalAdj     += adjTarget;
        totalOT      += overtime;
        totalVac     += vacDays;

        var isCurrent = (year === ym.year && m === ym.month);
        var rowCls    = isCurrent ? ' class="month-current"' : '';

        var vacCell = vacDays > 0
          ? '<td class="center" style="color:var(--primary);font-weight:500">' + vacDays + '</td>'
          : '<td class="center" style="color:var(--text-muted)">—</td>';

        var otCell = overtime > 0
          ? '<td class="right" style="color:#dc2626;font-weight:700">' + window.fmtHours(overtime) + '</td>'
          : '<td class="right" style="color:var(--text-muted)">—</td>';

        rowsHtml +=
          '<tr' + rowCls + '>' +
            '<td>' + window.MONTHS_DE[m - 1] + '</td>' +
            '<td class="right" style="font-variant-numeric:tabular-nums">' + window.fmtHours(target) + '</td>' +
            vacCell +
            '<td class="right" style="font-variant-numeric:tabular-nums">' + window.fmtHours(adjTarget) + '</td>' +
            '<td class="right" style="font-variant-numeric:tabular-nums">' +
              (tracked > 0 ? window.fmtHours(tracked) : '<span style="color:var(--text-muted)">—</span>') +
            '</td>' +
            otCell +
          '</tr>';
      }

      // Summary / total row
      var sumVacCell = totalVac > 0
        ? '<td class="center" style="color:var(--primary);font-weight:700">' + totalVac + '</td>'
        : '<td class="center" style="color:var(--text-muted)">—</td>';

      var sumOtCell = totalOT > 0
        ? '<td class="right" style="color:#dc2626;font-weight:700">' + window.fmtHours(totalOT) + '</td>'
        : '<td class="right" style="color:var(--text-muted)">—</td>';

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
              '<tbody>' +
                rowsHtml +
              '</tbody>' +
              '<tfoot>' +
                '<tr style="font-weight:700;border-top:2px solid var(--border)">' +
                  '<td>Gesamt</td>' +
                  '<td class="right" style="font-variant-numeric:tabular-nums">' + window.fmtHours(totalTarget) + '</td>' +
                  sumVacCell +
                  '<td class="right" style="font-variant-numeric:tabular-nums">' + window.fmtHours(totalAdj) + '</td>' +
                  '<td class="right" style="font-variant-numeric:tabular-nums">' +
                    (totalTracked > 0 ? window.fmtHours(totalTracked) : '—') +
                  '</td>' +
                  sumOtCell +
                '</tr>' +
              '</tfoot>' +
            '</table>' +
          '</div>' +
        '</div>';
    });

    contentEl.innerHTML = html;
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
