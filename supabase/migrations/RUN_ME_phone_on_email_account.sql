-- ============================================================================
-- WhatsApp login: is this number already on an email account
-- ----------------------------------------------------------------------------
-- WHY
-- A customer who signed up by EMAIL and typed a phone number into My Account
-- has that number only in shared_profiles.phone. The login itself
-- (auth.users.phone) is empty. If they then sign in on the WhatsApp tab with
-- that number, Supabase makes a SECOND, empty login: no orders, no points,
-- and a duplicate on Manage Customers.
--
-- The shop asks phone_on_email_account() before it sends a WhatsApp code.
-- When it answers true the shop does not send, and tells the customer to sign
-- in with email once and link the number under My Account (a WhatsApp code
-- proves the number and ties it to the same login).
--
-- It answers true or false and nothing else, so it reveals no name, email or
-- order. The shop fails OPEN: if this function is missing or errors, the code
-- is sent as before.
--
-- Numbers are compared as digits with the Malaysian rule the shop uses
-- (0123456789, +60123456789 and 60123456789 are one number), written with
-- translate() and left() because the SQL Editor has choked on a regular
-- expression before.
--
-- Safe to run twice: CREATE OR REPLACE throughout.
--
-- WHAT A GOOD RESULT LOOKS LIKE
--   function          installed
--   self test         starts with OK (an empty number answers false).
--   waiting to link   how many customer accounts have a phone number in their
--                     profile that is not yet their WhatsApp login. These are
--                     the customers the shop will point to My Account.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.salesweb_phone_key(p text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
           WHEN d = '' THEN ''
           WHEN left(d, 2) = '60' THEN d
           WHEN left(d, 1) = '0' THEN '6' || d
           WHEN left(d, 1) = '1' AND length(d) BETWEEN 9 AND 10 THEN '60' || d
           ELSE d
         END
  FROM (SELECT translate(coalesce(p, ''), ' -+()./', '') AS d) x
$$;

CREATE OR REPLACE FUNCTION public.phone_on_email_account(p_phone text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT CASE
           WHEN length(public.salesweb_phone_key(p_phone)) < 9 THEN false
           ELSE EXISTS (
                  SELECT 1 FROM public.shared_profiles p
                  WHERE (p.user_type = 'customer' OR p.role = 'customer')
                    AND public.salesweb_phone_key(p.phone) = public.salesweb_phone_key(p_phone))
                AND NOT EXISTS (
                  SELECT 1 FROM auth.users u
                  WHERE public.salesweb_phone_key(u.phone) = public.salesweb_phone_key(p_phone))
         END
$$;

GRANT EXECUTE ON FUNCTION public.salesweb_phone_key(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phone_on_email_account(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'function' AS what,
       CASE WHEN to_regprocedure('public.phone_on_email_account(text)') IS NOT NULL
            THEN 'installed' ELSE 'MISSING' END AS detail
UNION ALL
SELECT 'self test',
       CASE WHEN public.phone_on_email_account('') = false
            THEN 'OK, an empty number answers false'
            ELSE 'WRONG, an empty number answered true' END
UNION ALL
SELECT 'waiting to link',
       count(*)::text || ' customer account(s) have a profile phone that is not yet their WhatsApp login'
FROM public.shared_profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE (p.user_type = 'customer' OR p.role = 'customer')
  AND length(public.salesweb_phone_key(p.phone)) >= 9
  AND public.salesweb_phone_key(p.phone) IS DISTINCT FROM public.salesweb_phone_key(u.phone);
