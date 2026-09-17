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

from typing import List, Dict, Any, Optional

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two points on the Earth surface.
    
    Args:
        lat1 (float): Latitude of the first point.
        lon1 (float): Longitude of the first point.
        lat2 (float): Latitude of the second point.
        lon2 (float): Longitude of the second point.
        
    Returns:
        float: The distance in kilometers.
    """
    earth_radius_km = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * earth_radius_km * math.asin(math.sqrt(a))

def is_dire_situation(db: Session, facility_id: int, medicine_id: int) -> bool:
    """
    Determine if a stockout is imminent or already happening.
    
    Args:
        db (Session): The database session.
        facility_id (int): The ID of the facility to check.
        medicine_id (int): The ID of the medicine to check.
        
    Returns:
        bool: True if current stock is 0 or status is 'stockout', False otherwise.
    """
    inventory = db.execute(
        select(FacilityInventory).where(
            FacilityInventory.facility_id == facility_id,
            FacilityInventory.medicine_id == medicine_id
        )
    ).scalar_one_or_none()
    
    if inventory is None:
        return False
        
    return inventory.current_stock <= 0 or inventory.status == StockStatus.stockout

def find_candidates(
    db: Session, 
    requesting_facility_id: int, 
    medicine_id: int, 
    exclude_ids: Optional[List[int]] = None
) -> List[Dict[str, Any]]:
    """
    Finds and ranks supply candidates based on surplus status, tier relationship, and distance.
    
    Args:
        db (Session): The database session.
        requesting_facility_id (int): The ID of the facility requesting the medicine.
        medicine_id (int): The ID of the medicine needed.
        exclude_ids (Optional[List[int]], optional): A list of facility IDs to exclude from the search. Defaults to None.
        
    Returns:
        List[Dict[str, Any]]: A list of dictionaries containing candidate details, 
        sorted by tier priority and physical distance.
    """
    if exclude_ids is None:
        exclude_ids = []
        
    requester = db.get(Facility, requesting_facility_id)
    if not requester:
        return []

    candidates = []
    
    all_facilities = db.execute(select(Facility)).scalars().all()
    for candidate in all_facilities:
        # Skip the requesting facility itself or any facilities we want to exclude
        if candidate.id == requester.id or candidate.id in exclude_ids:
            continue
            
        inventory = db.execute(
            select(FacilityInventory).where(
                FacilityInventory.facility_id == candidate.id,
                FacilityInventory.medicine_id == medicine_id
            )
        ).scalar_one_or_none()
        
        # Check stock availability
        if not inventory:
            if candidate.type.value == "distributor":
                available_stock = 5000
            else:
                continue
        else:
            available_stock = int(round(inventory.current_stock))
            # We only want to pull from facilities with a surplus, or from distributors
            if inventory.status != StockStatus.surplus and candidate.type.value != "distributor":
                continue

        # Calculate transit time based on distance
        distance_km = haversine_km(requester.latitude, requester.longitude, candidate.latitude, candidate.longitude)
        transit_minutes = max(10, int(round(distance_km * 3.5)))
        
        # Assign a tier score based on the relationship (lower score is better)
        # 1 = Peer Clinic, 2 = Parent Hospital, 2.5 = Network Clinic, 3 = Network Hospital, 3.5 = Zonal Distributor, 4 = Network Supplier
        tier_score = 4
        relation_str = "Network Supplier"
        
        if candidate.type.value == "distributor":
            tier_score = 3.5
            relation_str = "Zonal Distributor"
        elif candidate.type.value == "hospital":
            if candidate.id == requester.parent_facility_id:
                tier_score = 2
                relation_str = "Parent Hospital"
            else:
                tier_score = 3
                relation_str = "Network Hospital"
        elif candidate.type.value == "clinic":
            if candidate.parent_facility_id == requester.parent_facility_id:
                tier_score = 1
                relation_str = "Peer Clinic"
            else:
                tier_score = 2.5
                relation_str = "Network Clinic"
                
        candidates.append({
            "sourceId": candidate.id,
            "sourceName": candidate.name,
            "availableStock": int(round(available_stock)),
            "distance": round(distance_km, 1),
            "transitMinutes": transit_minutes,
            "time": f"{transit_minutes} mins",
            "relation": relation_str,
            "tierScore": tier_score
        })
        
    # Sort first by tier priority, then by physical distance
    candidates.sort(key=lambda x: (x["tierScore"], x["distance"]))
    return candidates
