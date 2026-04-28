(function () {
  'use strict';

  let _sb = null;

  function sb() {
    if (_sb) return _sb;
    const url = localStorage.getItem('supabaseUrl');
    const key = localStorage.getItem('supabaseKey');
    if (!url || !key) throw new Error('NOT_CONFIGURED');
    if (!window.supabase) throw new Error('Supabase-Bibliothek nicht geladen.');
    _sb = window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return _sb;
  }

  async function q(fn) {
    const { data, error } = await fn(sb());
    if (error) throw error;
    return data;
  }

  window.getSb = function () { return sb(); };

  window.isConfigured = () =>
    !!(localStorage.getItem('supabaseUrl') && localStorage.getItem('supabaseKey'));

  window.configure = (url, key) => {
    localStorage.setItem('supabaseUrl', url.trim());
    localStorage.setItem('supabaseKey', key.trim());
    _sb = null;
  };

  window.db = {

    employees: {
      list: () =>
        q(s => s.from('employees').select('*').order('name')),
      listActive: () =>
        q(s => s.from('employees').select('*').eq('active', true).order('name')),
      create: (name, role, email) =>
        q(s => s.from('employees')
          .insert({ name, role, email: email || null, active: true })
          .select().single()),
      update: (id, fields) =>
        q(s => s.from('employees').update(fields).eq('id', id).select().single()),
      delete: (id) =>
        q(s => s.from('employees').delete().eq('id', id)),
    },

    clients: {
      list: () =>
        q(s => s.from('clients')
          .select('*, am_emp:am_employee_id(id,name), adv_emp:adv_employee_id(id,name)')
          .order('name')),
      get: (id) =>
        q(s => s.from('clients').select('*').eq('id', id).single()),
      create: (name, amBudget, advBudget, amEmpId, advEmpId) =>
        q(s => s.from('clients')
          .insert({ name, am_budget: amBudget || null, adv_budget: advBudget || null,
                    am_employee_id: amEmpId || null, adv_employee_id: advEmpId || null })
          .select().single()),
      update: (id, fields) =>
        q(s => s.from('clients').update(fields).eq('id', id).select().single()),
      delete: (id) =>
        q(s => s.from('clients').delete().eq('id', id)),
    },

    adjustments: {
      forClientYear: (clientId, year) =>
        q(s => s.from('adjustments').select('*')
          .eq('client_id', clientId).eq('year', year)),
      upsert: (clientId, year, month, amHours, advHours, note) =>
        q(s => s.from('adjustments').upsert(
          { client_id: clientId, year, month,
            am_hours:  amHours  || 0,
            adv_hours: advHours || 0,
            note:      note     || null,
            updated_at: new Date().toISOString() },
          { onConflict: 'client_id,year,month' }
        ).select().single()),
      delete: (clientId, year, month) =>
        q(s => s.from('adjustments').delete()
          .eq('client_id', clientId).eq('year', year).eq('month', month)),
    },

    entries: {
      // All entries for a month across all clients (includes employee data)
      forMonth: (year, month) =>
        q(s => s.from('entries')
          .select('*, employees(id, name, role)')
          .eq('year', year).eq('month', month)),

      // All entries for a specific client + month
      forClientMonth: (clientId, year, month) =>
        q(s => s.from('entries')
          .select('*, employees(id, name, role)')
          .eq('client_id', clientId).eq('year', year).eq('month', month)),

      // All entries for a specific client + year (for detail page)
      forClientYear: (clientId, year) =>
        q(s => s.from('entries')
          .select('*, employees(id, name, role)')
          .eq('client_id', clientId).eq('year', year)
          .order('month')),

      // All entries for all clients for a full year (for overview)
      forYear: (year) =>
        q(s => s.from('entries')
          .select('*, employees(id, name, role)')
          .eq('year', year)),

      upsert: (clientId, employeeId, year, month, hours) =>
        q(s => s.from('entries')
          .upsert(
            { client_id: clientId, employee_id: employeeId, year, month,
              hours: hours ?? 0, updated_at: new Date().toISOString() },
            { onConflict: 'client_id,employee_id,year,month' }
          ).select().single()),

      // Delete a single entry (0 hours)
      delete: (clientId, employeeId, year, month) =>
        q(s => s.from('entries').delete()
          .eq('client_id', clientId).eq('employee_id', employeeId)
          .eq('year', year).eq('month', month)),

      // Delete all entries for a client+month (used when resetting)
      deleteAll: (clientId, year, month) =>
        q(s => s.from('entries').delete()
          .eq('client_id', clientId).eq('year', year).eq('month', month)),
    },

  };
})();
