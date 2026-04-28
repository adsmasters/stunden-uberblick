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
