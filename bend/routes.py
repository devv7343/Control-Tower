"""
API Routing for the Medical Supply Logistics Platform.

This module defines the endpoints for managing facilities, their inventory levels,
and orchestrating the transfer of medical supplies between them. It includes
smart routing to find the best candidate facilities for transfers and handles
automatic escalation if supplies are critically low.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select
from typing import List, Optional
import datetime
import os
from database import get_db
from models import Facility, FacilityInventory, Medicine, TransferRequest, TransferMatch, StockStatus, TransferStatus, EscalationLevel
from schemas import (
    FacilityFeatureCollection, FacilityFeature, FacilityGeometry, FacilityProperties, FacilityMedicineStatus,
    InventoryResponse, InventorySummary, InventoryItem,
    ForecastResponse, SuggestedQuantityResponse,
    TransferRequestCreate, TransferRequestOut, TransferRespondRequest, TransferListResponse
)
from triage import refresh_facility_medicine_status, compute_status, get_facility_worst_status
from forecast_model import run_forecast
from escalation import is_dire_situation, find_candidates

router = APIRouter()

@router.get("/facilities", response_model=FacilityFeatureCollection)
def get_facilities(db: Session = Depends(get_db)) -> FacilityFeatureCollection:
    """
    Retrieve all facilities and their current inventory statuses.
    
    This endpoint formats the facilities as a GeoJSON FeatureCollection,
    making it suitable for map-based visualizations. It calculates the 
    worst inventory status across all medicines for each facility to 
    highlight areas needing immediate attention.
    
    Args:
        db (Session): The database session.
        
    Returns:
        FacilityFeatureCollection: A GeoJSON collection of all facilities.
    """
    facilities = db.execute(select(Facility)).scalars().all()
    features = []
    
    for facility in facilities:
        worst_status = get_facility_worst_status(db, facility.id)
        if worst_status is None:
            worst_status = StockStatus.surplus
            
        active_transfers = db.execute(
            select(TransferRequest).where(
                TransferRequest.requesting_facility_id == facility.id,
                TransferRequest.status == TransferStatus.in_transit
            )
        ).scalars().all()
        in_transit_med_ids = {transfer.medicine_id for transfer in active_transfers}
        
        statuses = set()
        inventory_records = db.execute(select(FacilityInventory).where(FacilityInventory.facility_id == facility.id)).scalars().all()
        medicines_list = []
        for inventory in inventory_records:
            med_capacity = int(round(inventory.reorder_point * 2)) if inventory.reorder_point else 150
            status = inventory.status or StockStatus.surplus
            if inventory.medicine.id in in_transit_med_ids:
                status = StockStatus.in_route
            statuses.add(status)
            medicines_list.append(FacilityMedicineStatus(
                medicine_id=inventory.medicine.id,
                medicine_name=inventory.medicine.name,
                status=status,
                current_stock=int(round(inventory.current_stock)),
                capacity=med_capacity,
                avg_daily_consumption=round(float(inventory.avg_daily_consumption), 2) if inventory.avg_daily_consumption is not None else None
            ))
            
        from triage import _SEVERITY_ORDER
        worst_status = StockStatus.surplus
        for level in _SEVERITY_ORDER:
            if level in statuses:
                worst_status = level
                break
                
        features.append(FacilityFeature(
            type="Feature",
            geometry=FacilityGeometry(type="Point", coordinates=(facility.longitude, facility.latitude)),
            properties=FacilityProperties(
                id=facility.id,
                name=facility.name,
                type=facility.type,
                zone_id=facility.zone_id,
                parent_facility_id=facility.parent_facility_id,
                worst_status=worst_status,
                medicines=medicines_list
            )
        ))
        
    return FacilityFeatureCollection(type="FeatureCollection", features=features)


@router.get("/inventory", response_model=InventoryResponse)
def get_inventory(
    facility_id: Optional[int] = None,
    medicine_id: Optional[int] = None,
    status: Optional[StockStatus] = None,
    db: Session = Depends(get_db)
) -> InventoryResponse:
    """
    Get a summary and detailed list of inventory across facilities.
    
    Can be filtered by specific facility, medicine, or stock status.
    Provides a quick overview of how many items are in critical, warning,
    or surplus states.
    
    Args:
        facility_id (Optional[int]): Filter by facility ID.
        medicine_id (Optional[int]): Filter by medicine ID.
        status (Optional[StockStatus]): Filter by inventory status.
        db (Session): The database session.
        
    Returns:
        InventoryResponse: The inventory summary and detailed items.
    """
    query = select(FacilityInventory)
    if facility_id is not None:
        query = query.where(FacilityInventory.facility_id == facility_id)
    if medicine_id is not None:
        query = query.where(FacilityInventory.medicine_id == medicine_id)
    if status is not None:
        query = query.where(FacilityInventory.status == status)
        
    all_inventory = db.execute(select(FacilityInventory)).scalars().all()
    
    # Pre-fetch all active transfers to avoid N+1 queries
    active_transfers = db.execute(
        select(TransferRequest).where(TransferRequest.status == TransferStatus.in_transit)
    ).scalars().all()
    in_transit_keys = {(t.requesting_facility_id, t.medicine_id) for t in active_transfers}
    
    summary = {"critical": 0, "warning": 0, "surplus": 0}
    items = []
    
    for record in all_inventory:
        effective_status = record.status or StockStatus.surplus
        if (record.facility_id, record.medicine_id) in in_transit_keys:
            effective_status = StockStatus.in_route
            
        if effective_status in (StockStatus.critical, StockStatus.stockout):
            summary["critical"] += 1
        elif effective_status == StockStatus.warning:
            summary["warning"] += 1
        else:
            summary["surplus"] += 1
            
        # Apply filters in Python to ensure effective_status is respected
        if facility_id is not None and record.facility_id != facility_id:
            continue
        if medicine_id is not None and record.medicine_id != medicine_id:
            continue
        if status is not None and effective_status != status:
            continue
            
        items.append({
            "facility_id": record.facility.id,
            "facility_name": record.facility.name,
            "medicine_id": record.medicine.id,
            "medicine_name": record.medicine.name,
            "current_stock": int(round(record.current_stock)),
            "avg_daily_consumption": round(float(record.avg_daily_consumption), 2),
            "status": effective_status,
            "updated_at": record.updated_at
        })
        
    return InventoryResponse(summary=InventorySummary(**summary), items=items)


@router.get("/forecast", response_model=ForecastResponse)
def get_forecast(
    facility_id: int,
    medicine_id: int,
    horizon: int = 7,
    lead_time_days: int = 5,
    db: Session = Depends(get_db)
) -> ForecastResponse:
    """
    Generate an inventory forecast for a specific facility and medicine.
    
    Uses historical data to predict future consumption over a given horizon,
    accounting for lead times to suggest when reordering might be necessary.
    
    Args:
        facility_id (int): The ID of the facility.
        medicine_id (int): The ID of the medicine.
        horizon (int): The number of days to forecast into the future.
        lead_time_days (int): The lead time for restocking.
        db (Session): The database session.
        
    Returns:
        ForecastResponse: The predicted daily consumption and stock levels.
        
    Raises:
        HTTPException: If the facility or medicine data is invalid or missing.
    """
    csv_path = os.path.join(os.path.dirname(__file__), "inventory_logs.csv")
    try:
        facility = db.get(Facility, facility_id)
        medicine = db.get(Medicine, medicine_id)
        forecasts = run_forecast(csv_path, facility_id, medicine_id, horizon, lead_time_days)
        
        return ForecastResponse(
            facility_id=facility_id,
            facility_name=facility.name if facility else f"Facility #{facility_id}",
            medicine_id=medicine_id,
            medicine_name=medicine.name if medicine else f"Medicine #{medicine_id}",
            forecast=forecasts
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@router.get("/forecast/suggested-quantity", response_model=SuggestedQuantityResponse)
def get_suggested_quantity(
    facility_id: int,
    medicine_id: int,
    db: Session = Depends(get_db)
) -> SuggestedQuantityResponse:
    """
    Calculate the suggested reorder quantity for a medicine at a facility.
    
    This helps facility managers know exactly how much to request based on 
    predicted consumption during the standard lead time for that medicine.
    
    Args:
        facility_id (int): The ID of the facility.
        medicine_id (int): The ID of the medicine.
        db (Session): The database session.
        
    Returns:
        SuggestedQuantityResponse: The recommended quantity to order.
        
    Raises:
        HTTPException: If the inventory record is not found or invalid.
    """
    inventory = db.execute(
        select(FacilityInventory).where(
            FacilityInventory.facility_id == facility_id, 
            FacilityInventory.medicine_id == medicine_id
        )
    ).scalar_one_or_none()
    
    if not inventory:
        raise HTTPException(status_code=404, detail="Inventory not found")
        
    lead_time_days = inventory.medicine.standard_lead_time_days
    csv_path = os.path.join(os.path.dirname(__file__), "inventory_logs.csv")
    
    try:
        forecasts = run_forecast(
            csv_path, 
            facility_id, 
            medicine_id, 
            horizon=lead_time_days, 
            lead_time_days=lead_time_days
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
        
    total_consumption = sum(f["predicted_consumption"] for f in forecasts)
    suggested_amount = max(0, int(round(total_consumption - inventory.current_stock)))
    
    return SuggestedQuantityResponse(
        facility_id=facility_id,
        medicine_id=medicine_id,
        suggested_quantity=suggested_amount,
        based_on={
            "current_stock": int(round(inventory.current_stock)),
            "predicted_daily_consumption": round(float(inventory.avg_daily_consumption), 2),
            "lead_time_days": lead_time_days
        }
    )


@router.post("/transfers", response_model=TransferRequestOut, status_code=201)
def create_transfer(payload: TransferRequestCreate, db: Session = Depends(get_db)) -> dict:
    """
    Initiate a transfer request for medicines between facilities.
    
    Automatically finds the best candidate facilities to supply the medicine.
    If the situation is dire and one facility cannot meet the need, the request 
    is fanned out to multiple facilities. If no candidates are found, the 
    request is escalated to the regional authority.
    
    Args:
        payload (TransferRequestCreate): The details of the transfer request.
        db (Session): The database session.
        
    Returns:
        dict: The created transfer request and its initial matches.
        
    Raises:
        HTTPException: If the requesting facility does not exist.
    """
    requester = db.get(Facility, payload.requesting_facility_id)
    if not requester:
        raise HTTPException(status_code=404, detail="Requesting facility not found")
        
    is_dire = is_dire_situation(db, payload.requesting_facility_id, payload.medicine_id)
    candidates = find_candidates(db, payload.requesting_facility_id, payload.medicine_id)
    
    if not candidates:
        # No peers have enough stock; escalate immediately to higher authorities
        transfer_request = TransferRequest(
            requesting_facility_id=payload.requesting_facility_id,
            medicine_id=payload.medicine_id,
            quantity_requested=payload.quantity_requested,
            priority=payload.priority,
            status=TransferStatus.escalated,
            current_escalation_level=EscalationLevel.regional_authority,
            is_dire=is_dire
        )
        db.add(transfer_request)
        db.commit()
        db.refresh(transfer_request)
        return _format_transfer_response(transfer_request)
        
    if is_dire and len(candidates) > 1:
        # In dire situations, fan out the request to multiple candidates to gather stock faster
        first_request = None
        for candidate in candidates:
            transfer_request = TransferRequest(
                requesting_facility_id=payload.requesting_facility_id,
                medicine_id=payload.medicine_id,
                quantity_requested=payload.quantity_requested,
                priority=payload.priority,
                status=TransferStatus.pending,
                current_escalation_level=EscalationLevel.peer_facility if candidate["tierScore"] == 1 else EscalationLevel.zonal_distributor,
                parent_request_id=first_request.id if first_request else None,
                is_dire=True
            )
            db.add(transfer_request)
            db.commit()
            db.refresh(transfer_request)
            
            if first_request is None:
                first_request = transfer_request
                
            match = TransferMatch(
                transfer_request_id=transfer_request.id,
                supplying_facility_id=candidate["sourceId"],
                quantity_offered=int(round(min(payload.quantity_requested, candidate["availableStock"]))),
                distance_km=candidate["distance"],
                estimated_transit_minutes=candidate["transitMinutes"],
                match_status="proposed"
            )
            db.add(match)
            db.commit()
            
        db.refresh(first_request)
        return _format_transfer_response(first_request)
        
    else:
        # Standard case: route the request to the best single candidate
        best_candidate = candidates[0]
        transfer_request = TransferRequest(
            requesting_facility_id=payload.requesting_facility_id,
            medicine_id=payload.medicine_id,
            quantity_requested=int(round(payload.quantity_requested)),
            priority=payload.priority,
            status=TransferStatus.pending,
            current_escalation_level=EscalationLevel.peer_facility if best_candidate["tierScore"] == 1 else EscalationLevel.zonal_distributor,
            is_dire=is_dire
        )
        db.add(transfer_request)
        db.commit()
        db.refresh(transfer_request)
        
        match = TransferMatch(
            transfer_request_id=transfer_request.id,
            supplying_facility_id=best_candidate["sourceId"],
            quantity_offered=int(round(min(payload.quantity_requested, best_candidate["availableStock"]))),
            distance_km=best_candidate["distance"],
            estimated_transit_minutes=best_candidate["transitMinutes"],
            match_status="proposed"
        )
        db.add(match)
        db.commit()
        db.refresh(transfer_request)
        
        return _format_transfer_response(transfer_request)


@router.get("/candidates")
def get_candidates(requesting_facility_id: int, medicine_id: int, db: Session = Depends(get_db)) -> dict:
    """
    Find potential facilities that can supply a specific medicine.
    
    Evaluates stock levels, distance, and tier scores to return a ranked list 
    of the best facilities to transfer from.
    
    Args:
        requesting_facility_id (int): The ID of the facility needing supply.
        medicine_id (int): The ID of the medicine needed.
        db (Session): The database session.
        
    Returns:
        dict: A dictionary containing the ranked list of candidates.
    """
    candidates = find_candidates(db, requesting_facility_id, medicine_id)
    return {"candidates": candidates}


@router.patch("/transfers/{id}/respond", response_model=TransferRequestOut)
def respond_transfer(id: int, payload: TransferRespondRequest, db: Session = Depends(get_db)) -> dict:
    """
    Accept or reject a proposed transfer match.
    
    If accepted and the full quantity is not met, automatically creates a 
    shortfall request targeting the next best candidate. If rejected, 
    routes the request to the next available candidate or escalates.
    
    Args:
        id (int): The ID of the transfer request.
        payload (TransferRespondRequest): The response action (accept or reject) and offered quantity.
        db (Session): The database session.
        
    Returns:
        dict: The updated transfer request.
        
    Raises:
        HTTPException: If the transfer request or match is not found.
    """
    transfer_request = db.get(TransferRequest, id)
    if not transfer_request:
        raise HTTPException(status_code=404, detail="Transfer request not found")
        
    match = db.get(TransferMatch, payload.match_id)
    if not match or match.transfer_request_id != transfer_request.id:
        raise HTTPException(status_code=404, detail="Associated match not found")
        
    if payload.action == "accept":
        match.match_status = "accepted"
        offered = int(round(payload.quantity_offered))
        match.quantity_offered = offered
        transfer_request.quantity_fulfilled += offered
        
        if transfer_request.quantity_fulfilled >= transfer_request.quantity_requested:
            # The transfer completely satisfies the request
            transfer_request.status = TransferStatus.in_transit
            transfer_request.resolved_at = datetime.datetime.now(datetime.UTC)
        else:
            # We still need more stock, move what we have in transit and create a shortfall request
            transfer_request.status = TransferStatus.in_transit
            shortfall = int(round(transfer_request.quantity_requested - transfer_request.quantity_fulfilled))
            
            # Find the next best facility to ask for the remaining stock
            used_facility_ids = [m.supplying_facility_id for m in transfer_request.matches]
            candidates = find_candidates(db, transfer_request.requesting_facility_id, transfer_request.medicine_id, exclude_ids=used_facility_ids)
            
            if candidates:
                next_candidate = candidates[0]
                new_request = TransferRequest(
                    requesting_facility_id=transfer_request.requesting_facility_id,
                    medicine_id=transfer_request.medicine_id,
                    quantity_requested=shortfall,
                    priority=transfer_request.priority,
                    status=TransferStatus.pending,
                    current_escalation_level=EscalationLevel.peer_facility if next_candidate["tierScore"] == 1 else EscalationLevel.zonal_distributor,
                    parent_request_id=transfer_request.id,
                    is_dire=transfer_request.is_dire
                )
                db.add(new_request)
                db.commit()
                db.refresh(new_request)
                
                new_match = TransferMatch(
                    transfer_request_id=new_request.id,
                    supplying_facility_id=next_candidate["sourceId"],
                    quantity_offered=int(round(min(shortfall, next_candidate["availableStock"]))),
                    distance_km=next_candidate["distance"],
                    estimated_transit_minutes=next_candidate["transitMinutes"],
                    match_status="proposed"
                )
                db.add(new_match)
            else:
                # No more candidates, escalate the shortfall
                new_request = TransferRequest(
                    requesting_facility_id=transfer_request.requesting_facility_id,
                    medicine_id=transfer_request.medicine_id,
                    quantity_requested=shortfall,
                    priority=transfer_request.priority,
                    status=TransferStatus.escalated,
                    current_escalation_level=EscalationLevel.regional_authority,
                    parent_request_id=transfer_request.id,
                    is_dire=transfer_request.is_dire
                )
                db.add(new_request)
                
    elif payload.action == "reject":
        match.match_status = "rejected"
        
        # Facility declined, find who to ask next
        used_facility_ids = [m.supplying_facility_id for m in transfer_request.matches]
        candidates = find_candidates(db, transfer_request.requesting_facility_id, transfer_request.medicine_id, exclude_ids=used_facility_ids)
        
        if candidates:
            next_candidate = candidates[0]
            new_match = TransferMatch(
                transfer_request_id=transfer_request.id,
                supplying_facility_id=next_candidate["sourceId"],
                quantity_offered=int(round(min(transfer_request.quantity_requested, next_candidate["availableStock"]))),
                distance_km=next_candidate["distance"],
                estimated_transit_minutes=next_candidate["transitMinutes"],
                match_status="proposed"
            )
            db.add(new_match)
            transfer_request.status = TransferStatus.pending
            transfer_request.current_escalation_level = EscalationLevel.peer_facility if next_candidate["tierScore"] == 1 else EscalationLevel.zonal_distributor
        else:
            # We ran out of peers to ask, time to escalate
            transfer_request.status = TransferStatus.escalated
            transfer_request.current_escalation_level = EscalationLevel.regional_authority

    db.commit()
    db.refresh(transfer_request)
    return _format_transfer_response(transfer_request)


@router.get("/transfers", response_model=TransferListResponse)
def get_transfers(
    status: Optional[TransferStatus] = None,
    parent_request_id: Optional[int] = None,
    db: Session = Depends(get_db)
) -> TransferListResponse:
    """
    List transfer requests, optionally filtered by status or parent request.
    
    Provides visibility into the logistics network, showing what medicines 
    are moving where, and which requests are still pending or escalated.
    
    Args:
        status (Optional[TransferStatus]): Filter by transfer status.
        parent_request_id (Optional[int]): Filter by the parent request ID.
        db (Session): The database session.
        
    Returns:
        TransferListResponse: A list of transfer requests matching the criteria.
    """
    query = select(TransferRequest)
    if status:
        query = query.where(TransferRequest.status == status)
    if parent_request_id is not None:
        query = query.where(TransferRequest.parent_request_id == parent_request_id)
        
    requests = db.execute(query).scalars().all()
    return TransferListResponse(items=[_format_transfer_response(req) for req in requests])


def _format_transfer_response(transfer_request: TransferRequest) -> dict:
    """
    Helper to cleanly format a TransferRequest model into a dictionary 
    suitable for the API response schema, handling missing relationships gracefully.
    
    Args:
        transfer_request (TransferRequest): The transfer request object.
        
    Returns:
        dict: The formatted representation of the transfer request.
    """
    req = transfer_request
    return {
        "id": req.id,
        "requesting_facility_id": req.requesting_facility_id,
        "requesting_facility_name": req.requesting_facility.name if req.requesting_facility else f"Facility #{req.requesting_facility_id}",
        "medicine_id": req.medicine_id,
        "medicine_name": req.medicine.name if req.medicine else f"Medicine #{req.medicine_id}",
        "quantity_requested": int(round(req.quantity_requested)),
        "quantity_fulfilled": int(round(req.quantity_fulfilled)),
        "priority": req.priority,
        "status": req.status,
        "current_escalation_level": req.current_escalation_level,
        "parent_request_id": req.parent_request_id,
        "is_dire": req.is_dire,
        "created_at": req.created_at,
        "resolved_at": req.resolved_at,
        "matches": [
            {
                "id": m.id,
                "supplying_facility_id": m.supplying_facility_id,
                "supplying_facility_name": m.supplying_facility.name if m.supplying_facility else f"Facility #{m.supplying_facility_id}",
                "quantity_offered": int(round(m.quantity_offered)),
                "distance_km": m.distance_km,
                "estimated_transit_minutes": m.estimated_transit_minutes,
                "match_status": m.match_status
            }
            for m in req.matches
        ]
    }
