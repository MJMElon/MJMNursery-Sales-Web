/*
═══════════════════════════════════════════════════
  ADMIN — PRODUCTS MANAGEMENT (v5)
  ⚠️ AI: Live stock ledger with FIFO, DO sold tracking, transfer visibility.

  STOCK SOURCE COLUMNS:
  Batch | Plot | Original Stock | Sold (from DO) | Transferred | Remaining

  Original Stock = transplanted - 10% culling
  Sold = sum of DO qty_1..qty_5 where plot matches
  Transferred = qty moved to/from other products
  Remaining = Original - Sold - TransferredOut + TransferredIn

  TABLES: salesweb_products, shared_inventory_logs, shared_do_records, salesweb_stock_transfers
═══════════════════════════════════════════════════
*/

var CULL_RATE = 0.10;

// ═══════════════════════════════════════
//  LOAD PRODUCTS TABLE
// ═══════════════════════════════════════
async function loadProducts(){
  var q=(document.getElementById('prod-search').value||'').trim().toLowerCase();
  var typeF=document.getElementById('prod-type-filter').value;
  var collF=document.getElementById('prod-coll-filter').value;
  var statusF=document.getElementById('prod-status-filter').value;
  var query=sb.from('salesweb_products').select('*').order('sort_order',{ascending:true,nullsFirst:false}).order('sell_year',{ascending:true}).order('sell_month',{ascending:true});
  if(typeF)query=query.eq('product_type',typeF);
  if(collF)query=query.eq('collection',collF);
  if(statusF==='published')query=query.eq('is_published',true);
  if(statusF==='unpublished')query=query.eq('is_published',false);
  var{data,error}=await query;
  // Fallback if sort_order column doesn't exist
  if(error){
    query=sb.from('salesweb_products').select('*').order('sell_year',{ascending:true}).order('sell_month',{ascending:true});
    if(typeF)query=query.eq('product_type',typeF);
    if(collF)query=query.eq('collection',collF);
    if(statusF==='published')query=query.eq('is_published',true);
    if(statusF==='unpublished')query=query.eq('is_published',false);
    var res=await query;data=res.data;error=res.error;
  }
  if(error){toast('Error: '+error.message,'error');return;}
  var prods=data||[];
  if(q)prods=prods.filter(function(p){return(p.name||'').toLowerCase().includes(q)||(p.sell_month||'').toLowerCase().includes(q);});
  var all=data||[];
  var totalStock=all.reduce(function(s,p){return s+(p.stock_qty||0);},0);
  var published=all.filter(function(p){return p.is_published;}).length;
  document.getElementById('prod-stats').innerHTML=
    '<div class="stat-box"><div class="stat-label">Total Products</div><div class="stat-val">'+all.length+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Published</div><div class="stat-val green">'+published+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Unpublished</div><div class="stat-val" style="color:var(--ink3)">'+(all.length-published)+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Total Stock</div><div class="stat-val">'+totalStock.toLocaleString()+'</div></div>';
  if(!prods.length){document.getElementById('products-table').innerHTML='<div class="loading">No products found</div>';return;}
  // Store for reorder
  window._productsList=prods;
  var html='<table class="data-table" id="products-data-table"><thead><tr><th style="width:36px;" title="Drag to reorder"></th><th style="width:30px;">#</th><th style="width:40px;"></th><th>Product</th><th>Collection</th><th>Sell Month</th><th>Price</th><th>Stock</th><th>Published</th><th>Actions</th></tr></thead><tbody id="products-tbody">';
  prods.forEach(function(p,idx){
    var img=p.image_url?'<img src="'+esc(p.image_url)+'" style="width:36px;height:36px;object-fit:cover;border-radius:6px;">':'<div style="width:36px;height:36px;background:var(--bg);border-radius:6px;display:flex;align-items:center;justify-content:center;">🌱</div>';
    var sell=p.sell_month?(p.sell_month+(p.sell_year?' '+p.sell_year:'')):'—';
    var pr='RM '+(p.price||0).toFixed(2);
    if(p.compare_price&&p.compare_price>p.price)pr='<span style="text-decoration:line-through;color:var(--ink4);font-size:11px;">RM '+p.compare_price.toFixed(2)+'</span> <span style="color:var(--red);font-weight:700;">RM '+(p.price||0).toFixed(2)+'</span>';
    var pub='<label style="position:relative;display:inline-block;width:36px;height:20px;cursor:pointer;"><input type="checkbox" '+(p.is_published?'checked':'')+' onchange="togglePublish(\''+p.id+'\',this.checked)" style="opacity:0;width:0;height:0;"><span style="position:absolute;inset:0;background:'+(p.is_published?'var(--green)':'#ccc')+';border-radius:10px;transition:.2s;"></span><span style="position:absolute;left:'+(p.is_published?'18px':'2px')+';top:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2);"></span></label>';
    var handle='<span class="drag-handle" title="Drag to reorder" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;color:var(--ink4);cursor:grab;font-size:16px;line-height:1;user-select:none;">&#x2630;</span>';
    html+='<tr draggable="true" data-pid="'+p.id+'" data-idx="'+idx+'" ondragstart="onProductDragStart(event)" ondragover="onProductDragOver(event)" ondragleave="onProductDragLeave(event)" ondrop="onProductDrop(event)" ondragend="onProductDragEnd(event)" style="transition:background .15s;"><td style="text-align:center;">'+handle+'</td><td style="font-size:11px;font-weight:700;color:var(--ink4);text-align:center;">'+(idx+1)+'</td><td>'+img+'</td><td style="font-weight:600;">'+esc(p.name)+'</td><td><span class="badge '+(p.collection==='Promotion'?'badge-amber':'badge-grey')+'">'+esc(p.collection||'')+'</span></td><td>'+esc(sell)+'</td><td>'+pr+'</td><td style="font-weight:700;color:'+(p.stock_qty>0?'var(--green)':'var(--red)')+';">'+p.stock_qty+'</td><td>'+pub+'</td><td style="white-space:nowrap;"><button class="btn btn-outline btn-sm" onclick="editProduct(\''+p.id+'\')" >Edit</button> <button class="btn btn-outline btn-sm" onclick="refreshProductStock(\''+p.id+'\')">🔄</button> <button class="btn btn-outline btn-sm" onclick="deleteProduct(\''+p.id+'\')" style="color:var(--red);">✕</button></td></tr>';
  });
  html+='</tbody></table>';
  document.getElementById('products-table').innerHTML=html;
}

// ═══════════════════════════════════════
//  COMPUTE STOCK — FULL LEDGER
// ═══════════════════════════════════════
async function computeProductStock(productId, sellMonth, sellYear){
  var{data:transplants}=await sb.from('shared_inventory_logs').select('batch_name, breed_name, plot_name, quantity_change, created_at, remark')
    .eq('transaction_type','Transplanted').order('created_at',{ascending:true});
  if(!transplants)transplants=[];

  var sources=[];
  transplants.forEach(function(t){
    var pl=(t.plot_name||'').toLowerCase();
    if(pl.includes('premium')||pl.includes('double')||pl.includes('tray'))return;
    var tDate=null;
    if(t.remark){var m=t.remark.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);if(m)tDate=new Date(m[1]);}
    if(!tDate)tDate=new Date(t.created_at);
    var sd=new Date(tDate);sd.setMonth(sd.getMonth()+9);
    if(sd.toLocaleDateString('en-MY',{month:'long'})===sellMonth&&sd.getFullYear()===sellYear){
      var qty=t.quantity_change||0;
      var culled=Math.round(qty*CULL_RATE);
      sources.push({batch:t.batch_name,breed:t.breed_name,plot:t.plot_name,transplanted:qty,culled:culled,originalStock:qty-culled,sold:0,transferredOut:0,transferredIn:0,remaining:qty-culled,date:tDate.toISOString().split('T')[0]});
    }
  });

  var{data:dos}=await sb.from('shared_do_records').select('*').neq('status','Cancelled');
  if(dos&&dos.length){
    dos.forEach(function(d){
      for(var i=1;i<=5;i++){
        var doPlot=d['plot_'+i];var doQty=parseInt(d['qty_'+i])||0;
        if(!doPlot||!doQty)continue;
        sources.forEach(function(src){
          if(src.plot===doPlot&&src.sold<src.originalStock){
            var deduct=Math.min(doQty,src.originalStock-src.sold);
            src.sold+=deduct;
            doQty-=deduct;
          }
        });
      }
    });
  }

  var{data:tOut}=await sb.from('salesweb_stock_transfers').select('quantity,reason,created_at,to_product').eq('from_product',productId).order('created_at',{ascending:true});
  var{data:tIn}=await sb.from('salesweb_stock_transfers').select('quantity,reason,created_at,from_product').eq('to_product',productId).order('created_at',{ascending:true});
  tOut=tOut||[];tIn=tIn||[];

  var tIds=[];
  tOut.forEach(function(t){if(t.to_product&&tIds.indexOf(t.to_product)===-1)tIds.push(t.to_product);});
  tIn.forEach(function(t){if(t.from_product&&tIds.indexOf(t.from_product)===-1)tIds.push(t.from_product);});
  var tNames={};
  if(tIds.length){var{data:ps}=await sb.from('salesweb_products').select('id,name').in('id',tIds);(ps||[]).forEach(function(p){tNames[p.id]=p.name;});}

  var totalTransferOut=0;
  var transferOutDetails=[];
  tOut.forEach(function(tr){
    var remain=tr.quantity;totalTransferOut+=remain;
    transferOutDetails.push({qty:tr.quantity,to:tNames[tr.to_product]||'—',reason:tr.reason||'',date:tr.created_at});
    for(var i=0;i<sources.length&&remain>0;i++){
      var avail=sources[i].originalStock-sources[i].sold-sources[i].transferredOut;
      var deduct=Math.min(avail,remain);
      sources[i].transferredOut+=deduct;remain-=deduct;
    }
  });

  var totalTransferIn=0;
  var transferInDetails=[];
  tIn.forEach(function(tr){
    totalTransferIn+=tr.quantity;
    transferInDetails.push({qty:tr.quantity,from:tNames[tr.from_product]||'—',reason:tr.reason||'',date:tr.created_at});
  });

  sources.forEach(function(src){src.remaining=Math.max(0,src.originalStock-src.sold-src.transferredOut);});
  var baseStock=sources.reduce(function(s,src){return s+src.remaining;},0);
  var totalSold=sources.reduce(function(s,src){return s+src.sold;},0);
  var finalStock=baseStock+totalTransferIn;

  return {sources:sources,baseStock:baseStock,totalSold:totalSold,transferOut:totalTransferOut,transferOutDetails:transferOutDetails,transferIn:totalTransferIn,transferInDetails:transferInDetails,finalStock:finalStock};
}

// ═══════════════════════════════════════
//  RENDER STOCK SOURCE (collapsible)
// ═══════════════════════════════════════
function renderStockSource(d){
  if(!d||!d.sources.length)return '<div style="font-size:12px;color:var(--ink4);">No batch data</div>';
  var html='<div style="margin-top:.6rem;">';

  html+='<div onclick="var n=this.nextElementSibling;n.style.display=n.style.display===\'none\'?\'block\':\'none\';this.querySelector(\'span\').textContent=n.style.display===\'none\'?\'▶\':\'▼\'" style="cursor:pointer;display:flex;align-items:center;gap:.4rem;padding:.5rem 0;font-size:13px;font-weight:600;color:var(--ink);user-select:none;"><span>▶</span> Stock Sources</div>';
  html+='<div style="display:none;">';

  html+='<table style="width:100%;font-size:12px;border-collapse:collapse;"><thead><tr style="border-bottom:1.5px solid var(--border);"><th style="text-align:left;padding:6px 8px;font-weight:600;color:var(--ink3);">Maturity</th><th style="text-align:left;padding:6px 8px;font-weight:600;color:var(--ink3);">Batch</th><th style="text-align:left;padding:6px 8px;font-weight:600;color:var(--ink3);">Plot</th><th style="text-align:right;padding:6px 8px;font-weight:600;color:var(--ink3);">Original</th><th style="text-align:right;padding:6px 8px;font-weight:600;color:var(--ink3);">Sold</th><th style="text-align:right;padding:6px 8px;font-weight:600;color:var(--ink3);">Remaining</th></tr></thead><tbody>';
  d.sources.forEach(function(s){
    var matStr='—',tpStr='';
    if(s.date){
      var tp=new Date(s.date);
      tpStr=tp.toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'});
      var mat=new Date(s.date);mat.setMonth(mat.getMonth()+9);
      matStr=mat.toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'});
    }
    html+='<tr style="border-bottom:1px solid #f0f2f0;">'+
      '<td style="padding:6px 8px;font-weight:500;" title="Transplanted: '+esc(tpStr)+'">'+esc(matStr)+'</td>'+
      '<td style="padding:6px 8px;font-weight:500;">'+esc(s.batch||'—')+'</td>'+
      '<td style="padding:6px 8px;font-weight:400;">'+esc(s.plot||'—')+'</td>'+
      '<td style="padding:6px 8px;text-align:right;font-weight:500;">'+s.originalStock+'</td>'+
      '<td style="padding:6px 8px;text-align:right;color:'+(s.sold>0?'var(--amber)':'var(--ink4)')+';font-weight:500;">'+(s.sold>0?'-'+s.sold:'0')+'</td>'+
      '<td style="padding:6px 8px;text-align:right;font-weight:600;color:'+(s.remaining>0?'var(--green)':'var(--red)')+';">'+s.remaining+'</td></tr>';
  });
  html+='</tbody></table>';

  html+='<div style="margin-top:.5rem;padding:.6rem .8rem;background:#f8faf8;border-radius:8px;font-size:12px;">';
  html+='<div style="display:flex;justify-content:space-between;padding:.15rem 0;"><span style="color:var(--ink3);font-weight:400;">Original stock (after 10% culling)</span><span style="font-weight:600;">'+d.sources.reduce(function(s,x){return s+x.originalStock;},0)+'</span></div>';
  if(d.totalSold>0)html+='<div style="display:flex;justify-content:space-between;padding:.15rem 0;"><span style="color:var(--amber);font-weight:400;">Sold (DO issued)</span><span style="font-weight:600;color:var(--amber);">-'+d.totalSold+'</span></div>';
  if(d.transferOut>0)html+='<div style="display:flex;justify-content:space-between;padding:.15rem 0;"><span style="color:var(--red);font-weight:400;">Transferred out</span><span style="font-weight:600;color:var(--red);">-'+d.transferOut+'</span></div>';
  if(d.transferIn>0)html+='<div style="display:flex;justify-content:space-between;padding:.15rem 0;"><span style="color:var(--green);font-weight:400;">Transferred in</span><span style="font-weight:600;color:var(--green);">+'+d.transferIn+'</span></div>';
  html+='<div style="display:flex;justify-content:space-between;padding:.4rem 0;border-top:1px solid var(--border);margin-top:.3rem;"><span style="font-weight:600;color:var(--ink);">Available Stock</span><span style="font-weight:700;font-size:14px;color:var(--green);">'+d.finalStock+'</span></div>';
  html+='</div>';
  html+='</div>';

  if(!d.transferOutDetails.length&&!d.transferInDetails.length){
    html+='<div style="margin-top:.6rem;padding:.5rem .8rem;background:#f8f8f8;border-radius:8px;font-size:12px;color:var(--ink4);">No stock transfers for this product</div>';
  }
  if(d.transferOutDetails.length){
    html+='<div style="margin-top:.8rem;padding:.8rem;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;">';
    html+='<div style="font-size:13px;font-weight:600;color:#b91c1c;margin-bottom:.5rem;">Stock Moved Out</div>';
    d.transferOutDetails.forEach(function(t,idx){
      var dt=new Date(t.date).toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'});
      html+='<div style="padding:.5rem 0;'+(idx>0?'border-top:1px solid #fecaca;':'')+'"><div style="display:flex;justify-content:space-between;align-items:center;"><div><span style="font-size:14px;font-weight:600;color:#b91c1c;">−'+t.qty+' seedlings</span></div><span style="font-size:10px;color:var(--ink4);">'+dt+'</span></div><div style="font-size:12px;color:var(--ink2);margin-top:.2rem;"→ Moved to: <span style="font-weight:600;color:var(--ink);">'+esc(t.to)+'</span></div>'+(t.reason?'<div style="font-size:11px;color:var(--ink4);margin-top:.1rem;">Reason: '+esc(t.reason)+'</div>':'')+'</div>';
    });
    html+='</div>';
  }
  if(d.transferInDetails.length){
    html+='<div style="margin-top:.8rem;padding:.8rem;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;">';
    html+='<div style="font-size:13px;font-weight:600;color:#15803d;margin-bottom:.5rem;">Stock Received</div>';
    d.transferInDetails.forEach(function(t,idx){
      var dt=new Date(t.date).toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'});
      html+='<div style="padding:.5rem 0;'+(idx>0?'border-top:1px solid #bbf7d0;':'')+'"><div style="display:flex;justify-content:space-between;align-items:center;"><div><span style="font-size:14px;font-weight:600;color:#15803d;">+'+t.qty+' seedlings</span></div><span style="font-size:10px;color:var(--ink4);">'+dt+'</span></div><div style="font-size:12px;color:var(--ink2);margin-top:.2rem;">← Received from: <span style="font-weight:600;color:var(--ink);">'+esc(t.from)+'</span></div>'+(t.reason?'<div style="font-size:11px;color:var(--ink4);margin-top:.1rem;">Reason: '+esc(t.reason)+'</div>':'')+'</div>';
    });
    html+='</div>';
  }

  html+='</div>';
  return html;
}

// ═══════════════════════════════════════
//  SYNC / REFRESH
// ═══════════════════════════════════════
async function syncProductsFromBatches(){
  toast('Syncing...');
  var{data:transplants}=await sb.from('shared_inventory_logs').select('quantity_change, created_at, remark, plot_name')
    .eq('transaction_type','Transplanted').order('created_at',{ascending:true});
  if(!transplants||!transplants.length){toast('No transplant data','error');return;}
  var mq={};
  transplants.forEach(function(t){
    var pl=(t.plot_name||'').toLowerCase();
    if(pl.includes('premium')||pl.includes('double')||pl.includes('tray'))return;
    var tDate=null;if(t.remark){var m=t.remark.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);if(m)tDate=new Date(m[1]);}
    if(!tDate)tDate=new Date(t.created_at);
    var sd=new Date(tDate);sd.setMonth(sd.getMonth()+9);
    var sm=sd.toLocaleDateString('en-MY',{month:'long'});var sy=sd.getFullYear();
    var key=sm+'|'+sy;var qty=t.quantity_change||0;
    mq[key]=(mq[key]||0)+Math.max(0,qty-Math.round(qty*CULL_RATE));
  });
  var created=0,updated=0;
  for(var k of Object.keys(mq)){
    var parts=k.split('|');var sm=parts[0];var sy=parseInt(parts[1]);
    var{data:ex}=await sb.from('salesweb_products').select('id,stock_source').eq('sell_month',sm).eq('sell_year',sy).eq('product_type','Seedling').limit(1);
    if(!ex||!ex.length){
      var searchName=sm+' '+sy;
      var{data:ex2}=await sb.from('salesweb_products').select('id,stock_source').ilike('name','%'+searchName+'%').limit(1);
      if(ex2&&ex2.length)ex=ex2;
    }
    if(ex&&ex.length){
      if(ex[0].stock_source!=='manual'){var sd=await computeProductStock(ex[0].id,sm,sy);await sb.from('salesweb_products').update({stock_qty:sd.finalStock,sell_month:sm,sell_year:sy,updated_at:new Date().toISOString()}).eq('id',ex[0].id);}
      updated++;
    } else {
      await sb.from('salesweb_products').insert([{name:'Oil Palm Seedling — '+sm+' '+sy,description:'Oil Palm Seedling — '+sm+' '+sy,product_type:'Seedling',collection:'Normal Sales',category:'Seedling',price:25.00,stock_qty:mq[k],sell_month:sm,sell_year:sy,is_active:false,is_published:false,stock_source:'auto'}]);
      created++;
    }
  }
  toast(created+' created, '+updated+' updated');loadProducts();
}

async function refreshProductStock(pid){
  var{data:p}=await sb.from('salesweb_products').select('*').eq('id',pid).single();
  if(!p){toast('Not found','error');return;}
  if(p.stock_source==='manual'){toast('Manual stock');return;}
  var sd=await computeProductStock(pid,p.sell_month,p.sell_year);
  await sb.from('salesweb_products').update({stock_qty:sd.finalStock,updated_at:new Date().toISOString()}).eq('id',pid);
  toast('Stock: '+sd.finalStock);loadProducts();
}

// ═══════════════════════════════════════
//  PRODUCT FORM
// ═══════════════════════════════════════
var currentEditProductId=null;

function openProductForm(p){
  try{if(typeof updateProductFormDropdowns==='function')updateProductFormDropdowns();}catch(e){}
  currentEditProductId=p?p.id:null;
  document.getElementById('mp-title').textContent=p?'Edit Product':'Add Product';
  document.getElementById('mp-id').value=p?p.id:'';
  var typeEl=document.getElementById('mp-type');if(typeEl)typeEl.value=p?p.product_type||'Seedling':'Seedling';
  var collEl=document.getElementById('mp-coll');if(collEl)collEl.value=p?p.collection||'Normal Sales':'Normal Sales';
  document.getElementById('mp-name').value=p?p.name:'';
  document.getElementById('mp-desc').value=p?p.description||'':'';
  document.getElementById('mp-price').value=p?p.price:'25.00';
  document.getElementById('mp-compare').value=(p&&p.compare_price)?p.compare_price:'';
  var isManual=p&&p.stock_source==='manual';
  var mc=document.getElementById('mp-manual-stock');if(mc)mc.checked=isManual;
  var si=document.getElementById('mp-stock');
  si.value=p?p.stock_qty:0;si.readOnly=!isManual;si.style.cursor=isManual?'text':'not-allowed';si.style.background=isManual?'#fff':'var(--bg)';
  document.getElementById('mp-stock-hint').textContent=isManual?'Manually set':'Auto-calculated from batch maturity';

  var tagEl=document.getElementById('mp-tags');
  var savedTags=(p&&p.tags)?p.tags.split(',').map(function(t){return t.trim();})  :[];
  if(tagEl){for(var i=0;i<tagEl.options.length;i++){tagEl.options[i].selected=savedTags.includes(tagEl.options[i].value);}}

  var pubEl=document.getElementById('mp-published');var unpubEl=document.getElementById('mp-unpublished');
  if(p&&p.is_published){if(pubEl)pubEl.checked=true;}else{if(unpubEl)unpubEl.checked=true;}

  var prev=document.getElementById('mp-img-preview');var ph=document.getElementById('mp-img-placeholder');
  document.getElementById('mp-img-url').value=(p&&p.image_url)?p.image_url:'';
  if(p&&p.image_url){document.getElementById('mp-img-thumb').src=p.image_url;prev.style.display='block';ph.style.display='none';}
  else{prev.style.display='none';ph.style.display='block';}
  document.getElementById('mp-img-file').value='';document.getElementById('mp-img-uploading').style.display='none';

  var srcEl=document.getElementById('mp-stock-source');srcEl.innerHTML='';
  var histEl=document.getElementById('mp-transfer-history');histEl.innerHTML='';
  if(p&&p.id){
    loadTransferSourceDropdown(p.id);
    srcEl.innerHTML='<div style="font-size:12px;color:var(--ink4);">Loading...</div>';
    computeProductStock(p.id,p.sell_month||'',p.sell_year||0).then(function(d){
      srcEl.innerHTML=renderStockSource(d);
    }).catch(function(e){
      srcEl.innerHTML='';console.error('stock load error:',e);
      loadTransfersOnly(p.id).then(function(html){histEl.innerHTML=html;});
    });
  } else {
    loadTransferSourceDropdown(null);
  }

  openModal('modal-product');
}

function toggleManualStock(){
  var m=document.getElementById('mp-manual-stock').checked;var si=document.getElementById('mp-stock');
  si.readOnly=!m;si.style.cursor=m?'text':'not-allowed';si.style.background=m?'#fff':'var(--bg)';
  document.getElementById('mp-stock-hint').textContent=m?'Manually set':'Auto-calculated from batch maturity';
}

// ═══════════════════════════════════════
//  TRANSFERS
// ═══════════════════════════════════════
async function loadTransfersOnly(productId){
  var{data:out}=await sb.from('salesweb_stock_transfers').select('*').eq('from_product',productId).order('created_at',{ascending:false});
  var{data:inT}=await sb.from('salesweb_stock_transfers').select('*').eq('to_product',productId).order('created_at',{ascending:false});
  out=out||[];inT=inT||[];
  var ids=[];
  out.forEach(function(t){if(t.to_product&&ids.indexOf(t.to_product)===-1)ids.push(t.to_product);});
  inT.forEach(function(t){if(t.from_product&&ids.indexOf(t.from_product)===-1)ids.push(t.from_product);});
  var names={};
  if(ids.length){var{data:ps}=await sb.from('salesweb_products').select('id,name').in('id',ids);(ps||[]).forEach(function(p){names[p.id]=p.name;});}
  if(!out.length&&!inT.length)return '<div style="margin-top:.6rem;padding:.5rem .8rem;background:#f8f8f8;border-radius:8px;font-size:12px;color:var(--ink4);">No stock transfers</div>';
  var html='';
  if(out.length){
    html+='<div style="margin-top:.6rem;padding:.8rem;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;"><div style="font-size:13px;font-weight:600;color:#b91c1c;margin-bottom:.5rem;">Stock Moved Out</div>';
    out.forEach(function(t,i){var dt=new Date(t.created_at).toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'});html+='<div style="padding:.5rem 0;'+(i>0?'border-top:1px solid #fecaca;':'')+'"><div style="display:flex;justify-content:space-between;"><span style="font-size:14px;font-weight:600;color:#b91c1c;">−'+t.quantity+'</span><span style="font-size:10px;color:var(--ink4);">'+dt+'</span></div><div style="font-size:12px;color:var(--ink2);margin-top:.2rem;"→ Moved to: <strong>'+esc(names[t.to_product]||'—')+'</strong></div>'+(t.reason?'<div style="font-size:11px;color:var(--ink4);">'+esc(t.reason)+'</div>':'')+'</div>';});
    html+='</div>';
  }
  if(inT.length){
    html+='<div style="margin-top:.6rem;padding:.8rem;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;"><div style="font-size:13px;font-weight:600;color:#15803d;margin-bottom:.5rem;">Stock Received</div>';
    inT.forEach(function(t,i){var dt=new Date(t.created_at).toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'});html+='<div style="padding:.5rem 0;'+(i>0?'border-top:1px solid #bbf7d0;':'')+'"><div style="display:flex;justify-content:space-between;"><span style="font-size:14px;font-weight:600;color:#15803d;">+'+t.quantity+'</span><span style="font-size:10px;color:var(--ink4);">'+dt+'</span></div><div style="font-size:12px;color:var(--ink2);margin-top:.2rem;">← Received from: <strong>'+esc(names[t.from_product]||'—')+'</strong></div>'+(t.reason?'<div style="font-size:11px;color:var(--ink4);">'+esc(t.reason)+'</div>':'')+'</div>';});
    html+='</div>';
  }
  return html;
}

async function loadTransferSourceDropdown(excludeId){
  var{data}=await sb.from('salesweb_products').select('id,name,stock_qty,sell_month,sell_year,product_type').order('sell_year',{ascending:true}).order('sell_month',{ascending:true}).order('name');
  var sel=document.getElementById('mp-transfer-from');if(!sel)return;
  sel.innerHTML='<option value="">— Select source product —</option>';
  var rows=(data||[]).filter(function(p){return p.id!==excludeId&&(p.stock_qty||0)>0;});
  rows.sort(function(a,b){
    var ay=a.sell_year||0,by=b.sell_year||0;if(ay!==by)return ay-by;
    var mi=function(m){var L=['January','February','March','April','May','June','July','August','September','October','November','December'];var i=L.indexOf(m||'');return i<0?99:i;};
    return mi(a.sell_month)-mi(b.sell_month);
  });
  rows.forEach(function(p){
    var sm=p.sell_month?(p.sell_month+(p.sell_year?' '+p.sell_year:'')):'(no month)';
    sel.innerHTML+='<option value="'+p.id+'">'+esc(sm)+' — '+esc(p.name)+' (bal: '+(p.stock_qty||0)+')</option>';
  });
  sel.onchange=function(){renderTransferSourceDetail(sel.value);};
  var det=document.getElementById('mp-transfer-source-detail');if(det)det.innerHTML='';
}

async function renderTransferSourceDetail(srcId){
  var det=document.getElementById('mp-transfer-source-detail');if(!det)return;
  if(!srcId){det.innerHTML='';return;}
  det.innerHTML='<div style="font-size:12px;color:var(--ink4);padding:.4rem;">Loading source breakdown…</div>';
  try{
    var{data:p}=await sb.from('salesweb_products').select('sell_month,sell_year,name').eq('id',srcId).single();
    if(!p){det.innerHTML='';return;}
    var d=await computeProductStock(srcId,p.sell_month||'',p.sell_year||0);
    var batchNames=[];
    d.sources.forEach(function(s){if(s.batch&&batchNames.indexOf(s.batch)===-1)batchNames.push(s.batch);});
    var premiumByBatch={};
    if(batchNames.length){
      var{data:premiumLogs}=await sb.from('shared_inventory_logs').select('batch_name,plot_name,quantity_change').eq('transaction_type','Transplanted').in('batch_name',batchNames);
      (premiumLogs||[]).forEach(function(t){
        var pl=(t.plot_name||'').toLowerCase();
        if(!(pl.includes('premium')||pl.includes('double')||pl.includes('tray')))return;
        premiumByBatch[t.batch_name]=(premiumByBatch[t.batch_name]||0)+(t.quantity_change||0);
      });
    }
    var html='<div style="margin-top:.4rem;padding:.6rem .8rem;background:#f8faf8;border:1px solid var(--border);border-radius:8px;">';
    html+='<div style="font-size:12px;font-weight:600;color:var(--ink2);margin-bottom:.4rem;">Source breakdown — '+esc(p.name)+'</div>';
    if(!d.sources.length){
      html+='<div style="font-size:12px;color:var(--ink4);">No batch detail available.</div>';
    } else {
      html+='<table style="width:100%;font-size:11.5px;border-collapse:collapse;"><thead><tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:4px 6px;color:var(--ink3);">Maturity</th><th style="text-align:left;padding:4px 6px;color:var(--ink3);">Batch</th><th style="text-align:left;padding:4px 6px;color:var(--ink3);">Plot</th><th style="text-align:right;padding:4px 6px;color:var(--ink3);">Plot bal</th><th style="text-align:right;padding:4px 6px;color:var(--ink3);">→ Premium</th></tr></thead><tbody>';
      d.sources.forEach(function(s){
        var matStr='—';
        if(s.date){var mat=new Date(s.date);mat.setMonth(mat.getMonth()+9);matStr=mat.toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'});}
        var prem=premiumByBatch[s.batch]||0;
        html+='<tr style="border-bottom:1px dashed #eef0ee;">'+
          '<td style="padding:4px 6px;">'+esc(matStr)+'</td>'+
          '<td style="padding:4px 6px;font-weight:500;">'+esc(s.batch||'—')+'</td>'+
          '<td style="padding:4px 6px;">'+esc(s.plot||'—')+'</td>'+
          '<td style="padding:4px 6px;text-align:right;font-weight:600;color:'+(s.remaining>0?'var(--green)':'var(--ink4)')+';">'+s.remaining+'</td>'+
          '<td style="padding:4px 6px;text-align:right;color:'+(prem>0?'var(--amber)':'var(--ink4)')+';">  '+(prem>0?prem:'—')+'</td></tr>';
      });
      html+='</tbody></table>';
      html+='<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:.4rem;padding-top:.4rem;border-top:1px solid var(--border);"><span style="color:var(--ink3);">Total available to transfer</span><span style="font-weight:700;color:var(--green);">'+d.finalStock+'</span></div>';
    }
    html+='</div>';
    det.innerHTML=html;
  }catch(e){
    det.innerHTML='<div style="font-size:12px;color:var(--red);padding:.4rem;">Failed to load source breakdown.</div>';
  }
}

async function executeTransfer(){
  var fromId=document.getElementById('mp-transfer-from').value;
  var qty=parseInt(document.getElementById('mp-transfer-qty').value)||0;
  var reason=document.getElementById('mp-transfer-reason').value.trim();
  var toId=currentEditProductId;
  if(!fromId){toast('Select source','error');return;}
  if(!toId){toast('Save product first','error');return;}
  if(qty<=0){toast('Enter quantity','error');return;}
  var{data:src}=await sb.from('salesweb_products').select('stock_qty,name').eq('id',fromId).single();
  if(!src||src.stock_qty<qty){toast('Source only has '+(src?src.stock_qty:0),'error');return;}
  if(!confirm('Transfer '+qty+' from "'+src.name+'"?'))return;
  var session=await sb.auth.getSession();var user=session?.data?.session?.user?.email||'admin';
  await sb.from('salesweb_stock_transfers').insert([{from_product:fromId,to_product:toId,quantity:qty,reason:reason||'Stock transfer',transferred_by:user}]);
  await sb.from('salesweb_products').update({stock_qty:src.stock_qty-qty,updated_at:new Date().toISOString()}).eq('id',fromId);
  var{data:dest}=await sb.from('salesweb_products').select('stock_qty').eq('id',toId).single();
  var nq=(dest?dest.stock_qty:0)+qty;
  await sb.from('salesweb_products').update({stock_qty:nq,updated_at:new Date().toISOString()}).eq('id',toId);
  document.getElementById('mp-stock').value=nq;
  document.getElementById('mp-transfer-qty').value='';document.getElementById('mp-transfer-reason').value='';
  toast('Transferred '+qty);
  loadTransferSourceDropdown(toId);
  var{data:prod}=await sb.from('salesweb_products').select('sell_month,sell_year,stock_source').eq('id',toId).single();
  if(prod&&prod.sell_month&&prod.stock_source!=='manual'){
    computeProductStock(toId,prod.sell_month,prod.sell_year).then(function(d){
      document.getElementById('mp-stock-source').innerHTML=renderStockSource(d);
    }).catch(function(){});
  }
}

// ═══════════════════════════════════════
//  IMAGE
// ═══════════════════════════════════════
function previewProductImage(input){
  if(!input.files||!input.files[0])return;
  if(input.files[0].size>2*1024*1024){toast('Max 2MB','error');input.value='';return;}
  var r=new FileReader();r.onload=function(e){document.getElementById('mp-img-thumb').src=e.target.result;document.getElementById('mp-img-preview').style.display='block';document.getElementById('mp-img-placeholder').style.display='none';};
  r.readAsDataURL(input.files[0]);
}
async function uploadProductImage(){
  var input=document.getElementById('mp-img-file');
  if(!input.files||!input.files[0])return document.getElementById('mp-img-url').value;
  var file=input.files[0];var fn='product_'+Date.now()+'.'+file.name.split('.').pop().toLowerCase();
  document.getElementById('mp-img-uploading').style.display='block';
  var{error}=await sb.storage.from('product-images').upload(fn,file,{contentType:file.type,upsert:true});
  document.getElementById('mp-img-uploading').style.display='none';
  if(error){toast('Upload failed','error');return null;}
  var{data:u}=sb.storage.from('product-images').getPublicUrl(fn);return u?.publicUrl||'';
}

// ═══════════════════════════════════════
//  SAVE
// ═══════════════════════════════════════
async function saveProduct(){
  var btn=document.getElementById('mp-save-btn');btn.disabled=true;btn.textContent='Saving...';
  var imgUrl=document.getElementById('mp-img-url').value;
  var input=document.getElementById('mp-img-file');
  if(input.files&&input.files[0]){var up=await uploadProductImage();if(up)imgUrl=up;}
  var tagEl=document.getElementById('mp-tags');var tags=[];
  if(tagEl){for(var i=0;i<tagEl.options.length;i++){if(tagEl.options[i].selected)tags.push(tagEl.options[i].value);}}
  var isManual=document.getElementById('mp-manual-stock').checked;
  var isPub=document.getElementById('mp-published').checked;
  var id=document.getElementById('mp-id').value;
  var row={name:document.getElementById('mp-name').value.trim(),description:document.getElementById('mp-desc').value.trim(),product_type:document.getElementById('mp-type').value,collection:document.getElementById('mp-coll').value,category:document.getElementById('mp-type').value,price:parseFloat(document.getElementById('mp-price').value)||0,compare_price:parseFloat(document.getElementById('mp-compare').value)||0,tags:tags.length?tags.join(','):null,image_url:imgUrl||null,is_active:isPub,is_published:isPub,stock_source:isManual?'manual':'auto',updated_at:new Date().toISOString()};
  if(isManual)row.stock_qty=parseInt(document.getElementById('mp-stock').value)||0;
  if(!row.name){toast('Name required','error');btn.disabled=false;btn.textContent='Save Product';return;}
  var{error}=id?await sb.from('salesweb_products').update(row).eq('id',id):await sb.from('salesweb_products').insert([row]);
  btn.disabled=false;btn.textContent='Save Product';
  if(error){toast('Error: '+error.message,'error');return;}
  toast(id?'Updated':'Added');closeModal('modal-product');loadProducts();
}

// ═══════════════════════════════════════
//  EDIT / PUBLISH / DELETE
// ═══════════════════════════════════════
async function editProduct(id){try{var{data}=await sb.from('salesweb_products').select('*').eq('id',id).single();if(data)openProductForm(data);}catch(e){toast('Error','error');}}
async function deleteProduct(id){if(!confirm('Delete this product?'))return;await sb.from('salesweb_products').delete().eq('id',id);toast('Deleted');loadProducts();}

async function togglePublish(id,pub){
  if(!pub){
    await sb.from('salesweb_products').update({is_published:false,is_active:false,updated_at:new Date().toISOString()}).eq('id',id);
    toast('Unpublished');loadProducts();return;
  }
  openPublishModal(id);
}

// ═══════════════════════════════════════
//  PUBLISH MODAL
// ═══════════════════════════════════════
var _publishCtx=null;

async function openPublishModal(productId){
  document.getElementById('mpb-product-id').value=productId;
  document.getElementById('mpb-loading').style.display='block';
  document.getElementById('mpb-content').style.display='none';
  document.getElementById('mpb-warnings').innerHTML='';
  document.getElementById('mpb-confirm').disabled=true;
  document.getElementById('mpb-manual-qty').value='';
  var radios=document.querySelectorAll('input[name=mpb-strat]');
  radios.forEach(function(r){r.checked=(r.value==='maturity_plus_suitable_minus_estimate');});
  openModal('modal-publish');
  try{
    var{data:p}=await sb.from('salesweb_products').select('*').eq('id',productId).single();
    if(!p){toast('Product not found','error');closeModal('modal-publish');return;}
    document.getElementById('mpb-product-name').textContent=p.name+' · '+(p.sell_month||'(no month)')+' '+(p.sell_year||'');
    var sellMonth=p.sell_month||'';var sellYear=p.sell_year||0;
    var[stockData,alloc,suitable,estimate]=await Promise.all([
      computeProductStock(productId,sellMonth,sellYear),
      computeCustomerAllocation(sellMonth,sellYear),
      computeSuitableForSales(sellMonth,sellYear,productId),
      fetchEstimateCollection(sellMonth,sellYear)
    ]);
    var raw=stockData.sources.reduce(function(s,x){return s+x.originalStock;},0);
    _publishCtx={product:p,raw:raw,alloc:alloc,suitable:suitable,estimate:estimate,stockData:stockData};
    document.getElementById('mpb-raw').textContent=raw.toLocaleString();
    document.getElementById('mpb-alloc').textContent='− '+alloc.toLocaleString();
    document.getElementById('mpb-suitable').textContent='+ '+suitable.toLocaleString();
    document.getElementById('mpb-estimate').textContent='− '+estimate.toLocaleString();
    document.getElementById('mpb-opt-raw').textContent=raw.toLocaleString();
    document.getElementById('mpb-opt-minus').textContent=Math.max(0,raw-alloc).toLocaleString();
    document.getElementById('mpb-opt-mse').textContent=Math.max(0,raw+suitable-estimate).toLocaleString();
    document.getElementById('mpb-loading').style.display='none';
    document.getElementById('mpb-content').style.display='block';
    document.getElementById('mpb-confirm').disabled=false;
    updatePublishPreview();
  }catch(e){
    console.error('publish modal error:',e);
    document.getElementById('mpb-loading').textContent='Failed to load: '+(e.message||e);
  }
}

function getPublishChosenQty(){
  if(!_publishCtx)return null;
  var sel=document.querySelector('input[name=mpb-strat]:checked');
  if(!sel)return null;
  if(sel.value==='raw')return _publishCtx.raw;
  if(sel.value==='minus_alloc')return Math.max(0,_publishCtx.raw-_publishCtx.alloc);
  if(sel.value==='maturity_plus_suitable_minus_estimate')return Math.max(0,_publishCtx.raw+_publishCtx.suitable-_publishCtx.estimate);
  if(sel.value==='manual')return parseInt(document.getElementById('mpb-manual-qty').value)||0;
  return null;
}

function updatePublishPreview(){
  if(!_publishCtx)return;
  var qty=getPublishChosenQty();
  var sel=document.querySelector('input[name=mpb-strat]:checked');
  var w=[];
  var available=_publishCtx.stockData.finalStock;
  if(qty>available){w.push({tone:'amber',msg:'Publishing '+qty+' but only '+available+' is currently available for '+(_publishCtx.product.sell_month||'this month')+'. Will oversell by '+(qty-available)+' — likely needs to be filled from following month\'s stock.'});}
  if(sel&&sel.value==='maturity_plus_suitable_minus_estimate'&&_publishCtx.suitable>0){w.push({tone:'blue',msg:'Pulling '+_publishCtx.suitable+' suitable-for-sales units from prior/current month plots (audited ≥1.5m). Those plots\' available stock will drop by the same amount.'});}
  if(sel&&sel.value==='maturity_plus_suitable_minus_estimate'&&_publishCtx.estimate>(_publishCtx.raw+_publishCtx.suitable)){w.push({tone:'red',msg:'Estimate collection ('+_publishCtx.estimate+') exceeds maturity+suitable ('+(  _publishCtx.raw+_publishCtx.suitable)+'). Result clamped to 0.'});}
  if(qty<=0){w.push({tone:'red',msg:'Chosen qty is 0 — nothing will be available to buy on the storefront.'});}
  var html=w.map(function(x){
    var bg=x.tone==='red'?'#fef2f2':(x.tone==='amber'?'#fef3c7':'#eef2ff');
    var border=x.tone==='red'?'#fecaca':(x.tone==='amber'?'#fde68a':'#c7d2fe');
    var color=x.tone==='red'?'#b91c1c':(x.tone==='amber'?'#92400e':'#1d4ed8');
    return '<div style="background:'+bg+';border:1px solid '+border+';color:'+color+';padding:.5rem .7rem;border-radius:8px;font-size:12px;margin-bottom:.4rem;">⚠ '+esc(x.msg)+'</div>';
  }).join('');
  document.getElementById('mpb-warnings').innerHTML=html;
}

async function confirmPublish(){
  if(!_publishCtx){closeModal('modal-publish');return;}
  var qty=getPublishChosenQty();if(qty===null||qty<0){toast('Pick a quantity','error');return;}
  var sel=document.querySelector('input[name=mpb-strat]:checked');
  var btn=document.getElementById('mpb-confirm');btn.disabled=true;btn.textContent='Publishing...';
  var session=await sb.auth.getSession();var user=session?.data?.session?.user?.email||'admin';
  var{error}=await sb.from('salesweb_products').update({
    is_published:true,is_active:true,stock_qty:qty,stock_source:'manual',
    published_qty:qty,publish_strategy:sel.value,
    published_at:new Date().toISOString(),published_by:user,updated_at:new Date().toISOString()
  }).eq('id',_publishCtx.product.id);
  btn.disabled=false;btn.textContent='Confirm & Publish';
  if(error){toast('Publish failed: '+error.message,'error');return;}
  toast('Published '+qty+' units');closeModal('modal-publish');loadProducts();
}

// ═══════════════════════════════════════
//  PUBLISH HELPERS
// ═══════════════════════════════════════
async function computeCustomerAllocation(sellMonth,sellYear){
  if(!sellMonth||!sellYear)return 0;
  var{data:transplants}=await sb.from('shared_inventory_logs').select('batch_name,plot_name,created_at,remark').eq('transaction_type','Transplanted');
  var batchPlot=[];
  (transplants||[]).forEach(function(t){
    var pl=(t.plot_name||'').toLowerCase();
    if(pl.includes('premium')||pl.includes('double')||pl.includes('tray'))return;
    var tDate=null;
    if(t.remark){var m=t.remark.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);if(m)tDate=new Date(m[1]);}
    if(!tDate)tDate=new Date(t.created_at);
    var sd=new Date(tDate);sd.setMonth(sd.getMonth()+9);
    if(sd.toLocaleDateString('en-MY',{month:'long'})===sellMonth&&sd.getFullYear()===sellYear){
      batchPlot.push({batch:t.batch_name,plot:t.plot_name});
    }
  });
  if(!batchPlot.length)return 0;
  var batchNames=Array.from(new Set(batchPlot.map(function(x){return x.batch;}).filter(Boolean)));
  if(!batchNames.length)return 0;
  try{
    var{data:allocs}=await sb.from('shared_plot_allocations').select('batch_name,plot_name,reserved_qty').in('batch_name',batchNames);
    if(!allocs)return 0;
    var keyset=new Set(batchPlot.map(function(x){return x.batch+'||'+x.plot;}));
    return allocs.reduce(function(s,a){if(!keyset.has(a.batch_name+'||'+a.plot_name))return s;return s+(a.reserved_qty||0);},0);
  }catch(e){return 0;}
}

async function computeSuitableForSales(sellMonth,sellYear,excludeProductId){
  if(!sellMonth||!sellYear)return 0;
  var{data:audits}=await sb.from('audit_height_records').select('plot,batch,sample_1,sample_2,sample_3,date,created_at').order('date',{ascending:false}).order('created_at',{ascending:false});
  if(!audits)return 0;
  var seen={};var suitablePlots=new Set();
  audits.forEach(function(a){
    var key=(a.batch||'')+'||'+(a.plot||'');
    if(seen[key])return;seen[key]=true;
    var max=Math.max(parseFloat(a.sample_1)||0,parseFloat(a.sample_2)||0,parseFloat(a.sample_3)||0);
    if(max>150)suitablePlots.add(key);
  });
  if(!suitablePlots.size)return 0;
  var{data:transplants}=await sb.from('shared_inventory_logs').select('batch_name,plot_name,quantity_change,created_at,remark').eq('transaction_type','Transplanted');
  if(!transplants)return 0;
  var monthIdx=function(m){var L=['January','February','March','April','May','June','July','August','September','October','November','December'];var i=L.indexOf(m||'');return i<0?-1:i;};
  var targetIdx=monthIdx(sellMonth);if(targetIdx<0)return 0;
  var bucket=[];
  transplants.forEach(function(t){
    var pl=(t.plot_name||'').toLowerCase();
    if(pl.includes('premium')||pl.includes('double')||pl.includes('tray'))return;
    if(!suitablePlots.has((t.batch_name||'')+'||'+(t.plot_name||'')))return;
    var tDate=null;
    if(t.remark){var m=t.remark.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);if(m)tDate=new Date(m[1]);}
    if(!tDate)tDate=new Date(t.created_at);
    var sd=new Date(tDate);sd.setMonth(sd.getMonth()+9);
    var sy=sd.getFullYear();var sm=sd.toLocaleDateString('en-MY',{month:'long'});
    var smI=monthIdx(sm);if(smI<0)return;
    if(sy<sellYear||(sy===sellYear&&smI<=targetIdx)){
      if(sy===sellYear&&smI===targetIdx)return;
      var qty=t.quantity_change||0;
      bucket.push({batch:t.batch_name,plot:t.plot_name,raw:qty-Math.round(qty*CULL_RATE)});
    }
  });
  if(!bucket.length)return 0;
  var{data:dos}=await sb.from('shared_do_records').select('plot_1,qty_1,plot_2,qty_2,plot_3,qty_3,plot_4,qty_4,plot_5,qty_5').neq('status','Cancelled');
  var soldByPlot={};
  (dos||[]).forEach(function(d){for(var i=1;i<=5;i++){var p=d['plot_'+i];var q=parseInt(d['qty_'+i])||0;if(!p||!q)continue;soldByPlot[p]=(soldByPlot[p]||0)+q;}});
  var rawByPlot={};
  bucket.forEach(function(b){rawByPlot[b.plot]=(rawByPlot[b.plot]||0)+b.raw;});
  var remaining=0;
  Object.keys(rawByPlot).forEach(function(plot){remaining+=Math.max(0,rawByPlot[plot]-(soldByPlot[plot]||0));});
  return remaining;
}

async function fetchEstimateCollection(sellMonth,sellYear){
  if(!sellMonth||!sellYear)return 0;
  try{
    var{data}=await sb.from('salesweb_monthly_estimate_collection').select('qty').eq('sell_year',sellYear).eq('sell_month',sellMonth).maybeSingle();
    return(data&&data.qty)||0;
  }catch(e){return 0;}
}

// ═══════════════════════════════════════
//  REORDER — DRAG & DROP
// ═══════════════════════════════════════
var _dragSrcRow=null;

function onProductDragStart(e){
  var tr=e.target.closest('tr');if(!tr)return;
  _dragSrcRow=tr;tr.style.opacity='0.45';
  try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',tr.dataset.pid||'');}catch(_){}
}
function onProductDragOver(e){
  if(!_dragSrcRow)return;e.preventDefault();
  try{e.dataTransfer.dropEffect='move';}catch(_){}
  var tr=e.target.closest('tr');if(!tr||tr===_dragSrcRow)return;
  tr.style.background='#eef7ee';
}
function onProductDragLeave(e){
  var tr=e.target.closest('tr');if(tr)tr.style.background='';
}
function onProductDrop(e){
  e.preventDefault();
  var tr=e.target.closest('tr');if(!tr||!_dragSrcRow)return;
  tr.style.background='';
  if(tr===_dragSrcRow)return;
  var tbody=tr.parentNode;
  var srcRect=_dragSrcRow.getBoundingClientRect();
  var tgtRect=tr.getBoundingClientRect();
  if(srcRect.top<tgtRect.top){tbody.insertBefore(_dragSrcRow,tr.nextSibling);}
  else{tbody.insertBefore(_dragSrcRow,tr);}
  saveProductOrderFromDOM();
}
function onProductDragEnd(e){
  if(_dragSrcRow)_dragSrcRow.style.opacity='';
  _dragSrcRow=null;
  document.querySelectorAll('#products-tbody tr').forEach(function(r){r.style.background='';});
}
async function saveProductOrderFromDOM(){
  var rows=document.querySelectorAll('#products-tbody tr');
  if(!rows.length)return;
  var ids=[];rows.forEach(function(r){if(r.dataset.pid)ids.push(r.dataset.pid);});
  if(window._productsList){
    var byId={};window._productsList.forEach(function(p){byId[p.id]=p;});
    window._productsList=ids.map(function(id){return byId[id];}).filter(Boolean);
  }
  rows.forEach(function(r,i){var n=r.children[1];if(n)n.textContent=(i+1);r.dataset.idx=i;});
  var promises=[];
  for(var i=0;i<ids.length;i++){promises.push(sb.from('salesweb_products').update({sort_order:i}).eq('id',ids[i]));}
  try{await Promise.all(promises);toast('Order saved');}
  catch(e){toast('Please run SQL: ALTER TABLE salesweb_products ADD COLUMN IF NOT EXISTS sort_order INTEGER;','error');}
}
