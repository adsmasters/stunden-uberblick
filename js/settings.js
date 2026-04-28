(function () {
  'use strict';

  var urlInput   = document.getElementById('supabaseUrl');
  var keyInput   = document.getElementById('supabaseKey');
  var saveBtn    = document.getElementById('saveBtn');
  var saveStatus = document.getElementById('saveStatus');
  var connStatus = document.getElementById('connStatus');
  var copyBtn    = document.getElementById('copySQL');
  var sqlBlock   = document.getElementById('sqlBlock');

  // Pre-fill saved values
  urlInput.value = localStorage.getItem('supabaseUrl') || '';
  keyInput.value = localStorage.getItem('supabaseKey') || '';

  if (window.isConfigured()) {
    connStatus.innerHTML = '<span class="badge badge-ok">✓ Verbunden</span>';
  }

  function setStatus(msg, type) {
    saveStatus.textContent = msg;
    saveStatus.style.color =
      type === 'success' ? 'var(--success)' :
      type === 'error'   ? 'var(--danger)'  :
      type === 'warn'    ? 'var(--warning)' : 'var(--text-secondary)';
  }

  saveBtn.addEventListener('click', function () {
    var url = urlInput.value.trim();
    var key = keyInput.value.trim();

    if (!url || !key) {
      setStatus('Bitte URL und Key eingeben.', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Teste Verbindung…';
    setStatus('', '');

    window.configure(url, key);

    window.db.clients.list()
      .then(function () {
        setStatus('Verbindung erfolgreich ✓', 'success');
        connStatus.innerHTML = '<span class="badge badge-ok">✓ Verbunden</span>';
      })
      .catch(function (e) {
        var msg = e.message || '';
        if (msg.includes('relation') || msg.includes('does not exist')) {
          setStatus('Verbindung OK, aber Tabellen fehlen – bitte SQL-Script ausführen.', 'warn');
          connStatus.innerHTML = '<span class="badge badge-warn">⚠ Tabellen fehlen</span>';
        } else {
          setStatus('Fehler: ' + msg, 'error');
          connStatus.innerHTML = '<span class="badge badge-over">✗ Fehler</span>';
        }
      })
      .finally(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Verbindung speichern & testen';
      });
  });

  // ── Clockify section ─────────────────────────────────────────────────
  var clockifyKeyInput    = document.getElementById('clockifyKey');
  var clockifySaveBtn     = document.getElementById('clockifySaveBtn');
  var clockifySaveStatus  = document.getElementById('clockifySaveStatus');
  var clockifyStatusEl    = document.getElementById('clockifyStatus');

  clockifyKeyInput.value = localStorage.getItem('clockifyKey') || '';

  if (window.clockify.isConfigured()) {
    var wName = localStorage.getItem('clockifyWorkspaceName') || 'Verbunden';
    clockifyStatusEl.innerHTML = '<span class="badge badge-ok">✓ ' + wName + '</span>';
  }

  function setClockifyStatus(msg, type) {
    clockifySaveStatus.textContent = msg;
    clockifySaveStatus.style.color =
      type === 'success' ? 'var(--success)' :
      type === 'error'   ? 'var(--danger)'  : 'var(--text-secondary)';
  }

  clockifySaveBtn.addEventListener('click', function () {
    var key = clockifyKeyInput.value.trim();
    if (!key) { setClockifyStatus('Bitte API Key eingeben.', 'error'); return; }
    localStorage.setItem('clockifyKey', key);
    clockifySaveBtn.disabled = true;
    clockifySaveBtn.textContent = 'Teste Verbindung…';
    setClockifyStatus('', '');
    window.clockify.testConnection()
      .then(function (result) {
        var ws = result.matched;
        if (ws) {
          setClockifyStatus('Verbunden mit Workspace „' + ws.name + '" ✓', 'success');
          clockifyStatusEl.innerHTML = '<span class="badge badge-ok">✓ ' + ws.name + '</span>';
        } else {
          setClockifyStatus('Verbunden, aber kein Workspace „Adsmasters" gefunden.', 'error');
        }
      })
      .catch(function (e) {
        setClockifyStatus('Fehler: ' + e.message, 'error');
        clockifyStatusEl.innerHTML = '<span class="badge badge-over">✗ Fehler</span>';
      })
      .finally(function () {
        clockifySaveBtn.disabled = false;
        clockifySaveBtn.textContent = 'Verbindung speichern & testen';
      });
  });

  // ── Clockify import ──────────────────────────────────────────────────
  var importClientsBtn   = document.getElementById('importClientsBtn');
  var importEmployeesBtn = document.getElementById('importEmployeesBtn');
  var importStatus       = document.getElementById('importStatus');
  var importResult       = document.getElementById('importResult');

  function norm(s) { return (s || '').trim().toLowerCase(); }

  function setImportStatus(msg, type) {
    importStatus.textContent = msg;
    importStatus.style.color =
      type === 'success' ? 'var(--success)' :
      type === 'error'   ? 'var(--danger)'  : 'var(--text-secondary)';
  }

  function showImportResult(html) {
    importResult.innerHTML = html;
  }

  importClientsBtn.addEventListener('click', function () {
    if (!window.clockify.isConfigured()) {
      setImportStatus('Clockify nicht verbunden.', 'error'); return;
    }
    importClientsBtn.disabled    = true;
    importClientsBtn.textContent = 'Importiere…';
    setImportStatus('', '');
    showImportResult('');

    Promise.all([
      window.clockify.getProjects(),
      window.db.clients.list(),
    ]).then(function (results) {
      var projects  = results[0];
      var existing  = results[1];
      var existingNames = {};
      existing.forEach(function (c) { existingNames[norm(c.name)] = true; });

      var toCreate = projects.filter(function (p) { return !existingNames[norm(p.name)]; });
      var skipped  = projects.length - toCreate.length;

      if (!toCreate.length) {
        setImportStatus('Alle ' + skipped + ' Projekte bereits vorhanden.', 'success');
        return;
      }

      return Promise.all(toCreate.map(function (p) {
        return window.db.clients.create(p.name, null, null, null, null);
      })).then(function () {
        setImportStatus('', '');
        showImportResult(
          '<div class="alert alert-success">✓ ' + toCreate.length + ' Kunden importiert' +
          (skipped ? ' · ' + skipped + ' bereits vorhanden' : '') + ':<br>' +
          '<strong>' + toCreate.map(function (p) { return p.name; }).join(', ') + '</strong></div>'
        );
      });
    }).catch(function (e) {
      setImportStatus('Fehler: ' + e.message, 'error');
    }).finally(function () {
      importClientsBtn.disabled    = false;
      importClientsBtn.textContent = 'Kunden importieren';
    });
  });

  importEmployeesBtn.addEventListener('click', function () {
    if (!window.clockify.isConfigured()) {
      setImportStatus('Clockify nicht verbunden.', 'error'); return;
    }
    importEmployeesBtn.disabled    = true;
    importEmployeesBtn.textContent = 'Importiere…';
    setImportStatus('', '');
    showImportResult('');

    Promise.all([
      window.clockify.getUsers(),
      window.db.employees.list(),
    ]).then(function (results) {
      var users    = results[0];
      var existing = results[1];
      var existingNames = {};
      existing.forEach(function (e) { existingNames[norm(e.name)] = true; });

      var toCreate = users.filter(function (u) {
        var name = (u.name || u.email || '').trim();
        return name && !existingNames[norm(name)];
      });
      var skipped = users.length - toCreate.length;

      if (!toCreate.length) {
        setImportStatus('Alle ' + skipped + ' Mitarbeiter bereits vorhanden.', 'success');
        return;
      }

      return Promise.all(toCreate.map(function (u) {
        var name  = (u.name || u.email || '').trim();
        var email = u.email || null;
        return window.db.employees.create(name, 'other', email);
      })).then(function () {
        setImportStatus('', '');
        showImportResult(
          '<div class="alert alert-success">✓ ' + toCreate.length + ' Mitarbeiter importiert' +
          (skipped ? ' · ' + skipped + ' bereits vorhanden' : '') + ':<br>' +
          '<strong>' + toCreate.map(function (u) { return u.name || u.email; }).join(', ') + '</strong>' +
          '<br><span style="font-size:12px;color:var(--text-muted)">Bitte Rollen unter <a href="employees.html">Mitarbeiter</a> setzen.</span></div>'
        );
      });
    }).catch(function (e) {
      setImportStatus('Fehler: ' + e.message, 'error');
    }).finally(function () {
      importEmployeesBtn.disabled    = false;
      importEmployeesBtn.textContent = 'Mitarbeiter importieren';
    });
  });

  copyBtn.addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(sqlBlock.textContent.trim())
        .then(function () {
          copyBtn.textContent = 'Kopiert ✓';
          setTimeout(function () { copyBtn.textContent = 'Kopieren'; }, 2000);
        })
        .catch(function () { copyBtn.textContent = 'Manuell kopieren'; });
    } else {
      copyBtn.textContent = 'Manuell kopieren';
    }
  });
})();
