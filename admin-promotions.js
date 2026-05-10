/*
═══════════════════════════════════════════════════
  ADMIN — PROMOTIONS MANAGEMENT
  ⚠️ AI: This file handles promo CRUD.
  Depends on: sb, toast(), esc(), openModal(), closeModal()

  LINE MAP:
  12      loadPromos() — fetch + render promotions table
  30      openPromoForm() — open add/edit modal
  44      editPromo() — fetch and open form
  47      savePromo() — insert or update promotion
═══════════════════════════════════════════════════
*/

async function loadPromos(){
  var{data,error}=await sb.from('salesweb_promotions').select('*').order('created_at',{ascending:false});
  if(error){toast('Error: '+error.message,'error');return;}
  var promos=data||[];
  if(!promos.length){document.getElementById('promos-table').innerHTML='<div class="loading">No promotions</div>';return;}
  var today=new Date().toISOString().split('T')[0];
  var html='<table class="data-table"><thead><tr><th>Title</th><th>Discount</th><th>Target</th><th>Period</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
  promos.forEach(function(p){
    var isExpired=p.end_date&&p.end_date<today;
    var statusBdg=!p.is_active?'badge-grey':isExpired?'badge-red':'badge-green';
    var statusTxt=!p.is_active?'Inactive':isExpired?'Expired':'Active';
    html+='<tr><td style="font-weight:600;">'+esc(p.title)+'</td><td>'+(p.discount_type==='percentage'?p.discount_value+'%':'RM '+p.discount_value)+'</td><td>'+esc(p.target||'all')+'</td><td style="font-size:11px;">'+(p.start_date||'—')+' → '+(p.end_date||'—')+'</td><td><span class="badge '+statusBdg+'">'+statusTxt+'</span></td><td><button class="btn btn-outline btn-sm" onclick="editPromo(\''+p.id+'\')">Edit</button></td></tr>';
  });
  html+='</tbody></table>';
  document.getElementById('promos-table').innerHTML=html;
}

function openPromoForm(p){
  document.getElementById('mpr-title').textContent=p?'Edit Promotion':'New Promotion';
  document.getElementById('mpr-id').value=p?p.id:'';
  document.getElementById('mpr-name').value=p?p.title:'';
  document.getElementById('mpr-desc').value=p?p.description||'':'';
  document.getElementById('mpr-dtype').value=p?p.discount_type:'percentage';
  document.getElementById('mpr-dval').value=p?p.discount_value:'';
  document.getElementById('mpr-target').value=p?p.target:'all';
  document.getElementById('mpr-tdetail').value=p?p.target_detail||'':'';
  document.getElementById('mpr-start').value=p?p.start_date||'':'';
  document.getElementById('mpr-end').value=p?p.end_date||'':'';
  document.getElementById('mpr-active').checked=p?p.is_active:true;
  openModal('modal-promo');
}

async function editPromo(id){var{data}=await sb.from('salesweb_promotions').select('*').eq('id',id).single();if(data)openPromoForm(data);}

async function savePromo(){
  var id=document.getElementById('mpr-id').value;
  var row={title:document.getElementById('mpr-name').value.trim(),description:document.getElementById('mpr-desc').value.trim(),discount_type:document.getElementById('mpr-dtype').value,discount_value:parseFloat(document.getElementById('mpr-dval').value)||0,target:document.getElementById('mpr-target').value,target_detail:document.getElementById('mpr-tdetail').value.trim(),start_date:document.getElementById('mpr-start').value||null,end_date:document.getElementById('mpr-end').value||null,is_active:document.getElementById('mpr-active').checked};
  if(!row.title){toast('Title required','error');return;}
  var{error}=id?await sb.from('salesweb_promotions').update(row).eq('id',id):await sb.from('salesweb_promotions').insert([row]);
  if(error){toast('Error: '+error.message,'error');return;}
  toast(id?'Promotion updated':'Promotion created');closeModal('modal-promo');loadPromos();
}
