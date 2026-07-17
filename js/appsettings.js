(function () {
  'use strict';

  // Loads shared app settings (e.g. Clockify key) from Supabase and caches
  // them to localStorage so clockify.js can use them synchronously.
  // Falls back silently to whatever is already in localStorage.

  window.settingsReady = (function () {
    if (!window.isConfigured()) return Promise.resolve();
    return window.db.settings.getAll()
      .then(function (rows) {
        (rows || []).forEach(function (row) {
          switch (row.key) {
            case 'clockify_key':            localStorage.setItem('clockifyKey',           row.value); break;
            case 'clockify_workspace_id':   localStorage.setItem('clockifyWorkspaceId',   row.value); break;
            case 'clockify_workspace_name': localStorage.setItem('clockifyWorkspaceName', row.value); break;
          }
        });
      })
      .catch(function () {
        // table may not exist yet – fall back to existing localStorage values
      });
  })();

})();
