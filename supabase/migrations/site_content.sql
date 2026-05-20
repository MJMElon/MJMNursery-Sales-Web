-- Site content table for admin-editable website sections
CREATE TABLE IF NOT EXISTS site_content (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  section TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT,
  description TEXT,
  image_url TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(section, key)
);

-- Seed default passion section items
INSERT INTO site_content (section, key, label, description, sort_order) VALUES
  ('passion', 'plantation', 'Oil Palm Plantation', 'Where it all begins — cultivating the land', 1),
  ('passion', 'nursery', 'MJM Nursery', 'MPOB certified premium seedling supplier', 2),
  ('passion', 'mill', 'MJM Palm Oil Mill', 'Processing fresh fruit bunches into crude palm oil', 3),
  ('passion', 'collection', 'MJM Collection Center', 'Convenient collection points for planters', 4),
  ('passion', 'baja', 'SawitGro Baja Kompos', 'Organic compost fertilizer — completing the cycle', 5)
ON CONFLICT (section, key) DO NOTHING;

-- Enable RLS
ALTER TABLE site_content ENABLE ROW LEVEL SECURITY;

-- Public read
CREATE POLICY "Public can read site_content" ON site_content FOR SELECT USING (true);

-- Admin can do everything
CREATE POLICY "Admin can manage site_content" ON site_content FOR ALL USING (true) WITH CHECK (true);
