/* ═══════════════════════════════════════════════════════════════════
   admin-users.js
   User Access workspace. Drives the inline User Access tab in admin.html.

   Scope-limited intentionally: this view only edits the **salesweb**
   module level for each user. Cross-module access (operation / audit /
   mobile) lives in the umbrella User Access page on the operations
   portal; a salesweb admin has no business toggling those.

   Permission shape on shared_profiles.permissions JSONB:
     {
       "modules": { "salesweb": "admin"|"normal"|"none", ... other modules ... },
       "manage_users": bool,
       ...
     }
   We *merge* on save — never replace the full object — so we don't
   accidentally clobber cross-module flags the umbrella page wrote.

   Access levels we expose here:
     admin   → full salesweb portal incl. User Access tab
     normal  → all salesweb tabs except User Access
     none    → cannot sign in to salesweb admin at all
   ═══════════════════════════════════════════════════════════════════ */

var SW_LEVELS = ['admin','normal','none'];

// ═══════════════════════════════════════
//  LOAD USERS
// ═══════════════════════════════════════
async function loadUsers(){
  // Hard gate — only admins are allowed in this view. Server-side RLS
  // is the real defence; this is a UX guard so non-admins who manually
  // navigate to #users get bounced.
  if (!window.__SW_IS_ADMIN__) {
    document.getElementById('users-table').innerHTML =
      '<div class="loading" style="color:var(--red);">Only admins can manage user access.</div>';
    return;
  }

  var q      = (document.getElementById('user-search')?.value || '').trim().toLowerCase();
  var filter = document.getElementById('user-filter')?.value || '';

  var { data, error } = await sb.from('shared_profiles')
    .select('id, email, full_name, role, permissions, created_at')
    .order('created_at', { ascending: false });
  if (error) { toast('Error loading users: '+error.message, 'error'); return; }

  var users = (data || []).map(function(u){
    var lvl = u.permissions?.modules?.salesweb;
    // Legacy admins without a permissions blob count as admin until the
    // umbrella migration backfills them; render that explicitly.
    if (!lvl) lvl = (u.role === 'admin') ? 'admin' : 'none';
    return Object.assign({}, u, { _swLevel: lvl });
  });

  if (q) {
    users = users.filter(function(u){
      return (u.email||'').toLowerCase().includes(q) || (u.full_name||'').toLowerCase().includes(q);
    });
  }
  if (filter) users = users.filter(function(u){ return u._swLevel === filter; });

  if (!users.length) {
    document.getElementById('users-table').innerHTML = '<div class="loading">No users match the current filter.</div>';
    return;
  }

  var html = '<table class="data-table">'+
    '<thead><tr><th>User</th><th>Email</th><th>Current Access</th><th>Joined</th><th>Action</th></tr></thead><tbody>';

  users.forEach(function(u){
    var idJs   = String(u.id||'').replace(/[\\'"<>]/g,'');
    var nameJs = (u.full_name || u.email || '').replace(/[\\'"<>]/g,'');
    var badge  = u._swLevel === 'admin' ? 'badge-green'
               : u._swLevel === 'normal' ? 'badge-blue' : 'badge-grey';
    var isSelf = u.id === window.__SW_USER_ID__;

    html += '<tr>'+
      '<td><strong>'+esc(u.full_name || '—')+'</strong>'+(isSelf ? ' <span class="badge badge-grey" style="margin-left:.3rem;font-size:9px;">YOU</span>' : '')+'</td>'+
      '<td style="font-size:12px;color:var(--ink3);">'+esc(u.email || '')+'</td>'+
      '<td><span class="badge '+badge+'">'+esc(u._swLevel)+'</span></td>'+
      '<td style="font-size:12px;color:var(--ink4);">'+fmtDate(u.created_at)+'</td>'+
      '<td><button class="btn btn-outline btn-sm" onclick="openUserEdit(\''+idJs+'\')">Edit</button></td>'+
    '</tr>';
  });

  html += '</tbody></table>';
  document.getElementById('users-table').innerHTML = html;
}

// ═══════════════════════════════════════
//  EDIT USER ACCESS MODAL
// ═══════════════════════════════════════
async function openUserEdit(userId){
  var modal = document.getElementById('modal-user-access');
  if (!modal) { toast('User access modal not initialised','error'); return; }
  modal.classList.add('open');
  var body = document.getElementById('user-access-body');
  body.innerHTML = '<div class="loading">Loading…</div>';
  body.setAttribute('data-user-id', userId);

  var { data: u, error } = await sb.from('shared_profiles')
    .select('id, email, full_name, role, permissions')
    .eq('id', userId).single();
  if (error || !u) {
    body.innerHTML = '<div class="loading">User not found.</div>';
    return;
  }

  var currentLevel = u.permissions?.modules?.salesweb
                  || (u.role === 'admin' ? 'admin' : 'none');
  var isSelf       = u.id === window.__SW_USER_ID__;

  body.innerHTML =
    '<div style="margin-bottom:1.2rem;">'+
      '<div class="mp-section-title">User</div>'+
      '<div style="font-size:14px;line-height:1.7;">'+
        '<div><strong>'+esc(u.full_name || '—')+'</strong></div>'+
        '<div style="color:var(--ink3);font-size:12px;">'+esc(u.email || '')+'</div>'+
      '</div>'+
    '</div>'+
    '<div style="margin-bottom:1.2rem;">'+
      '<div class="mp-section-title">Salesweb Access Level</div>'+
      '<div style="display:flex;flex-direction:column;gap:.6rem;">'+
        SW_LEVELS.map(function(lvl){
          var checked = lvl === currentLevel ? 'checked' : '';
          var labelText = lvl === 'admin'  ? 'Admin — full portal incl. User Access management.'
                       : lvl === 'normal' ? 'Normal — all tabs except User Access.'
                                          : 'None — cannot sign in to salesweb admin.';
          return '<label class="mp-radio" style="padding:.7rem 1rem;border:1.5px solid '+(lvl===currentLevel?'var(--green)':'var(--border)')+';border-radius:8px;cursor:pointer;display:flex;align-items:flex-start;gap:.7rem;'+(lvl===currentLevel?'background:var(--green-light);':'')+'">'+
                   '<input type="radio" name="ua-level" value="'+lvl+'" '+checked+' style="margin-top:3px;">'+
                   '<div>'+
                     '<div style="font-weight:700;text-transform:capitalize;">'+lvl+'</div>'+
                     '<div style="font-size:12px;color:var(--ink3);">'+labelText+'</div>'+
                   '</div>'+
                 '</label>';
        }).join('')+
      '</div>'+
    '</div>'+
    (isSelf
      ? '<div style="padding:.7rem 1rem;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;color:#92400e;font-size:12px;margin-bottom:1rem;"><strong>Warning:</strong> You are editing your own access. Downgrading yourself will lock you out of User Access.</div>'
      : '')+
    '<div style="display:flex;gap:.5rem;justify-content:flex-end;padding-top:1rem;border-top:1px solid var(--border);">'+
      '<button class="btn btn-outline btn-sm" onclick="closeModal(\'modal-user-access\')">Cancel</button>'+
      '<button class="btn btn-primary btn-sm" onclick="saveUserAccess()">Save Access</button>'+
    '</div>';
}

// ═══════════════════════════════════════
//  SAVE
// ═══════════════════════════════════════
async function saveUserAccess(){
  var body   = document.getElementById('user-access-body');
  var userId = body?.getAttribute('data-user-id');
  var sel    = document.querySelector('input[name="ua-level"]:checked');
  if (!userId || !sel) { toast('Pick an access level first','error'); return; }
  var newLevel = sel.value;

  if (userId === window.__SW_USER_ID__ && newLevel !== 'admin') {
    if (!confirm('You are about to remove your own admin access. You will lose access to this User Access tab. Continue?')) return;
  }

  // Re-fetch the current permissions object so we MERGE rather than
  // overwrite. Other modules' levels and the manage_users flag must be
  // preserved untouched.
  var { data: existing, error: readErr } = await sb.from('shared_profiles')
    .select('permissions').eq('id', userId).single();
  if (readErr) { toast('Read failed: '+readErr.message, 'error'); return; }

  var perms = existing?.permissions || {};
  perms.modules = perms.modules || {};
  perms.modules.salesweb = newLevel;

  var { error } = await sb.from('shared_profiles')
    .update({ permissions: perms })
    .eq('id', userId);
  if (error) { toast('Save failed: '+error.message, 'error'); return; }

  toast('Access updated');
  closeModal('modal-user-access');
  loadUsers();
}
