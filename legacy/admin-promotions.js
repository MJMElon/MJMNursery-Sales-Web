/*
═══════════════════════════════════════════════════
  ADMIN — PROMOTIONS MANAGEMENT
  ⚠️ AI: Promotion CRUD + AI chat builder + live preview.

  Two ways to build a promotion:
    1. ✨ AI Builder (openPromoAssistant) — chat with Claude, see live
       preview, click Publish. Calls the 'promotion-assistant' Edge Fn.
    2. + Manual Entry (openPromoForm) — traditional form for power users.

  PUBLIC FUNCTIONS:
    loadPromos()              — list + filter chips
    setPromoFilter(s)         — chip click handler
    openPromoForm(p)          — manual create/edit modal
    savePromo()               — insert/update from manual form
    editPromo(id)             — fetch + open manual form
    togglePromoTargetFields() — show/hide cat/product inputs

    openPromoAssistant()      — open chat modal
    closePromoAssistant()
    sendPromoMessage()        — chat send button
    publishPromoDraft()       — write the AI draft to DB as 'live'
    discardPromoDraft()       — clear preview, keep chat
═══════════════════════════════════════════════════
*/

var promoFilterStatus='';
var promoProductsCache=null;
var paMessages=[];          // [{role, content}]
var paCurrentDraft=null;
var paBusy=false;

function setPromoFilter(s){
  promoFilterStatus=s;
  document.querySelectorAll('[data-promo-status]').forEach(function(el){
    el.classList.toggle('active',el.getAttribute('data-promo-status')===s);
  });
  loadPromos();
}

function promoStatusOf(p,today){
  if(p.status) return p.status;
  // Legacy rows without status column — derive on the fly
  if(!p.is_active) return 'archived';
  if(p.end_date && p.end_date < today) return 'ended';
  if(p.start_date && p.start_date > today) return 'scheduled';
  return 'live';
}

async function loadPromos(){
  var{data,error}=await sb.from('salesweb_promotions').select('*').order('created_at',{ascending:false});
  if(error){toast('Error: '+error.message,'error');return;}
  var promos=data||[];
  var today=new Date().toISOString().split('T')[0];
  promos.forEach(function(p){p._status=promoStatusOf(p,today);});
  if(promoFilterStatus) promos=promos.filter(function(p){return p._status===promoFilterStatus;});

  if(!promos.length){
    document.getElementById('promos-table').innerHTML='<div class="loading">No promotions match this filter</div>';
    return;
  }

  var html='<table class="data-table"><thead><tr>'
    +'<th>Title</th><th>Banner</th><th>Discount</th><th>Target</th>'
    +'<th>Period</th><th>Status</th><th>Actions</th>'
    +'</tr></thead><tbody>';
  promos.forEach(function(p){
    var st=p._status;
    var bdg={live:'badge-green',scheduled:'badge-blue',draft:'badge-grey',ended:'badge-red',archived:'badge-grey'}[st]||'badge-grey';
    var stLabel=st.charAt(0).toUpperCase()+st.slice(1);
    var disc=p.discount_type==='percentage'?(p.discount_value+'%'):('RM '+p.discount_value);
    var target=p.target==='specific'?'Products ('+(p.target_product_ids||[]).length+')'
              :p.target==='category'?'Cats: '+((p.target_categories||[]).join(', ')||p.target_detail||'?')
              :'All';
    var bannerPreview=p.banner_text
      ? '<span style="font-size:11px;background:var(--bg);padding:3px 8px;border-radius:6px;">'+(p.banner_emoji||'')+' '+esc(p.banner_text.substring(0,30))+(p.banner_text.length>30?'…':'')+'</span>'
      : '<span style="color:var(--ink4);font-size:11px;">—</span>';
    html+='<tr>'
      +'<td style="font-weight:600;">'+esc(p.title||'(untitled)')+'</td>'
      +'<td>'+bannerPreview+'</td>'
      +'<td>'+disc+'</td>'
      +'<td style="font-size:11px;">'+esc(target)+'</td>'
      +'<td style="font-size:11px;">'+(p.start_date||'—')+' → '+(p.end_date||'—')+'</td>'
      +'<td><span class="badge '+bdg+'">'+stLabel+'</span></td>'
      +'<td><button class="btn btn-outline btn-sm" onclick="editPromo(\''+p.id+'\')">Edit</button></td>'
      +'</tr>';
  });
  html+='</tbody></table>';
  document.getElementById('promos-table').innerHTML=html;
}

async function loadPromoProductsCache(){
  if(promoProductsCache) return promoProductsCache;
  var{data}=await sb.from('salesweb_products').select('id,name,category,product_type,price').order('name');
  promoProductsCache=data||[];
  return promoProductsCache;
}

function togglePromoTargetFields(){
  var v=document.getElementById('mpr-target').value;
  document.getElementById('mpr-target-cats').style.display=v==='category'?'block':'none';
  document.getElementById('mpr-target-prods').style.display=v==='specific'?'block':'none';
}

async function openPromoForm(p){
  var prods=await loadPromoProductsCache();
  var sel=document.getElementById('mpr-tprods');
  sel.innerHTML=prods.map(function(pp){return '<option value="'+pp.id+'">'+esc(pp.name)+'</option>';}).join('');

  document.getElementById('mpr-title').textContent=p?'Edit Promotion':'New Promotion';
  document.getElementById('mpr-id').value=p?p.id:'';
  document.getElementById('mpr-name').value=p?p.title||'':'';
  document.getElementById('mpr-status').value=p&&p.status?p.status:'draft';
  document.getElementById('mpr-desc').value=p?p.description||'':'';
  document.getElementById('mpr-banner').value=p&&p.banner_text?p.banner_text:'';
  document.getElementById('mpr-banner-emoji').value=p&&p.banner_emoji?p.banner_emoji:'🎁';
  document.getElementById('mpr-banner-color').value=p&&p.banner_color?p.banner_color:'green';
  document.getElementById('mpr-dtype').value=p?p.discount_type:'percentage';
  document.getElementById('mpr-dval').value=p?p.discount_value:'';
  document.getElementById('mpr-maxdisc').value=p&&p.max_discount?p.max_discount:0;
  document.getElementById('mpr-minorder').value=p&&p.min_order_value?p.min_order_value:0;
  document.getElementById('mpr-target').value=p?p.target:'all';
  document.getElementById('mpr-tcats').value=p&&p.target_categories?(p.target_categories||[]).join(', ')
                                  :p&&p.target_detail?p.target_detail:'';
  Array.from(sel.options).forEach(function(o){
    o.selected=p&&p.target_product_ids?p.target_product_ids.indexOf(o.value)>=0:false;
  });
  document.getElementById('mpr-start').value=p?p.start_date||'':'';
  document.getElementById('mpr-end').value=p?p.end_date||'':'';
  document.getElementById('mpr-priority').value=p&&p.priority?p.priority:0;
  document.getElementById('mpr-active').checked=p?p.is_active!==false:true;
  togglePromoTargetFields();
  openModal('modal-promo');
}

async function editPromo(id){
  var{data}=await sb.from('salesweb_promotions').select('*').eq('id',id).single();
  if(data) openPromoForm(data);
}

async function savePromo(){
  var id=document.getElementById('mpr-id').value;
  var target=document.getElementById('mpr-target').value;
  var sel=document.getElementById('mpr-tprods');
  var prodIds=Array.from(sel.selectedOptions).map(function(o){return o.value;});
  var cats=(document.getElementById('mpr-tcats').value||'').split(',').map(function(s){return s.trim();}).filter(Boolean);

  var row={
    title:document.getElementById('mpr-name').value.trim(),
    description:document.getElementById('mpr-desc').value.trim()||null,
    banner_text:document.getElementById('mpr-banner').value.trim()||null,
    banner_emoji:document.getElementById('mpr-banner-emoji').value.trim()||null,
    banner_color:document.getElementById('mpr-banner-color').value,
    discount_type:document.getElementById('mpr-dtype').value,
    discount_value:parseFloat(document.getElementById('mpr-dval').value)||0,
    max_discount:parseFloat(document.getElementById('mpr-maxdisc').value)||0,
    min_order_value:parseFloat(document.getElementById('mpr-minorder').value)||0,
    target:target,
    target_detail:cats.join(', ')||null,         // legacy column kept in sync
    target_categories:target==='category'?cats:[],
    target_product_ids:target==='specific'?prodIds:[],
    start_date:document.getElementById('mpr-start').value||null,
    end_date:document.getElementById('mpr-end').value||null,
    priority:parseInt(document.getElementById('mpr-priority').value)||0,
    status:document.getElementById('mpr-status').value,
    is_active:document.getElementById('mpr-active').checked
  };
  if(!row.title){toast('Title required','error');return;}

  var legacyRow={
    title:row.title,description:row.description,
    discount_type:row.discount_type,discount_value:row.discount_value,
    target:row.target,target_detail:row.target_detail,
    start_date:row.start_date,end_date:row.end_date,is_active:row.is_active
  };

  var{error}=id?await sb.from('salesweb_promotions').update(row).eq('id',id)
                :await sb.from('salesweb_promotions').insert([row]);
  if(error&&/column .* does not exist|schema cache/i.test(error.message||'')){
    console.warn('Falling back to legacy promo columns:',error.message);
    var r2=id?await sb.from('salesweb_promotions').update(legacyRow).eq('id',id)
              :await sb.from('salesweb_promotions').insert([legacyRow]);
    if(r2.error){toast('Error: '+r2.error.message,'error');return;}
    toast((id?'Updated':'Created')+' (run SQL migration to enable new fields)','error');
  } else if(error){
    toast('Error: '+error.message,'error');return;
  } else {
    toast(id?'Promotion updated':'Promotion created');
  }
  closeModal('modal-promo');loadPromos();
}

// ═══════════════════════════════════════════════════
//  AI PROMOTION ASSISTANT
// ═══════════════════════════════════════════════════
function openPromoAssistant(){
  paMessages=[];
  paCurrentDraft=null;
  document.getElementById('pa-log').innerHTML='';
  document.getElementById('pa-preview').innerHTML='<div class="promo-preview-empty">Describe your promotion in the chat — a preview will appear here as the assistant drafts it.</div>';
  document.getElementById('pa-preview-foot').style.display='none';
  document.getElementById('pa-input').value='';
  appendPromoMsg('system','Hi! Tell me what kind of promotion you want to run. I\'ll draft it and show you a preview.');
  openModal('modal-promo-assistant');
  setTimeout(function(){document.getElementById('pa-input').focus();},120);
}

function closePromoAssistant(){
  closeModal('modal-promo-assistant');
}

function appendPromoMsg(role,content){
  var log=document.getElementById('pa-log');
  var div=document.createElement('div');
  div.className='promo-chat-msg '+role;
  div.textContent=content;
  log.appendChild(div);
  log.scrollTop=log.scrollHeight;
}

function appendPromoTyping(){
  var log=document.getElementById('pa-log');
  var div=document.createElement('div');
  div.className='promo-chat-msg assistant';
  div.id='pa-typing';
  div.innerHTML='<span class="promo-typing"><span></span><span></span><span></span></span>';
  log.appendChild(div);
  log.scrollTop=log.scrollHeight;
}

function removePromoTyping(){
  var t=document.getElementById('pa-typing');
  if(t) t.remove();
}

async function sendPromoMessage(){
  if(paBusy) return;
  var input=document.getElementById('pa-input');
  var text=(input.value||'').trim();
  if(!text) return;
  input.value='';
  appendPromoMsg('user',text);
  paMessages.push({role:'user',content:text});

  paBusy=true;
  document.getElementById('pa-send').disabled=true;
  appendPromoTyping();

  // Build a small catalog snapshot to ground the model
  var prods=await loadPromoProductsCache();
  var categories=[];var seen={};
  prods.forEach(function(p){var c=p.category||p.product_type;if(c&&!seen[c]){seen[c]=1;categories.push(c);}});
  var catalog={
    categories:categories,
    products:prods.slice(0,60).map(function(p){return{id:p.id,name:p.name,category:p.category||p.product_type,price:p.price};})
  };

  try{
    var{data,error}=await sb.functions.invoke('promotion-assistant',{
      body:{messages:paMessages,catalog:catalog}
    });
    removePromoTyping();
    if(error){
      console.error('promotion-assistant error:',error);
      appendPromoMsg('assistant','Sorry — the assistant is unavailable.\n\n'+
        'Check that the Edge Function is deployed and ANTHROPIC_API_KEY is set:\n'+
        '  supabase functions deploy promotion-assistant --no-verify-jwt\n'+
        '  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...\n\n'+
        'Details: '+(error.message||error));
    } else {
      var reply=(data&&data.reply)||'';
      var draft=data&&data.draft;
      if(reply) appendPromoMsg('assistant',reply);
      paMessages.push({role:'assistant',content:reply||'(no reply)'});
      if(draft){
        paCurrentDraft=draft;
        renderPromoPreview(draft);
        document.getElementById('pa-preview-foot').style.display='flex';
      }
    }
  }catch(e){
    removePromoTyping();
    appendPromoMsg('assistant','Network error talking to the assistant: '+(e.message||e));
  } finally {
    paBusy=false;
    document.getElementById('pa-send').disabled=false;
    document.getElementById('pa-input').focus();
  }
}

function renderPromoPreview(d){
  var box=document.getElementById('pa-preview');
  if(!d){box.innerHTML='<div class="promo-preview-empty">No draft yet.</div>';return;}
  var color=(d.banner_color||'green').toLowerCase();
  var emoji=d.banner_emoji||'🎁';
  var bannerText=esc(d.banner_text||d.title||'Promotion');

  // Sample product card with strike-through
  var sampleProd=(promoProductsCache||[])[0];
  var sampleHtml='';
  if(sampleProd){
    var origPrice=Number(sampleProd.price||25);
    var disc=d.discount_type==='percentage'
      ? Math.min(origPrice*(d.discount_value/100), d.max_discount>0?d.max_discount:1e9)
      : Math.min(d.discount_value||0, origPrice);
    var newPrice=Math.max(0,origPrice-disc);
    sampleHtml='<div class="promo-prod-card">'
      +'<div style="font-size:10px;font-weight:700;color:var(--ink4);letter-spacing:.06em;text-transform:uppercase;margin-bottom:.3rem;">Sample Product Card</div>'
      +'<div class="promo-prod-name">'+esc(sampleProd.name)+'</div>'
      +'<div><span class="promo-prod-strike">RM '+origPrice.toFixed(2)+'</span><span class="promo-prod-price">RM '+newPrice.toFixed(2)+'</span></div>'
      +'</div>';
  }

  var period=(d.start_date||'today')+' → '+(d.end_date||'no end');
  var targetText=d.target==='all'?'All products'
    :d.target==='category'?'Categories: '+((d.target_categories||[]).join(', ')||'—')
    :'Specific products: '+((d.target_product_ids||[]).length||0)+' selected';
  var discText=d.discount_type==='percentage'?(d.discount_value+'% off'):('RM '+d.discount_value+' off');
  if(d.max_discount>0) discText+=' (max RM '+d.max_discount+')';
  if(d.min_order_value>0) discText+=' · min order RM '+d.min_order_value;

  box.innerHTML=
    '<div class="promo-banner '+color+'"><span style="font-size:18px;">'+emoji+'</span><span>'+bannerText+'</span></div>'
    +sampleHtml
    +'<dl class="promo-meta-grid">'
    +'<dt>Title</dt><dd>'+esc(d.title||'—')+'</dd>'
    +'<dt>Discount</dt><dd>'+esc(discText)+'</dd>'
    +'<dt>Target</dt><dd>'+esc(targetText)+'</dd>'
    +'<dt>Period</dt><dd>'+esc(period)+'</dd>'
    +(d.priority?'<dt>Priority</dt><dd>'+d.priority+'</dd>':'')
    +'</dl>';
}

function discardPromoDraft(){
  paCurrentDraft=null;
  document.getElementById('pa-preview').innerHTML='<div class="promo-preview-empty">Draft discarded. Keep chatting to build a new one.</div>';
  document.getElementById('pa-preview-foot').style.display='none';
}

async function publishPromoDraft(){
  if(!paCurrentDraft){toast('No draft to publish','error');return;}
  var d=paCurrentDraft;
  if(!d.title||!d.banner_text||!d.discount_type||!(d.discount_value>=0)){
    toast('Draft is missing required fields','error');return;
  }
  var btn=document.getElementById('pa-publish');
  btn.disabled=true;btn.textContent='Publishing...';

  // Map the AI draft into the salesweb_promotions schema. status=live so
  // promotions_for_cart() picks it up immediately.
  var row={
    title:d.title,
    description:d.description||null,
    banner_text:d.banner_text,
    banner_emoji:d.banner_emoji||null,
    banner_color:(d.banner_color||'green').toLowerCase(),
    discount_type:d.discount_type,
    discount_value:Number(d.discount_value)||0,
    max_discount:Number(d.max_discount)||0,
    min_order_value:Number(d.min_order_value)||0,
    target:d.target||'all',
    target_categories:Array.isArray(d.target_categories)?d.target_categories:[],
    target_product_ids:Array.isArray(d.target_product_ids)?d.target_product_ids:[],
    target_detail:Array.isArray(d.target_categories)&&d.target_categories.length?d.target_categories.join(', '):null,
    start_date:d.start_date||null,
    end_date:d.end_date||null,
    priority:Number(d.priority)||0,
    status:'live',
    is_active:true,
    published_at:new Date().toISOString()
  };

  var{error}=await sb.from('salesweb_promotions').insert([row]);
  btn.disabled=false;btn.textContent='Publish';
  if(error){
    if(/column .* does not exist|schema cache/i.test(error.message||'')){
      toast('Run the SQL migration first (sql/2026_05_promotions_coupons.sql)','error');
    } else {
      toast('Error: '+error.message,'error');
    }
    return;
  }
  toast('Promotion published — live now');
  closePromoAssistant();
  loadPromos();
}
