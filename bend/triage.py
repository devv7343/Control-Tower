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
_SEVERITY_ORDER = [StockStatus.stockout, StockStatus.critical, StockStatus.warning, StockStatus.surplus]


def compute_status(current_stock: float, avg_daily_consumption: float, lead_time_days: int) -> StockStatus:
    """classify_status() returns a plain lowercase string; this converts it
    to the StockStatus enum so the rest of the backend deals with one
    consistent type instead of raw strings floating around."""
    status_str = classify_status(current_stock, avg_daily_consumption, lead_time_days)
    return StockStatus(status_str)


def refresh_facility_medicine_status(
    db: Session, facility_id: int, medicine_id: int
) -> Optional[FacilityInventory]:
    """Recomputes and saves .status for one (facility, medicine) row, using
    that medicine's standard_lead_time_days. Returns the updated row, or
    None if no facility_inventory row exists yet for this pair."""
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
        inventory.current_stock, inventory.avg_daily_consumption, medicine.standard_lead_time_days
    )
    db.commit()
    db.refresh(inventory)
    return inventory


def refresh_all_statuses(db: Session) -> int:
    """Recomputes .status for every facility_inventory row in one pass.
    Returns the number of rows updated."""
    rows = db.execute(select(FacilityInventory)).scalars().all()
    medicines_by_id = {m.id: m for m in db.execute(select(Medicine)).scalars().all()}

    updated = 0
    for row in rows:
        medicine = medicines_by_id.get(row.medicine_id)
        if medicine is None:
            continue  # orphaned row pointing at a medicine that no longer exists
        row.status = compute_status(
            row.current_stock, row.avg_daily_consumption, medicine.standard_lead_time_days
        )
        updated += 1

    db.commit()
    return updated


def get_facility_worst_status(db: Session, facility_id: int) -> Optional[StockStatus]:
    """The single most severe status across all of a facility's medicines —
    this is what GET /facilities uses to color one map pin per facility,
    since a pin can only be one color. Returns None if the facility has no
    inventory rows at all yet."""
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
    """True if this facility/medicine pair is currently critical or warning
    — the trigger condition escalation.py checks before creating a transfer
    request or suggesting a quantity. Relies on .status already being
    up to date — call refresh_facility_medicine_status() first if unsure."""
    inventory = db.execute(
        select(FacilityInventory).where(
            FacilityInventory.facility_id == facility_id,
            FacilityInventory.medicine_id == medicine_id,
        )
    ).scalar_one_or_none()
    if inventory is None or inventory.status is None:
        return False
    return inventory.status in (StockStatus.critical, StockStatus.warning)
