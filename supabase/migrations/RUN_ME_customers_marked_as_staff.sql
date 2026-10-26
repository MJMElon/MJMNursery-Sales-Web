-- ============================================================================
-- Customers who ordered but are missing from the admin Customer List
-- ----------------------------------------------------------------------------
-- WHY
-- The Customer List shows shared_profiles rows marked as a customer
-- (user_type = customer or role = customer). A shop customer who signed in
-- with an EMAIL CODE from the Sign In tab, rather than Sign Up, created a
-- brand new login with no customer tag on it. The office trigger
-- handle_new_user() files an untagged login as user_type = system, which is
-- staff, with no name. The role column then reads customer (the first
-- run of this file missed exactly that shape), but the list drops any
-- user_type = system row whatever its role says. So the customer could order, opened fine
-- from Manage Orders (where Role falls back to the word customer), and was
-- nowhere on the Customer List. The shop now tags every code login.
--
-- THE RULE
-- An account is moved onto the list when ALL of these hold
--   - it is not on the list now (user_type is not customer, role is empty
--     or customer)
--   - it has no office access (no manage_users, no can_verify_operation, no
--     module set to a staff level)
--   - it has at least one Sales Web order that was not deleted
-- An account with office access is never moved, even with orders. It is
-- listed below as kept back so somebody can look at it.
--
-- Safe to run twice. The second run moves nobody.
--
-- WHAT A GOOD RESULT LOOKS LIKE
--   moved      one row per customer put back on the list, with the email and
--              how many orders they have. Expect amy.xuan@hotmail.co.uk.
--   kept back  accounts with orders AND office access. Usually none.
--   summary    how many were moved this run. Zero on a second run.
-- ============================================================================

WITH snap AS (
  SELECT p.id,
         p.email,
         p.user_type,
         (
           COALESCE(p.permissions::jsonb ->> 'manage_users', '') NOT IN ('', 'false', '0', 'null')
           OR COALESCE(p.permissions::jsonb ->> 'can_verify_operation', '') NOT IN ('', 'false', '0', 'null')
           OR EXISTS (
                SELECT 1
                FROM jsonb_each_text(
                       CASE WHEN jsonb_typeof(p.permissions::jsonb -> 'modules') = 'object'
                            THEN p.permissions::jsonb -> 'modules'
                            ELSE '{}'::jsonb END) m
                WHERE lower(m.value) IN ('admin','normal','view','edit','manage','read','write','full','staff'))
         ) AS is_staff,
         (SELECT count(*) FROM public.salesweb_customer_orders o
           WHERE o.customer_id = p.id AND o.deleted_at IS NULL) AS orders
  FROM public.shared_profiles p
  WHERE COALESCE(p.user_type, 'system') <> 'customer'
    AND COALESCE(p.role, '') IN ('', 'customer')
),
moved AS (
  UPDATE public.shared_profiles p
     SET user_type = 'customer',
         role      = 'customer'
    FROM snap s
   WHERE p.id = s.id
     AND s.orders > 0
     AND NOT s.is_staff
  RETURNING p.id
)
SELECT 'moved' AS what, s.email AS account,
       'was ' || COALESCE(s.user_type, 'no type') || ', ' || s.orders || ' order(s)' AS detail
FROM snap s JOIN moved m ON m.id = s.id
UNION ALL
SELECT 'kept back', s.email,
       'has office access and ' || s.orders || ' order(s), not moved'
FROM snap s
WHERE s.orders > 0 AND s.is_staff
UNION ALL
SELECT 'summary', '',
       (SELECT count(*) FROM moved) || ' account(s) moved onto the Customer List this run'
ORDER BY 1, 2;
