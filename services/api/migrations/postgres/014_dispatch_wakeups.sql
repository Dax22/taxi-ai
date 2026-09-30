-- Opt-in connection setting keeps the old path unchanged when the fast matching
-- rollout is disabled. PostgreSQL publishes NOTIFY only after transaction commit.
-- Channel names isolate schemas; payloads contain no account/ride IDs or GPS data.
CREATE FUNCTION dispatch_ride_wakeup_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
BEGIN
  IF current_setting('taxi_ai.matching_fast_path', true) = 'on'
     AND NEW.dispatch_region <> '' THEN
    PERFORM pg_notify('taxi_dispatch_' || md5(TG_TABLE_SCHEMA),
      json_build_object('type', 'ride', 'region', NEW.dispatch_region)::text);
  END IF;
  RETURN NEW;
END;
$taxi$;
CREATE TRIGGER dispatch_ride_wakeup AFTER INSERT OR UPDATE OF status, dispatch_region ON rides
FOR EACH ROW EXECUTE FUNCTION dispatch_ride_wakeup_fn();

CREATE FUNCTION dispatch_availability_wakeup_fn() RETURNS trigger LANGUAGE plpgsql AS $taxi$
DECLARE region TEXT;
BEGIN
  IF current_setting('taxi_ai.matching_fast_path', true) = 'on' AND NEW.active = 1 THEN
    IF NEW.mode = 'sample' THEN
      region := 'sample:' || NEW.area_id;
    ELSIF NEW.latitude >= 4 AND NEW.latitude < 14 AND NEW.longitude >= 2 AND NEW.longitude < 15 THEN
      region := 'ng:' || floor(NEW.latitude * 20)::integer || ':' || floor(NEW.longitude * 20)::integer;
    END IF;
    IF region IS NOT NULL THEN
      PERFORM pg_notify('taxi_dispatch_' || md5(TG_TABLE_SCHEMA),
        json_build_object('type', 'availability', 'region', region)::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$taxi$;
CREATE TRIGGER dispatch_availability_wakeup AFTER INSERT OR UPDATE OF active, seen_at, latitude, longitude ON driver_availability
FOR EACH ROW EXECUTE FUNCTION dispatch_availability_wakeup_fn();
