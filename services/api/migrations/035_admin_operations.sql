-- Queue pages and rolling offer metrics avoid sorting or scanning closed history.
CREATE INDEX admin_ops_ride_queue ON rides(status,created_at,id);
CREATE INDEX admin_ops_active_trip ON ride_trips(status,booked_at,ride_id);
CREATE INDEX admin_ops_offer_cohort ON dispatch_offers(created_at,id);
CREATE INDEX admin_ops_eats_delays ON eats_orders(status,updated_at,id);
CREATE INDEX admin_ops_available_queue ON driver_availability(started_at,id) WHERE active=1;
