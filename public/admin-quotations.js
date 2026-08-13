/* ═══════════════════════════════════════════════════════════════════
   admin-quotations.js
   Admin-only quotation module. Lets ops issue a formal quotation to a
   prospect (line items can be ANY typed product, not restricted to the
   online catalog), persist it, and download it as a PDF via the
   browser's print dialog.

   Shape mirrors the customer-facing "Request a Quotation" form:
     - Customer / company details header
     - Line items (add / remove rows, free-form)
     - Subtotal + optional tax + grand total
     - Notes / terms

   Tables: salesweb_quotations, salesweb_quotation_items
   Shared helpers assumed on window: sb, toast, esc, fmtDate, openModal,
   closeModal.
   ═══════════════════════════════════════════════════════════════════ */

// One in-flight quotation while the admin edits — a shallow local copy
// so cart-style row edits don't hit the DB on every keystroke. Committed
// with Save.
var QUOT_STATE = {
  editingId:   null,
  header: {
    quotation_number: '',
    customer_name:    '',
    contact_person:   '',
    contact_number:   '',
    email:            '',
    address:          '',
    notes:            '',
    status:           'Draft',
    valid_until:      '',
    tax_amount:       0
  },
  items: []
};

function _fmtQMYR(n){
  return (Number(n)||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
}

// ═══════════════════════════════════════
//  LIST — dashboard table
// ═══════════════════════════════════════
async function loadQuotations(){
  var q = (document.getElementById('quotation-search')?.value || '').trim().toLowerCase();
  var status = document.getElementById('quotation-filter')?.value || '';

  var query = sb.from('salesweb_quotations').select('*').order('created_at',{ascending:false});
  if (status) query = query.eq('status', status);

  var { data, error } = await query;
  if (error){ toast('Error loading quotations: '+error.message,'error'); return; }
  var rows = data || [];
  if (q){
    rows = rows.filter(function(r){
      return (r.quotation_number||'').toLowerCase().includes(q)
          || (r.customer_name||'').toLowerCase().includes(q)
          || (r.email||'').toLowerCase().includes(q)
          || (r.contact_person||'').toLowerCase().includes(q);
    });
  }

  renderQuotationStats(data||[]);
  renderQuotationsTable(rows);
}
window.loadQuotations = loadQuotations;

function renderQuotationStats(all){
  var draft   = all.filter(function(r){ return r.status==='Draft'; }).length;
  var sent    = all.filter(function(r){ return r.status==='Sent'; }).length;
  var accept  = all.filter(function(r){ return r.status==='Accepted'; }).length;
  var sumAll  = all.reduce(function(s,r){ return s+(Number(r.total)||0); }, 0);
  document.getElementById('quotation-stats').innerHTML =
    '<div class="stat-box"><div class="stat-label">Total Quotations</div><div class="stat-val">'+all.length+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Drafts</div><div class="stat-val" style="color:var(--ink3);">'+draft+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Sent</div><div class="stat-val" style="color:var(--amber);">'+sent+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Accepted</div><div class="stat-val green">'+accept+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Total Value</div><div class="stat-val" style="color:#7c5cbf;">RM '+_fmtQMYR(sumAll)+'</div></div>';
}

function renderQuotationsTable(rows){
  if (!rows.length){
    document.getElementById('quotations-table').innerHTML =
      '<div class="loading">No quotations yet. Click <strong>+ New Quotation</strong> to create one.</div>';
    return;
  }
  var badgeCls = { Draft:'badge-grey', Sent:'badge-amber', Accepted:'badge-green', Expired:'badge-red', Converted:'badge-blue' };
  var html = '<table class="data-table"><thead><tr>'+
    '<th>Quotation #</th><th>Customer</th><th>Contact</th><th>Created</th><th>Valid Until</th>'+
    '<th style="text-align:right;">Total</th><th>Status</th><th>Action</th>'+
    '</tr></thead><tbody>';
  rows.forEach(function(r){
    var idJs = String(r.id||'').replace(/[\\'"<>]/g,'');
    html += '<tr style="cursor:pointer;" onclick="openQuotation(\''+idJs+'\')">'+
      '<td><strong>'+esc(r.quotation_number||'—')+'</strong></td>'+
      '<td>'+esc(r.customer_name||'—')+
        (r.email ? '<div style="font-size:11px;color:var(--ink4);">'+esc(r.email)+'</div>' : '')+
      '</td>'+
      '<td>'+esc(r.contact_person||'—')+
        (r.contact_number ? '<div style="font-size:11px;color:var(--ink4);">'+esc(r.contact_number)+'</div>' : '')+
      '</td>'+
      '<td>'+fmtDate(r.created_at)+'</td>'+
      '<td>'+(r.valid_until ? esc(String(r.valid_until).substring(0,10)) : '<span style="color:var(--ink4);">—</span>')+'</td>'+
      '<td style="text-align:right;font-weight:600;">RM '+_fmtQMYR(r.total)+'</td>'+
      '<td><span class="badge '+(badgeCls[r.status]||'badge-grey')+'">'+esc(r.status||'Draft')+'</span></td>'+
      '<td onclick="event.stopPropagation();">'+
        '<button class="btn btn-outline btn-sm" onclick="openQuotation(\''+idJs+'\')">Open</button> '+
        '<button class="btn btn-outline btn-sm" onclick="printQuotation(\''+idJs+'\')">📄 PDF</button> '+
        '<button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red);" onclick="deleteQuotation(\''+idJs+'\')">✕</button>'+
      '</td>'+
    '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('quotations-table').innerHTML = html;
}

// ═══════════════════════════════════════
//  EDITOR — modal (new or edit)
// ═══════════════════════════════════════
function openNewQuotation(){
  QUOT_STATE.editingId = null;
  QUOT_STATE.header = {
    quotation_number: '',
    customer_name: '', contact_person: '', contact_number: '', email: '', address: '',
    notes: '', status: 'Draft', valid_until: '', tax_amount: 0
  };
  QUOT_STATE.items = [ blankItem() ];
  renderQuotationEditor();
  openModal('modal-quotation');
}
window.openNewQuotation = openNewQuotation;

async function openQuotation(id){
  var { data: q } = await sb.from('salesweb_quotations').select('*').eq('id', id).single();
  var { data: items } = await sb.from('salesweb_quotation_items').select('*').eq('quotation_id', id).order('sort_order',{ascending:true});
  if (!q){ toast('Quotation not found','error'); return; }
  QUOT_STATE.editingId = q.id;
  QUOT_STATE.header = {
    quotation_number: q.quotation_number || '',
    customer_name:    q.customer_name    || '',
    contact_person:   q.contact_person   || '',
    contact_number:   q.contact_number   || '',
    email:            q.email            || '',
    address:          q.address          || '',
    notes:            q.notes            || '',
    status:           q.status           || 'Draft',
    valid_until:      q.valid_until ? String(q.valid_until).substring(0,10) : '',
    tax_amount:       Number(q.tax_amount)||0
  };
  QUOT_STATE.items = (items||[]).map(function(it){
    return { product_name:it.product_name||'', quantity:Number(it.quantity)||0, unit_price:Number(it.unit_price)||0 };
  });
  if (!QUOT_STATE.items.length) QUOT_STATE.items = [ blankItem() ];
  renderQuotationEditor();
  openModal('modal-quotation');
}
window.openQuotation = openQuotation;

function blankItem(){ return { product_name:'', quantity:1, unit_price:0 }; }

function _readEditorHeaderFromDOM(){
  // Read header fields BEFORE we re-render so keystrokes aren't lost.
  var g = function(id){ var el=document.getElementById(id); return el?el.value:''; };
  QUOT_STATE.header.customer_name  = g('q-customer-name');
  QUOT_STATE.header.contact_person = g('q-contact-person');
  QUOT_STATE.header.contact_number = g('q-contact-number');
  QUOT_STATE.header.email          = g('q-email');
  QUOT_STATE.header.address        = g('q-address');
  QUOT_STATE.header.notes          = g('q-notes');
  QUOT_STATE.header.valid_until    = g('q-valid-until');
  QUOT_STATE.header.status         = g('q-status') || 'Draft';
  QUOT_STATE.header.tax_amount     = Number(g('q-tax'))||0;
}
function _readEditorItemsFromDOM(){
  var rows = document.querySelectorAll('#q-items-body tr[data-qidx]');
  QUOT_STATE.items = [];
  rows.forEach(function(tr){
    var idx = tr.getAttribute('data-qidx');
    var name = (document.getElementById('q-item-name-'+idx)||{}).value || '';
    var qty  = Number((document.getElementById('q-item-qty-'+idx)||{}).value)  || 0;
    var up   = Number((document.getElementById('q-item-up-'+idx)||{}).value)   || 0;
    QUOT_STATE.items.push({ product_name:name, quantity:qty, unit_price:up });
  });
}

function addQuotationItem(){
  _readEditorHeaderFromDOM();
  _readEditorItemsFromDOM();
  QUOT_STATE.items.push(blankItem());
  renderQuotationEditor();
}
window.addQuotationItem = addQuotationItem;

function removeQuotationItem(idx){
  _readEditorHeaderFromDOM();
  _readEditorItemsFromDOM();
  QUOT_STATE.items.splice(idx, 1);
  if (!QUOT_STATE.items.length) QUOT_STATE.items = [ blankItem() ];
  renderQuotationEditor();
}
window.removeQuotationItem = removeQuotationItem;

function recomputeQuotationTotals(){
  _readEditorItemsFromDOM();
  _readEditorHeaderFromDOM();
  var subtotal = QUOT_STATE.items.reduce(function(s,it){
    return s + (Number(it.quantity)||0) * (Number(it.unit_price)||0);
  }, 0);
  var tax = Number(QUOT_STATE.header.tax_amount)||0;
  var total = subtotal + tax;
  document.getElementById('q-subtotal').textContent = _fmtQMYR(subtotal);
  document.getElementById('q-total').textContent    = _fmtQMYR(total);
  // Also refresh per-row line totals in place.
  QUOT_STATE.items.forEach(function(it, idx){
    var el = document.getElementById('q-item-line-'+idx);
    if (el) el.textContent = _fmtQMYR((Number(it.quantity)||0)*(Number(it.unit_price)||0));
  });
}
window.recomputeQuotationTotals = recomputeQuotationTotals;

function renderQuotationEditor(){
  var h = QUOT_STATE.header;
  var isEdit = !!QUOT_STATE.editingId;
  document.getElementById('modal-quotation-title').textContent =
    isEdit ? ('Edit Quotation ' + (h.quotation_number ? '· '+h.quotation_number : '')) : 'New Quotation';

  var itemsRows = QUOT_STATE.items.map(function(it, idx){
    return '<tr data-qidx="'+idx+'">'+
      '<td><input type="text" id="q-item-name-'+idx+'" class="form-input" value="'+esc(it.product_name||'')+'" placeholder="e.g. Oil Palm Seedling — Mar 2027" oninput="recomputeQuotationTotals()" style="font-size:12px;padding:5px 8px;width:100%;"></td>'+
      '<td style="width:90px;"><input type="number" step="1" min="0" id="q-item-qty-'+idx+'" class="form-input" value="'+(Number(it.quantity)||0)+'" oninput="recomputeQuotationTotals()" style="font-size:12px;padding:5px 8px;text-align:right;width:100%;"></td>'+
      '<td style="width:120px;"><input type="number" step="0.01" min="0" id="q-item-up-'+idx+'" class="form-input" value="'+(Number(it.unit_price)||0)+'" oninput="recomputeQuotationTotals()" style="font-size:12px;padding:5px 8px;text-align:right;width:100%;"></td>'+
      '<td style="width:110px;text-align:right;font-weight:600;padding-right:.5rem;">RM <span id="q-item-line-'+idx+'">'+_fmtQMYR((Number(it.quantity)||0)*(Number(it.unit_price)||0))+'</span></td>'+
      '<td style="width:36px;"><button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red);font-size:11px;padding:2px 8px;" onclick="removeQuotationItem('+idx+')" title="Remove row">✕</button></td>'+
    '</tr>';
  }).join('');

  var subtotal = QUOT_STATE.items.reduce(function(s,it){ return s + (Number(it.quantity)||0)*(Number(it.unit_price)||0); }, 0);
  var total    = subtotal + (Number(h.tax_amount)||0);

  document.getElementById('quotation-body').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-bottom:.9rem;">'+
      '<div><label class="form-label">Customer / Company Name *</label><input type="text" id="q-customer-name" class="form-input" value="'+esc(h.customer_name)+'" placeholder="e.g. MJM Plantation Sdn Bhd" style="font-size:13px;"></div>'+
      '<div><label class="form-label">Contact Person</label><input type="text" id="q-contact-person" class="form-input" value="'+esc(h.contact_person)+'" style="font-size:13px;"></div>'+
      '<div><label class="form-label">Contact Number</label><input type="text" id="q-contact-number" class="form-input" value="'+esc(h.contact_number)+'" style="font-size:13px;"></div>'+
      '<div><label class="form-label">Email</label><input type="email" id="q-email" class="form-input" value="'+esc(h.email)+'" style="font-size:13px;"></div>'+
      '<div style="grid-column:1/-1;"><label class="form-label">Address</label><input type="text" id="q-address" class="form-input" value="'+esc(h.address)+'" style="font-size:13px;"></div>'+
    '</div>'+

    '<div style="margin-bottom:.4rem;display:flex;justify-content:space-between;align-items:center;">'+
      '<div style="font-size:13px;font-weight:600;">Line Items</div>'+
      '<button class="btn btn-primary btn-sm" onclick="addQuotationItem()">+ Add Row</button>'+
    '</div>'+
    '<table class="data-table" style="font-size:12px;margin-bottom:.9rem;">'+
      '<thead><tr><th>Product / Description</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Unit Price (RM)</th><th style="text-align:right;">Line Total</th><th></th></tr></thead>'+
      '<tbody id="q-items-body">'+itemsRows+'</tbody>'+
    '</table>'+

    '<div style="display:grid;grid-template-columns:1fr 260px;gap:1rem;">'+
      '<div>'+
        '<label class="form-label">Notes / Terms &amp; Conditions</label>'+
        '<textarea id="q-notes" class="form-input" rows="4" style="font-size:12px;font-family:inherit;">'+esc(h.notes)+'</textarea>'+
      '</div>'+
      '<div style="background:var(--bg);border-radius:8px;padding:.7rem .9rem;font-size:13px;">'+
        '<div style="display:flex;justify-content:space-between;margin-bottom:.35rem;"><span>Subtotal</span><span style="font-weight:600;">RM <span id="q-subtotal">'+_fmtQMYR(subtotal)+'</span></span></div>'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.35rem;gap:.5rem;">'+
          '<span>Tax</span>'+
          '<input type="number" step="0.01" min="0" id="q-tax" class="form-input" value="'+(Number(h.tax_amount)||0)+'" oninput="recomputeQuotationTotals()" style="width:110px;text-align:right;font-size:12px;padding:4px 8px;">'+
        '</div>'+
        '<div style="display:flex;justify-content:space-between;padding-top:.5rem;border-top:1px solid var(--border);font-weight:700;"><span>Total</span><span>RM <span id="q-total">'+_fmtQMYR(total)+'</span></span></div>'+
      '</div>'+
    '</div>'+

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-top:.9rem;">'+
      '<div><label class="form-label">Valid Until</label><input type="date" id="q-valid-until" class="form-input" value="'+esc(h.valid_until)+'" style="font-size:13px;"></div>'+
      '<div><label class="form-label">Status</label>'+
        '<select id="q-status" class="form-input" style="font-size:13px;">'+
          ['Draft','Sent','Accepted','Expired','Converted'].map(function(s){
            return '<option value="'+s+'"'+(s===h.status?' selected':'')+'>'+s+'</option>';
          }).join('')+
        '</select>'+
      '</div>'+
    '</div>';
}

async function saveQuotation(){
  _readEditorHeaderFromDOM();
  _readEditorItemsFromDOM();

  if (!QUOT_STATE.header.customer_name.trim()){
    toast('Customer / Company Name is required','error'); return;
  }
  var subtotal = QUOT_STATE.items.reduce(function(s,it){ return s + (Number(it.quantity)||0)*(Number(it.unit_price)||0); }, 0);
  var tax      = Number(QUOT_STATE.header.tax_amount)||0;
  var total    = subtotal + tax;

  var session = await sb.auth.getSession();
  var actor   = session?.data?.session?.user?.email || 'admin';

  var payload = {
    customer_name:  QUOT_STATE.header.customer_name.trim(),
    contact_person: QUOT_STATE.header.contact_person || null,
    contact_number: QUOT_STATE.header.contact_number || null,
    email:          QUOT_STATE.header.email          || null,
    address:        QUOT_STATE.header.address        || null,
    notes:          QUOT_STATE.header.notes          || null,
    status:         QUOT_STATE.header.status         || 'Draft',
    valid_until:    QUOT_STATE.header.valid_until    || null,
    subtotal:       subtotal,
    tax_amount:     tax,
    total:          total,
    updated_at:     new Date().toISOString(),
    created_by:     actor
  };

  var savedId = QUOT_STATE.editingId;
  if (!savedId){
    // New: allocate a quotation number, then insert.
    var nr = await sb.rpc('next_quotation_number');
    var num = (nr && nr.data) ? nr.data : ('Q-' + Date.now().toString(36).toUpperCase());
    payload.quotation_number = num;
    var ins = await sb.from('salesweb_quotations').insert([payload]).select().single();
    if (ins.error){ toast('Save failed: '+ins.error.message,'error'); return; }
    savedId = ins.data.id;
  } else {
    var upd = await sb.from('salesweb_quotations').update(payload).eq('id', savedId);
    if (upd.error){ toast('Save failed: '+upd.error.message,'error'); return; }
    // Wipe existing items so we can reinsert the freshly-edited set.
    await sb.from('salesweb_quotation_items').delete().eq('quotation_id', savedId);
  }

  var itemRows = QUOT_STATE.items
    .filter(function(it){ return (it.product_name||'').trim() && (Number(it.quantity)||0) > 0; })
    .map(function(it, i){
      return {
        quotation_id:  savedId,
        product_name:  it.product_name.trim(),
        quantity:      Number(it.quantity)||0,
        unit_price:    Number(it.unit_price)||0,
        line_subtotal: (Number(it.quantity)||0) * (Number(it.unit_price)||0),
        sort_order:    i
      };
    });
  if (itemRows.length){
    var ii = await sb.from('salesweb_quotation_items').insert(itemRows);
    if (ii.error){ toast('Items save failed: '+ii.error.message,'error'); return; }
  }

  toast('Quotation saved');
  QUOT_STATE.editingId = savedId;
  closeModal('modal-quotation');
  loadQuotations();
}
window.saveQuotation = saveQuotation;

async function saveAndPrintQuotation(){
  var wasNew = !QUOT_STATE.editingId;
  await saveQuotation();
  if (QUOT_STATE.editingId){
    // Small delay so the modal-close animation doesn't fight the print
    // dialog, and so a brand-new row's items are guaranteed fetched.
    setTimeout(function(){ printQuotation(QUOT_STATE.editingId); }, wasNew ? 400 : 200);
  }
}
window.saveAndPrintQuotation = saveAndPrintQuotation;

async function deleteQuotation(id){
  if (!confirm('Delete this quotation? This cannot be undone.')) return;
  var { error } = await sb.from('salesweb_quotations').delete().eq('id', id);
  if (error){ toast('Delete failed: '+error.message,'error'); return; }
  toast('Quotation deleted');
  loadQuotations();
}
window.deleteQuotation = deleteQuotation;

// ═══════════════════════════════════════
//  PDF — browser print in a fresh window
// ═══════════════════════════════════════
// Pops a purpose-built HTML page in a new window and triggers the
// browser's print dialog. The customer / admin can Save as PDF from
// there — no external PDF library needed.
async function printQuotation(id){
  var { data: q } = await sb.from('salesweb_quotations').select('*').eq('id', id).single();
  var { data: items } = await sb.from('salesweb_quotation_items').select('*').eq('quotation_id', id).order('sort_order',{ascending:true});
  if (!q){ toast('Quotation not found','error'); return; }

  var esc2 = function(s){
    return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  };
  var itemRowsHtml = (items||[]).map(function(it, i){
    var lineTotal = (Number(it.quantity)||0)*(Number(it.unit_price)||0);
    return '<tr>'+
      '<td style="text-align:center;">'+(i+1)+'</td>'+
      '<td>'+esc2(it.product_name)+'</td>'+
      '<td style="text-align:right;">'+(Number(it.quantity)||0).toLocaleString('en-MY')+'</td>'+
      '<td style="text-align:right;">RM '+_fmtQMYR(it.unit_price)+'</td>'+
      '<td style="text-align:right;">RM '+_fmtQMYR(lineTotal)+'</td>'+
    '</tr>';
  }).join('');

  var subtotal = Number(q.subtotal)||0;
  var tax      = Number(q.tax_amount)||0;
  var total    = Number(q.total)||0;

  var html =
    '<!doctype html><html><head><meta charset="utf-8">'+
    '<title>Quotation '+esc2(q.quotation_number||'')+'</title>'+
    '<style>'+
      '@page { size: A4; margin: 18mm 16mm; }'+
      '*{box-sizing:border-box;}'+
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#222;margin:0;padding:0;font-size:12px;line-height:1.5;}'+
      '.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #2D4A30;margin-bottom:18px;}'+
      '.brand{font-family:"Cormorant Garamond",Georgia,serif;font-size:26px;color:#2D4A30;font-weight:500;letter-spacing:.01em;}'+
      '.brand small{display:block;font-size:11px;color:#666;letter-spacing:.14em;text-transform:uppercase;margin-top:4px;font-family:inherit;}'+
      '.meta{text-align:right;font-size:11px;color:#444;}'+
      '.meta .qn{font-size:18px;color:#2D4A30;font-weight:700;letter-spacing:.02em;}'+
      '.meta .row{margin-top:4px;}'+
      '.title{font-family:"Cormorant Garamond",Georgia,serif;font-size:22px;color:#2D4A30;margin-bottom:10px;}'+
      '.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px;font-size:11.5px;}'+
      '.box{border:1px solid #ddd;border-radius:6px;padding:10px 12px;}'+
      '.box h4{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.08em;margin:0 0 4px;}'+
      '.box strong{font-size:12.5px;color:#222;}'+
      'table{width:100%;border-collapse:collapse;font-size:11.5px;}'+
      'thead th{background:#2D4A30;color:#fff;text-align:left;padding:8px 10px;font-weight:600;font-size:11px;letter-spacing:.02em;}'+
      'thead th:first-child{width:36px;text-align:center;}'+
      'tbody td{padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top;}'+
      'tbody tr:nth-child(even) td{background:#fbfbf7;}'+
      '.totals{margin-top:14px;margin-left:auto;width:280px;font-size:12px;}'+
      '.totals div{display:flex;justify-content:space-between;padding:5px 0;}'+
      '.totals .grand{border-top:2px solid #2D4A30;padding-top:8px;margin-top:6px;font-weight:700;font-size:14px;color:#2D4A30;}'+
      '.notes{margin-top:22px;padding:12px 14px;background:#fbfaf5;border-left:3px solid #C9A84C;border-radius:4px;font-size:11px;color:#555;}'+
      '.notes h4{margin:0 0 6px;font-size:11px;color:#78350f;letter-spacing:.06em;text-transform:uppercase;}'+
      '.footer{margin-top:28px;padding-top:12px;border-top:1px solid #ddd;font-size:10px;color:#888;text-align:center;}'+
      '@media print { .noprint{display:none!important;} }'+
      '.noprint{position:fixed;top:12px;right:12px;background:#2D4A30;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:13px;cursor:pointer;font-family:inherit;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,.2);}'+
    '</style>'+
    '</head><body>'+
      '<button class="noprint" onclick="window.print()">🖨️ Print / Save as PDF</button>'+
      '<div class="hdr">'+
        '<div class="brand">MJM Nursery<small>MPOB Certified Oil Palm Seedlings</small></div>'+
        '<div class="meta">'+
          '<div class="qn">Quotation #'+esc2(q.quotation_number||'')+'</div>'+
          '<div class="row"><strong>Issued:</strong> '+esc2(String(q.created_at||'').substring(0,10))+'</div>'+
          (q.valid_until ? '<div class="row"><strong>Valid Until:</strong> '+esc2(String(q.valid_until).substring(0,10))+'</div>' : '')+
          '<div class="row"><strong>Status:</strong> '+esc2(q.status||'Draft')+'</div>'+
        '</div>'+
      '</div>'+
      '<div class="title">Quotation</div>'+
      '<div class="two-col">'+
        '<div class="box">'+
          '<h4>Prepared For</h4>'+
          '<strong>'+esc2(q.customer_name)+'</strong>'+
          (q.contact_person ? '<div>Attn: '+esc2(q.contact_person)+'</div>' : '')+
          (q.contact_number ? '<div>Tel: '+esc2(q.contact_number)+'</div>' : '')+
          (q.email ? '<div>Email: '+esc2(q.email)+'</div>' : '')+
          (q.address ? '<div style="margin-top:4px;color:#444;">'+esc2(q.address)+'</div>' : '')+
        '</div>'+
        '<div class="box">'+
          '<h4>From</h4>'+
          '<strong>MJM Nursery</strong>'+
          '<div>Niah Land District, Miri</div>'+
          '<div>98000 Sarawak, Malaysia</div>'+
          '<div>+60 11-2933 7889</div>'+
          '<div>mjmnursery.com</div>'+
        '</div>'+
      '</div>'+
      '<table>'+
        '<thead><tr><th>#</th><th>Product / Description</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Unit Price</th><th style="text-align:right;">Line Total</th></tr></thead>'+
        '<tbody>'+(itemRowsHtml||'<tr><td colspan="5" style="text-align:center;color:#888;padding:20px;">No line items</td></tr>')+'</tbody>'+
      '</table>'+
      '<div class="totals">'+
        '<div><span>Subtotal</span><span>RM '+_fmtQMYR(subtotal)+'</span></div>'+
        (tax > 0 ? '<div><span>Tax</span><span>RM '+_fmtQMYR(tax)+'</span></div>' : '')+
        '<div class="grand"><span>Total</span><span>RM '+_fmtQMYR(total)+'</span></div>'+
      '</div>'+
      (q.notes ? '<div class="notes"><h4>Notes / Terms</h4>'+esc2(q.notes).replace(/\n/g,'<br>')+'</div>' : '')+
      '<div class="footer">This quotation is generated by MJM Nursery Admin Portal.</div>'+
      '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},400);});<\/script>'+
    '</body></html>';

  var w = window.open('', '_blank');
  if (!w){ toast('Allow pop-ups to download the PDF','error'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
window.printQuotation = printQuotation;
