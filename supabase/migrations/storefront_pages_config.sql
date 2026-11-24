-- Store the storefront About-MJM dropdown + Our-Policies tabs in
-- salesweb_app_settings so admins can edit them from the sales admin
-- portal without a code change.
--
-- Key: 'storefront_pages_config'
-- Value shape (text / JSON serialised):
--   {
--     "about_sections": [
--       {
--         "title": "About MJM",
--         "links": [
--           { "label": "Our Policies",  "action": "policies" },
--           { "label": "Contact Us",    "action": "page:contact" },
--           { "label": "Join Our Team", "action": "page:join"    }
--         ]
--       },
--       {
--         "title": "Plan Your Purchase",
--         "links": [
--           { "label": "Seedling Calculator",  "action": "page:calculator" },
--           { "label": "Request a Quotation", "action": "page:quotation"  }
--         ]
--       }
--     ],
--     "policies": [
--       { "label": "Terms & Conditions",           "body_html": "<p>...</p>" },
--       ...
--     ]
--   }
--
-- action values understood by the storefront:
--   "policies"            → open the Information page with the first policy
--                            tab selected (same deep-link behaviour as before).
--   "policies:<slug>"     → open Information page with that specific policy tab
--                            selected.
--   "page:<id>"           → showPage(<id>) — information / contact / join /
--                            calculator / quotation / portal / home.
--   "url:<href>"          → plain external / internal href opened in-place.
--
-- The storefront falls back to the hard-coded defaults if this row is
-- missing, so existing instances keep working while the admin migrates.
-- Safe to re-run: ON CONFLICT DO NOTHING keeps whatever an admin has edited.

INSERT INTO salesweb_app_settings (key, value)
VALUES (
  'storefront_pages_config',
  json_build_object(
    'about_sections', json_build_array(
      json_build_object(
        'title', 'About MJM',
        'links', json_build_array(
          json_build_object('label','Our Policies',  'action','policies'),
          json_build_object('label','Contact Us',    'action','page:contact'),
          json_build_object('label','Join Our Team', 'action','page:join')
        )
      ),
      json_build_object(
        'title', 'Plan Your Purchase',
        'links', json_build_array(
          json_build_object('label','Seedling Calculator', 'action','page:calculator'),
          json_build_object('label','Request a Quotation', 'action','page:quotation')
        )
      )
    ),
    'policies', json_build_array(
      json_build_object('label','Terms & Conditions',           'slug','terms',      'body_html','<p>These Terms apply to the website and transactions for products and services. Edit this policy in Admin → Website Design → Pages &amp; Policies.</p>'),
      json_build_object('label','Privacy Policy',               'slug','privacy',    'body_html','<p>Edit this policy in Admin → Website Design → Pages &amp; Policies.</p>'),
      json_build_object('label','Non Refund Policy',            'slug','refund',     'body_html','<p>Edit this policy in Admin → Website Design → Pages &amp; Policies.</p>'),
      json_build_object('label','Customer Collection Policy',   'slug','collection', 'body_html','<p>Edit this policy in Admin → Website Design → Pages &amp; Policies.</p>'),
      json_build_object('label','E-Invoice Policy',             'slug','einvoice',   'body_html','<p>Edit this policy in Admin → Website Design → Pages &amp; Policies.</p>')
    )
  )::text
)
ON CONFLICT (key) DO NOTHING;
