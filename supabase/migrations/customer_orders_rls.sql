-- ════════════════════════════════════════════════════════════════════════════
-- Migration: RLS for salesweb customer-facing order tables
-- ----------------------------------------------------------------------------
-- Customers could not see their own orders in the portal because RLS was
-- enabled on these tables but no SELECT policy existed for authenticated users.
-- This migration adds the minimum policies needed for the customer portal to
-- work correctly.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. salesweb_customer_orders ────────────────────────────────────────────────
ALTER TABLE salesweb_customer_orders ENABLE ROW LEVEL SECURITY;

-- Customers can read their own orders
DROP POLICY IF EXISTS salesweb_customer_orders_customer_select ON salesweb_customer_orders;
CREATE POLICY salesweb_customer_orders_customer_select
    ON salesweb_customer_orders FOR SELECT
    USING (customer_id = auth.uid());

-- Customers can insert their own orders (checkout)
DROP POLICY IF EXISTS salesweb_customer_orders_customer_insert ON salesweb_customer_orders;
CREATE POLICY salesweb_customer_orders_customer_insert
    ON salesweb_customer_orders FOR INSERT
    WITH CHECK (customer_id = auth.uid());

-- Service role / admin bypass (handled by Supabase automatically for service-role key)

-- 2. salesweb_order_items ────────────────────────────────────────────────────
ALTER TABLE salesweb_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salesweb_order_items_customer_select ON salesweb_order_items;
CREATE POLICY salesweb_order_items_customer_select
    ON salesweb_order_items FOR SELECT
    USING (
        order_id IN (
            SELECT id FROM salesweb_customer_orders
            WHERE customer_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS salesweb_order_items_customer_insert ON salesweb_order_items;
CREATE POLICY salesweb_order_items_customer_insert
    ON salesweb_order_items FOR INSERT
    WITH CHECK (
        order_id IN (
            SELECT id FROM salesweb_customer_orders
            WHERE customer_id = auth.uid()
        )
    );

-- 3. salesweb_order_timeline ─────────────────────────────────────────────────
ALTER TABLE salesweb_order_timeline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salesweb_order_timeline_customer_select ON salesweb_order_timeline;
CREATE POLICY salesweb_order_timeline_customer_select
    ON salesweb_order_timeline FOR SELECT
    USING (
        order_id IN (
            SELECT id FROM salesweb_customer_orders
            WHERE customer_id = auth.uid()
        )
    );

-- 4. salesweb_order_attachments ──────────────────────────────────────────────
ALTER TABLE salesweb_order_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salesweb_order_attachments_customer_select ON salesweb_order_attachments;
CREATE POLICY salesweb_order_attachments_customer_select
    ON salesweb_order_attachments FOR SELECT
    USING (
        order_id IN (
            SELECT id FROM salesweb_customer_orders
            WHERE customer_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS salesweb_order_attachments_customer_insert ON salesweb_order_attachments;
CREATE POLICY salesweb_order_attachments_customer_insert
    ON salesweb_order_attachments FOR INSERT
    WITH CHECK (
        order_id IN (
            SELECT id FROM salesweb_customer_orders
            WHERE customer_id = auth.uid()
        )
    );

-- 5. Admin read-all policies (for admin.html which uses the anon key via RLS)
-- Admin users have shared_profiles.role = 'admin' or salesweb permission.
-- Using a helper function to avoid subquery repetition.
CREATE OR REPLACE FUNCTION is_salesweb_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM shared_profiles
        WHERE id = auth.uid()
          AND (
            role = 'admin'
            OR (permissions -> 'modules' ->> 'salesweb') IN ('admin', 'normal')
          )
    );
$$;

DROP POLICY IF EXISTS salesweb_customer_orders_admin_all ON salesweb_customer_orders;
CREATE POLICY salesweb_customer_orders_admin_all
    ON salesweb_customer_orders FOR ALL
    USING (is_salesweb_admin())
    WITH CHECK (is_salesweb_admin());

DROP POLICY IF EXISTS salesweb_order_items_admin_all ON salesweb_order_items;
CREATE POLICY salesweb_order_items_admin_all
    ON salesweb_order_items FOR ALL
    USING (is_salesweb_admin())
    WITH CHECK (is_salesweb_admin());

DROP POLICY IF EXISTS salesweb_order_timeline_admin_all ON salesweb_order_timeline;
CREATE POLICY salesweb_order_timeline_admin_all
    ON salesweb_order_timeline FOR ALL
    USING (is_salesweb_admin())
    WITH CHECK (is_salesweb_admin());

DROP POLICY IF EXISTS salesweb_order_attachments_admin_all ON salesweb_order_attachments;
CREATE POLICY salesweb_order_attachments_admin_all
    ON salesweb_order_attachments FOR ALL
    USING (is_salesweb_admin())
    WITH CHECK (is_salesweb_admin());
