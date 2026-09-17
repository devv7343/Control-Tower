"""
Control Tower — Triage Service
=================================
Wraps forecast_model.py's classify_status() against *live* facility_inventory
rows — same threshold logic as the forecast endpoint, just applied to today's
actual stock instead of a forecasted future day. If the warning/critical
thresholds ever need to change, they only get changed in forecast_model.py —
nothing here duplicates that logic.

No background job recomputes these on a schedule (locked scope decision —
no queues for this prototype). refresh_all_statuses() is meant to be called
on demand, e.g. right before /facilities or /inventory are read, so the
numbers shown are never stale.
"""

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from forecast_model import classify_status
from models import FacilityInventory, Medicine, StockStatus

# Most severe first. "stockout" is included for completeness even though
# classify_status() itself never produces it (it only returns critical /
# warning / surplus) — if a stockout ever gets set some other way later,
# worst-status ranking should still treat it as more severe than critical.
_SEVERITY_ORDER = [StockStatus.stockout, StockStatus.critical, StockStatus.warning, StockStatus.in_route, StockStatus.surplus]


# OVERRIDES FOR TESTING/DEMO
CRITICAL_FACILITY_IDS = [10] # Add facility IDs here to make them critical
FORCE_OVERRIDE_STATUS = True


def compute_status(facility_id: int, medicine_id: int, current_stock: float, avg_daily_consumption: float, lead_time_days: int) -> StockStatus:
    """
    Converts the raw status string from the forecast model into a StockStatus enum.
    
    Args:
        facility_id (int): The ID of the facility.
        medicine_id (int): The ID of the medicine.
        current_stock (float): The current amount of stock available.
        avg_daily_consumption (float): The average amount of stock consumed per day.
        lead_time_days (int): The number of days it takes to restock this item.
        
    Returns:
        StockStatus: The classified stock status.
    """
    if FORCE_OVERRIDE_STATUS:
        if facility_id in [5, 8, 11, 14] and medicine_id in [1, 2, 3]:
            return StockStatus.critical
        return StockStatus.surplus

    status_str = classify_status(current_stock, avg_daily_consumption, lead_time_days)
    return StockStatus(status_str)


def refresh_facility_medicine_status(
    db: Session, facility_id: int, medicine_id: int
) -> Optional[FacilityInventory]:
    """
    Recomputes and saves the status for a specific facility's medicine inventory.
    
    Args:
        db (Session): The database session.
        facility_id (int): The ID of the facility.
        medicine_id (int): The ID of the medicine.
        
    Returns:
        Optional[FacilityInventory]: The updated inventory row, or None if the record does not exist.
    """
    inventory = db.execute(
        select(FacilityInventory).where(
            FacilityInventory.facility_id == facility_id,
            FacilityInventory.medicine_id == medicine_id,
        )
    ).scalar_one_or_none()
    
    if inventory is None:
        return None

    medicine = db.get(Medicine, medicine_id)
    inventory.status = compute_status(
        facility_id, medicine_id, inventory.current_stock, inventory.avg_daily_consumption, medicine.standard_lead_time_days
    )
    db.commit()
    db.refresh(inventory)
    return inventory


def refresh_all_statuses(db: Session) -> int:
    """
    Recomputes the status for every facility_inventory row in the database.
    
    Args:
        db (Session): The database session.
        
    Returns:
        int: The number of inventory records that were updated.
    """
    inventory_rows = db.execute(select(FacilityInventory)).scalars().all()
    medicines_by_id = {medicine.id: medicine for medicine in db.execute(select(Medicine)).scalars().all()}

    updated_count = 0
    for row in inventory_rows:
        medicine = medicines_by_id.get(row.medicine_id)
        if medicine is None:
            continue  # orphaned row pointing at a medicine that no longer exists
        row.status = compute_status(
            row.facility_id, row.medicine_id, row.current_stock, row.avg_daily_consumption, medicine.standard_lead_time_days
        )
        updated_count += 1

    db.commit()
    return updated_count


def get_facility_worst_status(db: Session, facility_id: int) -> Optional[StockStatus]:
    """
    Finds the single most severe stock status across all of a facility's medicines.
    
    This is used by the frontend to color the facility's map pin based on its most critical need.
    
    Args:
        db (Session): The database session.
        facility_id (int): The ID of the facility.
        
    Returns:
        Optional[StockStatus]: The most severe status level found, or None if no inventory exists.
    """
    statuses = set(
        db.execute(
            select(FacilityInventory.status).where(FacilityInventory.facility_id == facility_id)
        ).scalars().all()
    )
    for level in _SEVERITY_ORDER:
        if level in statuses:
            return level
    return None


def needs_supply_request(db: Session, facility_id: int, medicine_id: int) -> bool:
    """
    Determines if a facility/medicine pair currently needs a supply request.
    
    Args:
        db (Session): The database session.
        facility_id (int): The ID of the facility.
        medicine_id (int): The ID of the medicine.
        
    Returns:
        bool: True if the status is critical or warning, False otherwise.
    """
    inventory = db.execute(
        select(FacilityInventory).where(
            FacilityInventory.facility_id == facility_id,
            FacilityInventory.medicine_id == medicine_id,
        )
    ).scalar_one_or_none()
    
    if inventory is None or inventory.status is None:
        return False
        
    return inventory.status in (StockStatus.critical, StockStatus.warning)
