-- ============================================================
-- Control Tower — PostgreSQL/PostGIS schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE facility_type AS ENUM ('clinic', 'hospital', 'distributor', 'warehouse');
CREATE TYPE stock_status AS ENUM ('surplus', 'warning', 'critical', 'stockout');
CREATE TYPE transfer_status AS ENUM ('pending', 'matched', 'escalated', 'in_transit', 'completed', 'cancelled', 'rejected');
CREATE TYPE escalation_level AS ENUM ('peer_facility', 'zonal_distributor', 'regional_authority');

-- ---------------------------------------------------------------
-- Zones (used to scope escalation: peer facilities first, then zonal distributor)
-- ---------------------------------------------------------------
CREATE TABLE zones (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    region VARCHAR(100),
    boundary GEOGRAPHY(POLYGON, 4326)   -- optional, for ST_Contains queries
);

-- ---------------------------------------------------------------
-- Facilities (clinics, hospitals, distributors)
-- ---------------------------------------------------------------
CREATE TABLE facilities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    type facility_type NOT NULL,
    zone_id INTEGER REFERENCES zones(id),
    parent_facility_id INTEGER REFERENCES facilities(id),   -- default escalation parent: clinic -> hospital, hospital -> distributor
    location GEOGRAPHY(POINT, 4326) NOT NULL,     -- store as (lon, lat) via ST_MakePoint(lon, lat)
    address TEXT,
    contact_phone VARCHAR(20),
    contact_email VARCHAR(150),
    storage_capacity_units INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CHECK (parent_facility_id IS NULL OR parent_facility_id != id)
);
CREATE INDEX idx_facilities_location ON facilities USING GIST(location);
CREATE INDEX idx_facilities_zone ON facilities(zone_id);
CREATE INDEX idx_facilities_type ON facilities(type);
CREATE INDEX idx_facilities_parent ON facilities(parent_facility_id);

-- ---------------------------------------------------------------
-- Medicine catalog
-- ---------------------------------------------------------------
CREATE TABLE medicines (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    category VARCHAR(100),
    unit VARCHAR(20) DEFAULT 'units',
    standard_lead_time_days INTEGER DEFAULT 3,
    is_essential BOOLEAN DEFAULT TRUE
);

-- ---------------------------------------------------------------
-- Current inventory snapshot — fast lookup, refreshed nightly or by trigger
-- ---------------------------------------------------------------
CREATE TABLE facility_inventory (
    id SERIAL PRIMARY KEY,
    facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    current_stock NUMERIC(10,2) NOT NULL DEFAULT 0,
    avg_daily_consumption NUMERIC(10,2) DEFAULT 0,
    reorder_point NUMERIC(10,2),
    status stock_status,                            -- cached output of triage_engine
    last_restocked_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (facility_id, medicine_id)
);
CREATE INDEX idx_inventory_status ON facility_inventory(status);
CREATE INDEX idx_inventory_facility_medicine ON facility_inventory(facility_id, medicine_id);

-- ---------------------------------------------------------------
-- Historical daily logs — the time series feeding the ML model
-- ---------------------------------------------------------------
CREATE TABLE inventory_logs (
    id BIGSERIAL PRIMARY KEY,
    facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    log_date DATE NOT NULL,
    stock_level NUMERIC(10,2) NOT NULL,
    consumption NUMERIC(10,2) DEFAULT 0,
    replenishment_received NUMERIC(10,2) DEFAULT 0,
    recorded_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (facility_id, medicine_id, log_date)
);
CREATE INDEX idx_logs_facility_medicine_date ON inventory_logs(facility_id, medicine_id, log_date);
CREATE INDEX idx_logs_date ON inventory_logs(log_date);

-- ---------------------------------------------------------------
-- ML forecast outputs
-- ---------------------------------------------------------------
CREATE TABLE forecast_results (
    id BIGSERIAL PRIMARY KEY,
    facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    forecast_date DATE NOT NULL,
    predicted_stock NUMERIC(10,2),
    predicted_consumption NUMERIC(10,2),
    confidence_lower NUMERIC(10,2),
    confidence_upper NUMERIC(10,2),
    predicted_status stock_status,
    model_version VARCHAR(50),
    generated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_forecast_facility_medicine_date ON forecast_results(facility_id, medicine_id, forecast_date);

-- ---------------------------------------------------------------
-- Transfer requests — the redistribution engine
-- ---------------------------------------------------------------
CREATE TABLE transfer_requests (
    id SERIAL PRIMARY KEY,
    requesting_facility_id INTEGER NOT NULL REFERENCES facilities(id),
    medicine_id INTEGER NOT NULL REFERENCES medicines(id),
    quantity_requested NUMERIC(10,2) NOT NULL,
    quantity_fulfilled NUMERIC(10,2) NOT NULL DEFAULT 0,   -- running total actually delivered so far
    priority stock_status NOT NULL,                  -- critical / warning
    status transfer_status DEFAULT 'pending',
    current_escalation_level escalation_level DEFAULT 'peer_facility',
    parent_request_id INTEGER REFERENCES transfer_requests(id),  -- set when this is a follow-up (partial fulfillment) or a dire fan-out sibling
    is_dire BOOLEAN NOT NULL DEFAULT FALSE,           -- true if allowed to have multiple simultaneous outstanding requests for the same shortage
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    CHECK (parent_request_id IS NULL OR parent_request_id != id)
);
CREATE INDEX idx_transfer_status ON transfer_requests(status);
CREATE INDEX idx_transfer_facility ON transfer_requests(requesting_facility_id);
CREATE INDEX idx_transfer_parent_request ON transfer_requests(parent_request_id);

-- Candidate matches / offers proposed against a transfer request
CREATE TABLE transfer_matches (
    id SERIAL PRIMARY KEY,
    transfer_request_id INTEGER NOT NULL REFERENCES transfer_requests(id) ON DELETE CASCADE,
    supplying_facility_id INTEGER NOT NULL REFERENCES facilities(id),
    quantity_offered NUMERIC(10,2) NOT NULL,
    distance_km NUMERIC(8,2),
    estimated_transit_minutes INTEGER,
    match_status VARCHAR(20) DEFAULT 'proposed',      -- proposed, accepted, rejected, delivered
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_matches_request ON transfer_matches(transfer_request_id);

-- ---------------------------------------------------------------
-- Alerts feed (dashboard notifications)
-- ---------------------------------------------------------------
CREATE TABLE alerts (
    id BIGSERIAL PRIMARY KEY,
    facility_id INTEGER REFERENCES facilities(id),
    medicine_id INTEGER REFERENCES medicines(id),
    alert_type VARCHAR(50),        -- 'stock_critical', 'forecast_warning', 'regional_cluster'
    severity VARCHAR(20),          -- low, medium, high
    message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX idx_alerts_facility ON alerts(facility_id);

-- ============================================================
-- Reference queries for the escalation engine (not part of DDL)
-- ============================================================

-- 1) Find nearest SURPLUS facilities holding a medicine, within 15km of a critical facility.
--    The `<->` operator uses the GIST index for fast K-nearest-neighbor ordering.
--
-- SELECT f.id, f.name, ST_Distance(f.location, c.location) / 1000.0 AS distance_km
-- FROM facilities f
-- JOIN facility_inventory fi ON fi.facility_id = f.id
-- JOIN facilities c ON c.id = :critical_facility_id
-- WHERE fi.medicine_id = :medicine_id
--   AND fi.status = 'surplus'
--   AND ST_DWithin(f.location, c.location, 15000)
-- ORDER BY f.location <-> c.location
-- LIMIT 5;

-- 2) If no peer match found, escalate to the parent facility (hierarchy walk):
--
-- SELECT p.* FROM facilities p
-- JOIN facilities c ON c.parent_facility_id = p.id
-- WHERE c.id = :critical_facility_id;

-- 3) Detect an emerging regional cluster: zones with >=3 facilities critical for the same medicine.
--
-- SELECT z.name, fi.medicine_id, COUNT(*) AS critical_count
-- FROM facility_inventory fi
-- JOIN facilities f ON f.id = fi.facility_id
-- JOIN zones z ON z.id = f.zone_id
-- WHERE fi.status = 'critical'
-- GROUP BY z.name, fi.medicine_id
-- HAVING COUNT(*) >= 3
-- ORDER BY critical_count DESC;
