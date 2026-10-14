-- Anonymous sign-in is gone, and with it the anonymous trial's request
-- allowance. Old `anon_ip` sybil sightings age out with the rest.
DROP INDEX IF EXISTS anon_allowance_window;
DROP TABLE IF EXISTS anon_allowance;
