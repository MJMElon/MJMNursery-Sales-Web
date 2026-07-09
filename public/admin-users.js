/* ═══════════════════════════════════════════════════════════════════
   admin-users.js
   User Access workspace. Drives the inline User Access tab in admin.html.

   Scope:
   - LISTS ONLY users assigned to the salesweb module from the umbrella
     operation portal (permissions.modules.salesweb in 'admin'|'normal').
     The umbrella page is the source of truth for granting/revoking
     salesweb access itself; this view edits the per-tab settings on top.
   - Per-tab settings live in shared_profiles.permissions.salesweb_tabs
     as { tabKey: bool }. Missing object = grandfather (see admin.html
     applyTabVisibility()).
   - "users" tab is implicitly admin-locked everywhere; we expose the
     per-tab checkbox for it so admins can toggle other admins, but
     normal users can never see User Access regardless of the flag.

   Save path MERGES into the existing permissions JSONB so cross-module
   fields (operation/audit/mobile, manage_users, etc.) stay untouched.
   ═══════════════════════════════════════════════════════════════════ */

// Tab list mirrors SALESWEB_TAB_KEYS in admin.html. Each entry is
// { key, label, adminOnly } where adminOnly means the toggle is shown
// but the runtime gate (canSeeTab) will still hide the tab from
// non-admins regardless of the saved flag.
var SW_TAB_DEFS = [
  { key: 'orders',     label: 'Orders' },
  { key: 'reports',    label: 'Reports' },
  { key: 'customers',  label: 'Customers' },
  { key: 'products',   label: 'Products' },
  { key: 'payments',   label: 'Payments' },
  { key: 'promos',     label: 'Promotions' },
  { key: 'coupons',    label: 'Coupons' },
  { key: 'webdesign',  label: 'Website Design' },
  { key: 'settings',   label: 'Settings' },
  { key: 'users',      label: 'User Access', adminOnly: true }
];

// Per-user in-memory cache of the most recently saved tabs. Reading
// this on reopen sidesteps any read-after-write lag where a fresh
// SELECT comes back before the JSONB column is visible.
var SW_TABS_CACHE = {};

// Resolves a profile's effective per-tab map for display.
// - admin / legacy admin → every tab true
// - normal with saved tabs → use as-is
// - normal without saved tabs → grandfather all tabs except 'users'
// Per-user in-memory cache takes precedence so an immediate reopen
// after Save reflects the chosen tabs even if the DB read is stale.
//
// `savedTabs` is the row from salesweb_user_tab_access.tabs (preferred)
// — falls back to the legacy permissions.salesweb_tabs blob for users
// whose data was written before the migration to the dedicated table.
function effectiveTabs(profile, savedTabs){
  var level = profile?.permissions?.modules?.salesweb
           || (profile?.role === 'admin' ? 'admin' : 'none');
  var saved = (profile?.id && SW_TABS_CACHE[profile.id])
           || savedTabs
           || profile?.permissions?.salesweb_tabs;
  var out = {};
  SW_TAB_DEFS.forEach(function(d){
    if (level === 'admin') out[d.key] = true;
    else if (saved && typeof saved === 'object') out[d.key] = saved[d.key] === true;
    else out[d.key] = d.key !== 'users';  // grandfather default
  });
  return out;
}

// ═══════════════════════════════════════
//  LOAD USERS
// ═══════════════════════════════════════
async function loadUsers(){
  if (!window.__SW_IS_ADMIN__) {
    document.getElementById('users-table').innerHTML =
      '<div class="loading" style="color:var(--red);">Only admins can manage user access.</div>';
    return;
  }

  var q      = (document.getElementById('user-search')?.value || '').trim().toLowerCase();
  var filter = document.getElementById('user-filter')?.value || '';

  // Profiles + per-tab access in parallel. The new table is the source
  // of truth; if it doesn't exist yet (migration not applied) we
  // gracefully fall back to the legacy permissions.salesweb_tabs blob
  // via effectiveTabs().
  var [profileRes, accessRes] = await Promise.all([
    sb.from('shared_profiles')
      .select('id, email, full_name, role, permissions, created_at')
      .order('created_at', { ascending: false }),
    sb.from('salesweb_user_tab_access').select('user_id, tabs')
  ]);
  if (profileRes.error) { toast('Error loading users: '+profileRes.error.message, 'error'); return; }

  var accessByUser = {};
  (accessRes.data || []).forEach(function(r){ accessByUser[r.user_id] = r.tabs; });

  var users = (profileRes.data || [])
    .map(function(u){
      var lvl = u.permissions?.modules?.salesweb;
      if (!lvl) lvl = (u.role === 'admin') ? 'admin' : 'none';
      return Object.assign({}, u, { _swLevel: lvl, _tabs: accessByUser[u.id] });
    })
    // ONLY users assigned to salesweb by the umbrella operation portal.
    .filter(function(u){ return u._swLevel === 'admin' || u._swLevel === 'normal'; });

  if (q) {
    users = users.filter(function(u){
      return (u.email||'').toLowerCase().includes(q) || (u.full_name||'').toLowerCase().includes(q);
    });
  }
  if (filter) users = users.filter(function(u){ return u._swLevel === filter; });

  if (!users.length) {
    document.getElementById('users-table').innerHTML =
      '<div class="loading">No users have been granted salesweb access yet. Grant access from the umbrella User Access page first.</div>';
    return;
  }

  var html = '<table class="data-table">'+
    '<thead><tr><th>Email</th><th>Level</th><th>Allowed Pages</th><th>Action</th></tr></thead><tbody>';

  users.forEach(function(u){
    var idJs  = String(u.id||'').replace(/[\\'"<>]/g,'');
    var lvlBadge = u._swLevel === 'admin' ? 'badge-green' : 'badge-blue';
    var isSelf   = u.id === window.__SW_USER_ID__;
    var tabs     = effectiveTabs(u, u._tabs);
    var allowedKeys = SW_TAB_DEFS.filter(function(d){ return tabs[d.key]; });
    var pagesHtml;
    if (u._swLevel === 'admin') {
      pagesHtml = '<span style="font-size:11px;color:var(--ink4);font-style:italic;">All pages (admin)</span>';
    } else if (allowedKeys.length === SW_TAB_DEFS.length - 1) {  // everything except user-access
      pagesHtml = '<span style="font-size:11px;color:var(--ink3);">All pages</span>';
    } else if (!allowedKeys.length) {
      pagesHtml = '<span style="font-size:11px;color:var(--red);">No pages — locked out</span>';
    } else {
      pagesHtml = allowedKeys.map(function(d){
        return '<span class="badge badge-grey" style="margin:1px 2px;font-size:9px;">'+esc(d.label)+'</span>';
      }).join('');
    }

    html += '<tr>'+
      '<td><strong>'+esc(u.email || '—')+'</strong>'+(isSelf ? ' <span class="badge badge-grey" style="margin-left:.3rem;font-size:9px;">YOU</span>' : '')+'</td>'+
      '<td><span class="badge '+lvlBadge+'">'+esc(u._swLevel)+'</span></td>'+
      '<td>'+pagesHtml+'</td>'+
      '<td><button class="btn btn-outline btn-sm" onclick="openUserEdit(\''+idJs+'\')">Edit Pages</button></td>'+
    '</tr>';
  });

  html += '</tbody></table>';
  document.getElementById('users-table').innerHTML = html;
}

// ═══════════════════════════════════════
//  EDIT USER PER-TAB ACCESS MODAL
// ═══════════════════════════════════════
async function openUserEdit(userId){
  var modal = document.getElementById('modal-user-access');
  if (!modal) { toast('User access modal not initialised','error'); return; }
  modal.classList.add('open');
  var body = document.getElementById('user-access-body');
  body.innerHTML = '<div class="loading">Loading…</div>';
  body.setAttribute('data-user-id', userId);

  // Profile + tab access row in parallel.
  var [profileRes, accessRes] = await Promise.all([
    sb.from('shared_profiles').select('id, email, full_name, role, permissions').eq('id', userId).single(),
    sb.from('salesweb_user_tab_access').select('tabs').eq('user_id', userId).maybeSingle()
  ]);
  var u = profileRes.data;
  if (profileRes.error || !u) {
    body.innerHTML = '<div class="loading">User not found.</div>';
    return;
  }

  var savedTabs = accessRes.data?.tabs;
  var level     = u.permissions?.modules?.salesweb
               || (u.role === 'admin' ? 'admin' : 'none');
  var tabs      = effectiveTabs(u, savedTabs);
  var isSelf    = u.id === window.__SW_USER_ID__;
  var isAdmin   = level === 'admin';

  var togglesHtml = SW_TAB_DEFS.map(function(d){
    var checked = tabs[d.key] ? 'checked' : '';
    // Admins always have all tabs; show the boxes as checked + disabled
    // so the UI conveys "managed by umbrella level, not editable here".
    var disabled = isAdmin ? 'disabled' : '';
    var hint = d.adminOnly
      ? '<span style="font-size:10px;color:var(--ink4);margin-left:.3rem;">(admin-only — never visible to normal users)</span>'
      : '';
    return '<label class="mp-radio" style="padding:.6rem .9rem;border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;gap:.7rem;cursor:'+(isAdmin?'not-allowed':'pointer')+';'+(isAdmin?'opacity:.6;':'')+'">'+
             '<input type="checkbox" name="ua-tab" value="'+d.key+'" '+checked+' '+disabled+' style="width:18px;height:18px;accent-color:var(--green);">'+
             '<div style="font-weight:600;font-size:13px;">'+esc(d.label)+hint+'</div>'+
           '</label>';
  }).join('');

  body.innerHTML =
    '<div style="margin-bottom:1.2rem;">'+
      '<div class="mp-section-title">User</div>'+
      '<div style="font-size:14px;line-height:1.7;">'+
        '<div style="font-weight:700;">'+esc(u.email || '—')+'</div>'+
        '<div style="margin-top:.3rem;">Salesweb level: <span class="badge '+(isAdmin?'badge-green':'badge-blue')+'">'+esc(level)+'</span></div>'+
        '<div style="font-size:11px;color:var(--ink4);margin-top:.3rem;">Level is managed from the umbrella User Access portal.</div>'+
      '</div>'+
    '</div>'+
    '<div style="margin-bottom:1rem;">'+
      '<div class="mp-section-title">Pages this user can see</div>'+
      (isAdmin
        ? '<div style="padding:.7rem 1rem;background:var(--green-light);border:1px solid var(--green);border-radius:8px;color:var(--green-dark);font-size:12px;margin-bottom:.7rem;">Admin users always see every page. Edit pages by demoting to <strong>normal</strong> from the umbrella User Access portal first.</div>'
        : '')+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;">'+togglesHtml+'</div>'+
      (!isAdmin
        ? '<div style="display:flex;gap:.5rem;margin-top:.7rem;flex-wrap:wrap;">'+
            '<button class="btn btn-outline btn-sm" onclick="setAllTabs(true)">Allow All</button>'+
            '<button class="btn btn-outline btn-sm" onclick="setAllTabs(false)">Deny All</button>'+
          '</div>'
        : '')+
    '</div>'+
    (isSelf && !isAdmin
      ? '<div style="padding:.7rem 1rem;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;color:#92400e;font-size:12px;margin-bottom:1rem;"><strong>Heads up:</strong> You are editing your own page access. Denying pages here will hide them from you on next reload.</div>'
      : '')+
    '<div style="display:flex;gap:.5rem;justify-content:flex-end;padding-top:1rem;border-top:1px solid var(--border);">'+
      '<button class="btn btn-outline btn-sm" onclick="closeModal(\'modal-user-access\')">Cancel</button>'+
      (!isAdmin ? '<button class="btn btn-primary btn-sm" onclick="saveUserAccess()">Save Page Access</button>' : '')+
    '</div>';
}

function setAllTabs(value){
  document.querySelectorAll('input[name="ua-tab"]').forEach(function(cb){
    if (!cb.disabled) cb.checked = value;
  });
}

// ═══════════════════════════════════════
//  SAVE — writes to salesweb_user_tab_access (NOT shared_profiles)
// ═══════════════════════════════════════
// The dedicated table sidesteps the umbrella's manage_users RLS gate.
// Its policy lets any salesweb_admin write any row, which is exactly
// what we want: a salesweb admin should own salesweb tab access.
async function saveUserAccess(){
  var body   = document.getElementById('user-access-body');
  var userId = body?.getAttribute('data-user-id');
  if (!userId) { toast('No user in context','error'); return; }

  var newTabs = {};
  SW_TAB_DEFS.forEach(function(d){ newTabs[d.key] = false; });
  document.querySelectorAll('input[name="ua-tab"]:checked').forEach(function(cb){
    newTabs[cb.value] = true;
  });

  var updatedBy = window.__SW_USER_ID__ || null;
  var { data: updated, error } = await sb
    .from('salesweb_user_tab_access')
    .upsert({ user_id: userId, tabs: newTabs, updated_by: updatedBy }, { onConflict: 'user_id' })
    .select('user_id, tabs')
    .maybeSingle();

  if (error) {
    // Most common cause is the migration not having been applied yet.
    if (/relation .* does not exist|42P01/i.test(error.message || '')) {
      toast('salesweb_user_tab_access table is missing — apply supabase/migrations/salesweb_user_tab_access.sql in the Supabase SQL editor first.', 'error');
    } else {
      toast('Save failed: '+error.message, 'error');
    }
    return;
  }
  if (!updated) {
    toast('Save blocked by RLS — confirm you are a salesweb admin in the umbrella User Access page.', 'error');
    return;
  }

  var savedTabs = updated?.tabs || {};
  var match = SW_TAB_DEFS.every(function(d){
    return (savedTabs[d.key] === true) === (newTabs[d.key] === true);
  });
  if (!match) {
    toast('Save did not take effect. Please reload and try again.', 'error');
    return;
  }

  SW_TABS_CACHE[userId] = newTabs;
  toast('Page access updated');
  closeModal('modal-user-access');
  loadUsers();
}
