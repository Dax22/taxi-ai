-- A chosen car can be saved before the driver's legal/contact details are complete.
-- These owner/admin-only selections are not an approved vehicle or review evidence.
CREATE TABLE driver_vehicle_selections (
  driver_id TEXT PRIMARY KEY REFERENCES driver_applications(driver_id),
  vehicle_json TEXT NOT NULL CHECK(json_valid(vehicle_json))
) STRICT;
