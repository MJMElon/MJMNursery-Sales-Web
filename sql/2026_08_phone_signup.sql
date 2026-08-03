-- Phone-number signup for the storefront (supabase/functions/phone-auth).
-- The phone number becomes a login identifier, so it must be unique across
-- shared_profiles. Partial index: rows without a phone are unaffected.
--
-- BEFORE running: check for existing duplicate phones — the index refuses
-- to build while any remain. List them with:
--
--   select phone, count(*), array_agg(email)
--   from public.shared_profiles
--   where phone is not null and phone <> ''
--   group by phone having count(*) > 1;
--
-- and clear the extras (set phone = null on the rows that shouldn't own
-- the number) before creating the index.

create unique index if not exists shared_profiles_phone_unique
  on public.shared_profiles (phone)
  where phone is not null and phone <> '';
