from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base, init_db
from routes import router
import os
import pandas as pd
from models import Facility, Medicine, FacilityInventory, InventoryLog, StockStatus, FacilityType
from sqlalchemy.orm import Session
from database import SessionLocal
from triage import refresh_all_statuses

app = FastAPI(title="Control Tower API")

# Configure CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

@app.on_event("startup")
def on_startup():
    init_db()
    
    db = SessionLocal()
    try:
        base_dir = os.path.dirname(__file__)
        meds_csv = os.path.join(base_dir, "medicines.csv")
        facs_csv = os.path.join(base_dir, "facilities.csv")
        logs_csv = os.path.join(base_dir, "inventory_logs.csv")

        # Check if DB is populated
        if db.query(Facility).count() == 0:
            print("Database empty. Populating from CSVs...")
            
            # Load Medicines
            if os.path.exists(meds_csv):
                df_meds = pd.read_csv(meds_csv)
                for _, row in df_meds.iterrows():
                    med = Medicine(
                        id=int(row["id"]),
                        name=row["name"],
                        category=row["category"],
                        unit=row["unit"],
                        standard_lead_time_days=int(row["lead_time_days"])
                    )
                    db.add(med)
                db.commit()
                
            # Load Facilities
            if os.path.exists(facs_csv):
                df_facs = pd.read_csv(facs_csv)
                df_facs = df_facs.sort_values(by="parent_facility_id", na_position="first")
                for _, row in df_facs.iterrows():
                    fac = Facility(
                        id=int(row["id"]),
                        name=row["name"],
                        type=row["type"],
                        latitude=row["lat"],
                        longitude=row["lon"],
                        storage_capacity_units=int(row["capacity"]),
                        parent_facility_id=int(row["parent_facility_id"]) if pd.notna(row["parent_facility_id"]) else None
                    )
                    db.add(fac)
                db.commit()
                
            # Load Inventory Logs and calculate current stock
            if os.path.exists(logs_csv):
                print("Loading inventory logs... This might take a few seconds.")
                df_logs = pd.read_csv(logs_csv)
                
                df_logs["date_obj"] = pd.to_datetime(df_logs["date"])
                latest_logs = df_logs.sort_values("date_obj").groupby(["facility_id", "medicine_id"]).tail(1)
                
                for _, row in latest_logs.iterrows():
                    avg_c = float(df_logs[(df_logs["facility_id"] == row["facility_id"]) & (df_logs["medicine_id"] == row["medicine_id"])]["consumption"].tail(14).mean())
                    inv = FacilityInventory(
                        facility_id=int(row["facility_id"]),
                        medicine_id=int(row["medicine_id"]),
                        current_stock=int(round(float(row["stock_level"]))),
                        avg_daily_consumption=round(avg_c, 2),
                    )
                    db.add(inv)
                db.commit()
                
            # Ensure distributors have inventory records with surplus stock
            distributors = db.query(Facility).filter(Facility.type == FacilityType.distributor).all()
            all_medicines = db.query(Medicine).all()
            for dist in distributors:
                for med in all_medicines:
                    db.add(FacilityInventory(
                        facility_id=dist.id,
                        medicine_id=med.id,
                        current_stock=5000,
                        avg_daily_consumption=0.0,
                        status=StockStatus.surplus
                    ))
            db.commit()

            print("Refreshing triage statuses...")
            refresh_all_statuses(db)
            print("Database population complete.")
        else:
            # Ensure existing database has distributor inventory if missing
            distributors = db.query(Facility).filter(Facility.type == FacilityType.distributor).all()
            all_medicines = db.query(Medicine).all()
            added = False
            for dist in distributors:
                for med in all_medicines:
                    has_inv = db.query(FacilityInventory).filter_by(facility_id=dist.id, medicine_id=med.id).first()
                    if not has_inv:
                        db.add(FacilityInventory(
                            facility_id=dist.id,
                            medicine_id=med.id,
                            current_stock=5000,
                            avg_daily_consumption=0.0,
                            status=StockStatus.surplus
                        ))
                        added = True
            
            # Normalize existing inventory rows: current_stock to int, avg_daily_consumption to 2 decimals
            all_inv = db.query(FacilityInventory).all()
            for inv in all_inv:
                inv.current_stock = int(round(inv.current_stock))
                inv.avg_daily_consumption = round(float(inv.avg_daily_consumption), 2)
            db.commit()
    finally:
        db.close()
