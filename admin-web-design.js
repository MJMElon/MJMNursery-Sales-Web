/*
 * admin-web-design.js — manages website content blocks shown on the storefront.
 *
 * Currently this covers the "Our Passion" ecosystem section on index.html
 * (5 cards: plantation, nursery, mill, collection, baja). The storefront
 * reads from the same `salesweb_site_content` table this editor writes to.
 *
 * Ported in 2026-05 from the now-retired ai.mjmnursery.com salesweb admin
 * so www.mjmnursery.com is the single source of truth for admin tooling.
 */

async function loadWebDesign() {
  var container = document.getElementById('webdesign-passion-list');
  if (!container) return;
  container.innerHTML = '<div class="loading">Loading...</div>';

  // Fetch metadata only (no image_url) so the list paints fast even when
  // images are large data-URLs in the DB.
  var res = await sb.from('salesweb_site_content')
    .select('id,key,label,description,sort_order')
    .eq('section', 'passion')
    .order('sort_order');

  if (res.error || !res.data) {
    container.innerHTML =
      '<div style="padding:1.5rem;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;">' +
      '<p style="color:#dc2626;font-weight:700;margin-bottom:.8rem;">' +
      'Table not created yet. Run this SQL in your Supabase Dashboard → SQL Editor:</p>' +
      '<pre style="background:#1e293b;color:#e2e8f0;padding:1rem;border-radius:8px;font-size:11px;overflow-x:auto;max-height:300px;white-space:pre-wrap;">' +
      'CREATE TABLE IF NOT EXISTS salesweb_site_content (\n' +
      '  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,\n' +
      '  section TEXT NOT NULL,\n' +
      '  key TEXT NOT NULL,\n' +
      '  label TEXT,\n' +
      '  description TEXT,\n' +
      '  image_url TEXT,\n' +
      '  sort_order INT DEFAULT 0,\n' +
      '  created_at TIMESTAMPTZ DEFAULT now(),\n' +
      '  updated_at TIMESTAMPTZ DEFAULT now(),\n' +
      '  UNIQUE(section, key)\n' +
      ');\n\n' +
      'INSERT INTO salesweb_site_content (section, key, label, description, sort_order) VALUES\n' +
      "  ('passion', 'plantation', 'Oil Palm Plantation', 'Where it all begins — cultivating the land', 1),\n" +
      "  ('passion', 'nursery', 'MJM Nursery', 'MPOB certified premium seedling supplier', 2),\n" +
      "  ('passion', 'mill', 'MJM Palm Oil Mill', 'Processing fresh fruit bunches into crude palm oil', 3),\n" +
      "  ('passion', 'collection', 'MJM Collection Center', 'Convenient collection points for planters', 4),\n" +
      "  ('passion', 'baja', 'SawitGro Baja Kompos', 'Organic compost fertilizer — completing the cycle', 5)\n" +
      'ON CONFLICT (section, key) DO NOTHING;\n\n' +
      'ALTER TABLE salesweb_site_content ENABLE ROW LEVEL SECURITY;\n' +
      'CREATE POLICY "Public read salesweb_site_content" ON salesweb_site_content FOR SELECT USING (true);\n' +
      'CREATE POLICY "Admin manage salesweb_site_content" ON salesweb_site_content FOR ALL USING (true) WITH CHECK (true);' +
      '</pre>' +
      '<p style="color:#64748b;font-size:12px;margin-top:.8rem;">After running, refresh this page.</p></div>';
    return;
  }

  if (res.data.length === 0) {
    container.innerHTML = '<p style="color:#64748b;">No passion items found. The table exists but has no data.</p>';
    return;
  }

  var html = '<div style="display:grid;gap:1rem;">';
  res.data.forEach(function(item) {
    var labelEsc = (item.label || '').replace(/"/g, '&quot;');
    var descEsc  = (item.description || '').replace(/"/g, '&quot;');
    html +=
      '<div style="display:flex;gap:1rem;align-items:center;padding:1rem;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;">' +
        '<div style="flex-shrink:0;" id="wd-img-' + item.id + '">' +
          '<div style="width:64px;height:64px;border-radius:50%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:9px;font-weight:700;border:2px dashed #cbd5e1;">Loading</div>' +
        '</div>' +
        '<div style="flex:1;display:grid;gap:.5rem;">' +
          '<div style="display:flex;gap:.5rem;align-items:center;">' +
            '<span style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;min-width:40px;">' + item.key + '</span>' +
            '<input class="form-input" value="' + labelEsc + '" id="wd-label-' + item.id + '" style="font-weight:600;" placeholder="Label">' +
          '</div>' +
          '<input class="form-input" value="' + descEsc + '" id="wd-desc-' + item.id + '" placeholder="Description" style="font-size:12px;">' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:.4rem;flex-shrink:0;" id="wd-actions-' + item.id + '">' +
          '<label class="btn btn-outline btn-sm" style="cursor:pointer;text-align:center;font-size:10px;">Upload Image' +
            '<input type="file" accept="image/*" style="display:none;" onchange="uploadPassionImage(\'' + item.id + '\',this)">' +
          '</label>' +
          '<button class="btn btn-primary btn-sm" style="font-size:10px;" onclick="savePassionItem(\'' + item.id + '\')">Save</button>' +
        '</div>' +
      '</div>';
  });
  html += '</div>';
  container.innerHTML = html;

  res.data.forEach(function(item) { loadPassionThumb(item.id); });
}

async function loadPassionThumb(id) {
  var imgEl = document.getElementById('wd-img-' + id);
  var actEl = document.getElementById('wd-actions-' + id);
  if (!imgEl) return;
  try {
    var r = await sb.from('salesweb_site_content').select('image_url').eq('id', id).single();
    if (r.data && r.data.image_url) {
      imgEl.innerHTML = '<img src="' + r.data.image_url + '" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid #e2e8f0;">';
      if (actEl && !actEl.querySelector('.wd-remove-btn')) {
        var removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-sm wd-remove-btn';
        removeBtn.style.cssText = 'font-size:9px;color:#ef4444;border:1px solid #fecaca;background:#fef2f2;';
        removeBtn.textContent = 'Remove Img';
        removeBtn.onclick = function() { removePassionImage(id); };
        var saveBtn = actEl.querySelector('.btn-primary');
        if (saveBtn) actEl.insertBefore(removeBtn, saveBtn);
      }
    } else {
      imgEl.innerHTML = '<div style="width:64px;height:64px;border-radius:50%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;font-weight:700;border:2px dashed #cbd5e1;">No img</div>';
    }
  } catch (e) {
    imgEl.innerHTML = '<div style="width:64px;height:64px;border-radius:50%;background:#fef2f2;display:flex;align-items:center;justify-content:center;color:#ef4444;font-size:9px;font-weight:700;border:2px dashed #fecaca;">Error</div>';
  }
}

// Compress to max 400px on the long side at JPEG 0.6 — keeps each image
// under ~80 KB so we can inline as a data URL without bloating the row.
async function uploadPassionImage(id, input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  var img = new Image();
  var reader = new FileReader();
  reader.onload = function(e) {
    img.onload = async function() {
      var canvas = document.createElement('canvas');
      var MAX = 400;
      var w = img.width, h = img.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      var compressed = canvas.toDataURL('image/jpeg', 0.6);
      var r = await sb.from('salesweb_site_content')
        .update({ image_url: compressed, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (r.error) return alert('Upload error: ' + r.error.message);
      alert('Image uploaded!');
      loadWebDesign();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function removePassionImage(id) {
  if (!confirm('Remove the image for this item?')) return;
  var r = await sb.from('salesweb_site_content')
    .update({ image_url: null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (r.error) return alert('Error: ' + r.error.message);
  loadWebDesign();
}

async function savePassionItem(id) {
  var label = document.getElementById('wd-label-' + id).value.trim();
  var desc  = document.getElementById('wd-desc-' + id).value.trim();
  var r = await sb.from('salesweb_site_content')
    .update({ label: label, description: desc, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (r.error) return alert('Save error: ' + r.error.message);
  alert('Saved!');
}
