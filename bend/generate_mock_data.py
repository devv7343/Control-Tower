"""
Control Tower — Mock Data Generator
====================================
Generates a synthetic network of clinics/hospitals/distributors around a city,
then simulates SIM_DAYS of daily medicine consumption, replenishment, and a
localized outbreak.

Outputs (in the current directory):
    facilities.csv        — facility_id, name, type, lat, lon, capacity, parent_facility_id
    medicines.csv          — medicine catalog
    inventory_logs.csv     — daily long-format time series (feeds the ML model)

Run:
    python generate_mock_data.py
"""

import math
from datetime import date, timedelta
import numpy as np
import pandas as pd

RNG = np.random.default_rng(42)

# ---------------------------------------------------------------
# Config — tune freely for your demo
# ---------------------------------------------------------------
CITY_CENTER = (12.9716, 77.5946)   # example region; swap for your own city
BOUNDING_RADIUS_KM = 20
SIM_DAYS = 90
START_DATE = date(2026, 3, 1)

MEDICINES = [
    {"name": "ORS Sachets",              "category": "rehydration", "unit": "sachets",  "base_daily_mean": 15, "lead_time_days": 3},
    {"name": "Amoxicillin 500mg",        "category": "antibiotic",  "unit": "tablets",  "base_daily_mean": 10, "lead_time_days": 5},
    {"name": "Paracetamol 500mg",        "category": "analgesic",   "unit": "tablets",  "base_daily_mean": 25, "lead_time_days": 2},
    {"name": "IV Fluids (Normal Saline)","category": "fluids",      "unit": "bottles",  "base_daily_mean": 8,  "lead_time_days": 4},
    {"name": "Antiviral (Oseltamivir)",  "category": "antiviral",   "unit": "capsules", "base_daily_mean": 5,  "lead_time_days": 7},
]

OUTBREAK = {
    "epicenter": (12.99, 77.61),
    "start_day": 40,             # sim day the outbreak begins
    "peak_day_offset": 15,       # days after start_day that consumption peaks
    "duration": 35,              # days the effect lasts
    "radius_km": 8,              # facilities beyond this are unaffected
    "medicine": "Antiviral (Oseltamivir)",
    "secondary_medicines": ["Paracetamol 500mg", "ORS Sachets"],
    "max_multiplier": 6.0,       # peak consumption = 6x baseline at the epicenter
}

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

def random_point_near(center, radius_km):
    r = radius_km * math.sqrt(RNG.random())
    theta = RNG.random() * 2 * math.pi
    dlat = (r / 111.0) * math.cos(theta)
    dlon = (r / (111.0 * math.cos(math.radians(center[0])))) * math.sin(theta)
    return center[0] + dlat, center[1] + dlon

def generate_facilities():
    rows = []
    fid = 1
    
    # 1 Distributor
    distributor_id = fid
    lat, lon = CITY_CENTER
    rows.append({
        "id": distributor_id, "name": "Central Zonal Distributor", "type": "distributor",
        "lat": lat, "lon": lon, "capacity": 15000, "parent_facility_id": None
    })
    fid += 1
    
    # 3 Hospitals
    hospital_ids = []
    h_names = ["Hospital Alpha (Central)", "Hospital Beta (West)", "Hospital Gamma (East)"]
    for name in h_names:
        lat, lon = random_point_near(CITY_CENTER, BOUNDING_RADIUS_KM * 0.5)
        rows.append({
            "id": fid, "name": name, "type": "hospital",
            "lat": lat, "lon": lon, "capacity": 2000, "parent_facility_id": distributor_id
        })
        hospital_ids.append(fid)
        fid += 1
        
    # 4 Clinics per hospital
    for h_id in hospital_ids:
        for c in range(1, 5):
            parent = next(row for row in rows if row["id"] == h_id)
            lat, lon = random_point_near((parent["lat"], parent["lon"]), BOUNDING_RADIUS_KM * 0.3)
            rows.append({
                "id": fid, "name": f"Clinic {parent['name'].split()[1]} {c}", "type": "clinic",
                "lat": lat, "lon": lon, "capacity": 500, "parent_facility_id": h_id
            })
            fid += 1

    return pd.DataFrame(rows)

def outbreak_multiplier(day_index, distance_km):
    if day_index < OUTBREAK["start_day"] or distance_km > OUTBREAK["radius_km"]:
        return 1.0
    days_since = day_index - OUTBREAK["start_day"]
    if days_since > OUTBREAK["duration"]:
        return 1.0

    growth = 1 / (1 + math.exp(-(days_since - OUTBREAK["peak_day_offset"]) / 5))
    if days_since > OUTBREAK["peak_day_offset"]:
        remaining = OUTBREAK["duration"] - OUTBREAK["peak_day_offset"]
        decay = max(0.0, 1 - (days_since - OUTBREAK["peak_day_offset"]) / (remaining + 1e-6))
    else:
        decay = 1.0
    distance_factor = max(0.0, 1 - distance_km / OUTBREAK["radius_km"])

    return 1 + (OUTBREAK["max_multiplier"] - 1) * growth * decay * distance_factor

def simulate():
    facilities_df = generate_facilities()
    medicines_df = pd.DataFrame(MEDICINES).reset_index().rename(columns={"index": "med_idx"})
    medicines_df["id"] = medicines_df["med_idx"] + 1

    state = {}
    for _, f in facilities_df.iterrows():
        for _, m in medicines_df.iterrows():
            state[(f["id"], m["id"])] = {
                "stock": int(round(m["base_daily_mean"] * RNG.uniform(8, 15))),
                "pending_deliveries": [],
            }

    logs = []
    for day_idx in range(SIM_DAYS):
        current_date = START_DATE + timedelta(days=day_idx)

        for _, f in facilities_df.iterrows():
            if f["type"] == "distributor":
                continue

            distance_to_epicenter = haversine_km(f["lat"], f["lon"], *OUTBREAK["epicenter"])
            size_factor = {"clinic": 1.0, "hospital": 3.0}.get(f["type"], 1.0)

            for _, m in medicines_df.iterrows():
                key = (f["id"], m["id"])
                s = state[key]

                arrived = [q for (day, q) in s["pending_deliveries"] if day == day_idx]
                replenishment = sum(arrived)
                s["pending_deliveries"] = [(d, q) for (d, q) in s["pending_deliveries"] if d != day_idx]
                s["stock"] += replenishment

                mult = 1.0
                if m["name"] == OUTBREAK["medicine"]:
                    mult = outbreak_multiplier(day_idx, distance_to_epicenter)
                elif m["name"] in OUTBREAK["secondary_medicines"]:
                    mult = 1 + (outbreak_multiplier(day_idx, distance_to_epicenter) - 1) * 0.5

                weekday_factor = 0.85 if current_date.weekday() >= 5 else 1.0
                lam = max(0.1, m["base_daily_mean"] * size_factor * mult * weekday_factor)
                consumption = int(RNG.poisson(lam))
                consumption = min(consumption, s["stock"])
                s["stock"] -= consumption

                reorder_threshold = m["base_daily_mean"] * size_factor * m["lead_time_days"] * 1.5
                if s["stock"] < reorder_threshold and not s["pending_deliveries"]:
                    order_qty = int(round(m["base_daily_mean"] * size_factor * 14))
                    s["pending_deliveries"].append((day_idx + int(m["lead_time_days"]), order_qty))

                logs.append({
                    "date": current_date.isoformat(),
                    "facility_id": f["id"],
                    "medicine_id": m["id"],
                    "stock_level": int(round(s["stock"])),
                    "consumption": int(round(consumption)),
                    "replenishment_received": int(round(replenishment)),
                })

    logs_df = pd.DataFrame(logs)
    medicines_out = medicines_df.drop(columns=["med_idx"])[
        ["id", "name", "category", "unit", "base_daily_mean", "lead_time_days"]
    ]
    return facilities_df, medicines_out, logs_df

if __name__ == "__main__":
    facilities_df, medicines_df, logs_df = simulate()
    facilities_df.to_csv("facilities.csv", index=False)
    medicines_df.to_csv("medicines.csv", index=False)
    logs_df.to_csv("inventory_logs.csv", index=False)
    outbreak_date = START_DATE + timedelta(days=OUTBREAK["start_day"])
    print(f"Generated {len(facilities_df)} facilities, {len(medicines_df)} medicines, {len(logs_df)} log rows")
