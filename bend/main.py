"""
Control Tower — Main FastAPI Application
=========================================
Entry point for the backend API. Sets up CORS, includes all routing, 
and handles database initialization on startup. If the database is empty, 
it automatically populates it with synthetic mock data from CSVs.
"""

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

import sys
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app.include_router(router, prefix="/api")

if hasattr(sys, '_MEIPASS'):
    dist_dir = os.path.join(sys._MEIPASS, 'fend', 'dist')
    base_dir = sys._MEIPASS
else:
    dist_dir = os.path.join(os.path.dirname(__file__), '..', 'fend', 'dist')
    base_dir = os.path.dirname(__file__)

if os.path.exists(dist_dir):
    app.mount("/", StaticFiles(directory=dist_dir, html=True), name="static")
@app.on_event("startup")
def on_startup():
    """
    Execute initialization logic when the FastAPI server starts.
    Creates tables and seeds data if the database is newly created.
    """
    init_db()
    
    db = SessionLocal()
    try:
        base_dir = os.path.dirname(__file__)
        medicines_csv = os.path.join(base_dir, "medicines.csv")
        facilities_csv = os.path.join(base_dir, "facilities.csv")
        logs_csv = os.path.join(base_dir, "inventory_logs.csv")

        # Check if DB is already populated
        if db.query(Facility).count() == 0:
            print("Database empty. Populating from CSVs...")
            
            # Load Medicines
            if os.path.exists(medicines_csv):
                medicines_df = pd.read_csv(medicines_csv)
                for _, row in medicines_df.iterrows():
                    medicine = Medicine(
                        id=int(row["id"]),
                        name=row["name"],
                        category=row["category"],
                        unit=row["unit"],
                        standard_lead_time_days=int(row["lead_time_days"])
                    )
                    db.add(medicine)
                db.commit()
                
            # Load Facilities
            if os.path.exists(facilities_csv):
                facilities_df = pd.read_csv(facilities_csv)
                # Sort to ensure parent facilities exist before children reference them
                facilities_df = facilities_df.sort_values(by="parent_facility_id", na_position="first")
                for _, row in facilities_df.iterrows():
                    facility = Facility(
                        id=int(row["id"]),
                        name=row["name"],
                        type=row["type"],
                        latitude=row["lat"],
                        longitude=row["lon"],
                        storage_capacity_units=int(row["capacity"]),
                        parent_facility_id=int(row["parent_facility_id"]) if pd.notna(row["parent_facility_id"]) else None
                    )
                    db.add(facility)
                db.commit()
                
            # Load Inventory Logs and calculate current stock
            if os.path.exists(logs_csv):
                print("Loading inventory logs... This might take a few seconds.")
                logs_df = pd.read_csv(logs_csv)
                
                logs_df["date_obj"] = pd.to_datetime(logs_df["date"])
                latest_logs = logs_df.sort_values("date_obj").groupby(["facility_id", "medicine_id"]).tail(1)
                
                for _, row in latest_logs.iterrows():
                    avg_consumption = float(logs_df[(logs_df["facility_id"] == row["facility_id"]) & (logs_df["medicine_id"] == row["medicine_id"])]["consumption"].tail(14).mean())
                    inventory = FacilityInventory(
                        facility_id=int(row["facility_id"]),
                        medicine_id=int(row["medicine_id"]),
                        current_stock=int(round(float(row["stock_level"]))),
                        avg_daily_consumption=round(avg_consumption, 2),
                    )
                    db.add(inventory)
                db.commit()
                
            # Ensure distributors have inventory records with surplus stock
            distributors = db.query(Facility).filter(Facility.type == FacilityType.distributor).all()
            all_medicines = db.query(Medicine).all()
            for distributor in distributors:
                for medicine in all_medicines:
                    db.add(FacilityInventory(
                        facility_id=distributor.id,
                        medicine_id=medicine.id,
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
            
            for distributor in distributors:
                for medicine in all_medicines:
                    has_inventory = db.query(FacilityInventory).filter_by(facility_id=distributor.id, medicine_id=medicine.id).first()
                    if not has_inventory:
                        db.add(FacilityInventory(
                            facility_id=distributor.id,
                            medicine_id=medicine.id,
                            current_stock=5000,
                            avg_daily_consumption=0.0,
                            status=StockStatus.surplus
                        ))
            
            # Normalize existing inventory rows: current_stock to int, avg_daily_consumption to 2 decimals
            all_inventory = db.query(FacilityInventory).all()
            for inventory in all_inventory:
                inventory.current_stock = int(round(inventory.current_stock))
                inventory.avg_daily_consumption = round(float(inventory.avg_daily_consumption), 2)
            db.commit()
    finally:
        db.close()

if __name__ == "__main__":
    import uvicorn
    # Open browser automatically
    import threading
    import webbrowser
    import time
    
    def open_browser():
        time.sleep(2)
        webbrowser.open("http://127.0.0.1:8000")
        
    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=8000)
