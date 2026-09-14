"""
Control Tower — Escalation Logic
=================================
Handles finding the best candidate facility to supply a requested medicine,
and determining if a shortage is severe enough to warrant a 'dire' fan-out.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session
from models import Facility, FacilityInventory, StockStatus
import math

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

def is_dire_situation(db: Session, facility_id: int, medicine_id: int) -> bool:
    """True if stockout is imminent (e.g. current stock is 0 or status is stockout)."""
    inv = db.execute(
        select(FacilityInventory).where(
            FacilityInventory.facility_id == facility_id,
            FacilityInventory.medicine_id == medicine_id
        )
    ).scalar_one_or_none()
    
    if inv is None:
        return False
        
    return inv.current_stock <= 0 or inv.status == StockStatus.stockout

def find_candidates(db: Session, requesting_facility_id: int, medicine_id: int, exclude_ids: list = None):
    """
    Finds and ranks supply candidates based on surplus status, tier relationship, and distance.
    Returns a list of dictionaries with candidate details.
    """
    if exclude_ids is None:
        exclude_ids = []
        
    requester = db.get(Facility, requesting_facility_id)
    if not requester:
        return []

    candidates = []
    
    all_facilities = db.execute(select(Facility)).scalars().all()
    for cand in all_facilities:
        if cand.id == requester.id or cand.id in exclude_ids:
            continue
            
        inv = db.execute(
            select(FacilityInventory).where(
                FacilityInventory.facility_id == cand.id,
                FacilityInventory.medicine_id == medicine_id
            )
        ).scalar_one_or_none()
        
        if not inv:
            if cand.type.value == "distributor":
                available_stock = 5000.0
            else:
                continue
        else:
            available_stock = inv.current_stock
            if inv.status != StockStatus.surplus and cand.type.value != "distributor":
                continue

        dist_km = haversine_km(requester.latitude, requester.longitude, cand.latitude, cand.longitude)
        transit_mins = max(10, int(round(dist_km * 3.5)))
        
        tier_score = 4
        relation_str = "Network Supplier"
        if cand.type.value == "distributor":
            tier_score = 3.5
            relation_str = "Zonal Distributor"
        elif cand.type.value == "hospital":
            if cand.id == requester.parent_facility_id:
                tier_score = 2
                relation_str = "Parent Hospital"
            else:
                tier_score = 3
                relation_str = "Network Hospital"
        elif cand.type.value == "clinic":
            if cand.parent_facility_id == requester.parent_facility_id:
                tier_score = 1
                relation_str = "Peer Clinic"
            else:
                tier_score = 2.5
                relation_str = "Network Clinic"
                
        candidates.append({
            "sourceId": cand.id,
            "sourceName": cand.name,
            "availableStock": available_stock,
            "distance": round(dist_km, 1),
            "transitMinutes": transit_mins,
            "time": f"{transit_mins} mins",
            "relation": relation_str,
            "tierScore": tier_score
        })
        
    # Sort first by tier priority, then by physical distance
    candidates.sort(key=lambda x: (x["tierScore"], x["distance"]))
    return candidates
