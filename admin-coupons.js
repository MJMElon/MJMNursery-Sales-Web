/*
═══════════════════════════════════════════════════
  ADMIN — COUPONS MANAGEMENT
  ⚠️ AI: This file handles coupon code CRUD.
  Depends on: sb, toast(), esc(), openModal(), closeModal()

  LINE MAP:
  12      loadCoupons() — fetch + render coupons table
  32      openCouponForm() — open add/edit modal
  44      editCoupon() — fetch and open form
  47      saveCoupon() — insert or update coupon
  55      toggleCoupon() — activate/deactivate
═══════════════════════════════════════════════════
*/

async function loadCoupons(){
  var q=(document.getElementById('coupon-search').value||'').trim().toLowerCase();
  var{data,error}=await sb.from('salesweb_coupons').select('*').order('created_at',{ascending:false});
  if(error){toast('Error: '+error.message,'error');return;}
  var coupons=data||[];
  if(q)coupons=coupons.filter(function(c){return(c.code||'').toLowerCase().includes(q);});

  if(!coupons.length){document.getElementById('coupons-table').innerHTML='<div class="loading">No coupons found</div>';return;}
  var html='<table class="data-table"><thead><tr><th>Code</th><th>Discount</th><th>Min Order</th><th>Usage</th><th>Expiry</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
  coupons.forEach(function(c){
    var expired=c.expiry_date&&c.expiry_date<new Date().toISOString().split('T')[0];
    var bdg=!c.is_active?'badge-grey':expired?'badge-red':'badge-green';
    var st=!c.is_active?'Inactive':expired?'Expired':'Active';
    html+='<tr><td style="font-weight:700;font-family:monospace;letter-spacing:.05em;">'+esc(c.code)+'</td><td>'+(c.discount_type==='percentage'?c.discount_value+'%':'RM '+c.discount_value)+'</td><td>RM '+(c.min_order_value||0).toFixed(2)+'</td><td>'+c.usage_count+'/'+(c.usage_limit||'∞')+'</td><td>'+(c.expiry_date||'No expiry')+'</td><td><span class="badge '+bdg+'">'+st+'</span></td><td><button class="btn btn-outline btn-sm" onclick="editCoupon(\''+c.id+'\')">Edit</button> <button class="btn btn-outline btn-sm" onclick="toggleCoupon(\''+c.id+'\','+!c.is_active+')" style="color:'+(c.is_active?'var(--red)':'var(--green)')+';">'+(c.is_active?'Off':'On')+'</button></td></tr>';
  });
  html+='</tbody></table>';
  document.getElementById('coupons-table').innerHTML=html;
}

function openCouponForm(c){
  document.getElementById('mc-title').textContent=c?'Edit Coupon':'New Coupon';
  document.getElementById('mc-id').value=c?c.id:'';
  document.getElementById('mc-code').value=c?c.code:'';
  document.getElementById('mc-dtype').value=c?c.discount_type:'percentage';
  document.getElementById('mc-dval').value=c?c.discount_value:'';
  document.getElementById('mc-min').value=c?c.min_order_value:0;
  document.getElementById('mc-limit').value=c?c.usage_limit:0;
  document.getElementById('mc-expiry').value=c?c.expiry_date||'':'';
  document.getElementById('mc-active').checked=c?c.is_active:true;
  openModal('modal-coupon');
}

async function editCoupon(id){var{data}=await sb.from('salesweb_coupons').select('*').eq('id',id).single();if(data)openCouponForm(data);}

async function saveCoupon(){
  var id=document.getElementById('mc-id').value;
  var row={code:document.getElementById('mc-code').value.trim().toUpperCase(),discount_type:document.getElementById('mc-dtype').value,discount_value:parseFloat(document.getElementById('mc-dval').value)||0,min_order_value:parseFloat(document.getElementById('mc-min').value)||0,usage_limit:parseInt(document.getElementById('mc-limit').value)||0,expiry_date:document.getElementById('mc-expiry').value||null,is_active:document.getElementById('mc-active').checked};
  if(!row.code){toast('Coupon code required','error');return;}
  var{error}=id?await sb.from('salesweb_coupons').update(row).eq('id',id):await sb.from('salesweb_coupons').insert([row]);
  if(error){toast('Error: '+error.message,'error');return;}
  toast(id?'Coupon updated':'Coupon created');closeModal('modal-coupon');loadCoupons();
}

async function toggleCoupon(id,active){
  await sb.from('salesweb_coupons').update({is_active:active}).eq('id',id);
  toast(active?'Coupon activated':'Coupon deactivated');loadCoupons();
}
