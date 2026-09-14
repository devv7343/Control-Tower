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
def get_facilities(db: Session = Depends(get_db)):
    facilities = db.execute(select(Facility)).scalars().all()
    features = []
    
    for f in facilities:
        worst_status = get_facility_worst_status(db, f.id)
        if worst_status is None:
            worst_status = StockStatus.surplus
            
        inv_rows = db.execute(select(FacilityInventory).where(FacilityInventory.facility_id == f.id)).scalars().all()
        medicines_list = []
        for inv in inv_rows:
            med_capacity = (inv.reorder_point * 2) if inv.reorder_point else 150.0
            medicines_list.append(FacilityMedicineStatus(
                medicine_id=inv.medicine.id,
                medicine_name=inv.medicine.name,
                status=inv.status or StockStatus.surplus,
                current_stock=inv.current_stock,
                capacity=med_capacity,
                avg_daily_consumption=inv.avg_daily_consumption
            ))
            
        features.append(FacilityFeature(
            type="Feature",
            geometry=FacilityGeometry(type="Point", coordinates=(f.longitude, f.latitude)),
            properties=FacilityProperties(
                id=f.id,
                name=f.name,
                type=f.type,
                zone_id=f.zone_id,
                parent_facility_id=f.parent_facility_id,
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
):
    query = select(FacilityInventory)
    if facility_id is not None:
        query = query.where(FacilityInventory.facility_id == facility_id)
    if medicine_id is not None:
        query = query.where(FacilityInventory.medicine_id == medicine_id)
    if status is not None:
        query = query.where(FacilityInventory.status == status)
        
    all_rows = db.execute(select(FacilityInventory)).scalars().all()
    filtered_rows = db.execute(query).scalars().all()
    
    summary = {"critical": 0, "warning": 0, "surplus": 0}
    for r in all_rows:
        if r.status == StockStatus.critical or r.status == StockStatus.stockout:
            summary["critical"] += 1
        elif r.status == StockStatus.warning:
            summary["warning"] += 1
        else:
            summary["surplus"] += 1
            
    items = []
    for r in filtered_rows:
        items.append({
            "facility_id": r.facility.id,
            "facility_name": r.facility.name,
            "medicine_id": r.medicine.id,
            "medicine_name": r.medicine.name,
            "current_stock": r.current_stock,
            "avg_daily_consumption": r.avg_daily_consumption,
            "status": r.status or StockStatus.surplus,
            "updated_at": r.updated_at
        })
        
    return InventoryResponse(summary=InventorySummary(**summary), items=items)


@router.get("/forecast", response_model=ForecastResponse)
def get_forecast(
    facility_id: int,
    medicine_id: int,
    horizon: int = 7,
    lead_time_days: int = 5,
    db: Session = Depends(get_db)
):
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
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/forecast/suggested-quantity", response_model=SuggestedQuantityResponse)
def get_suggested_quantity(
    facility_id: int,
    medicine_id: int,
    db: Session = Depends(get_db)
):
    inv = db.execute(
        select(FacilityInventory).where(FacilityInventory.facility_id == facility_id, FacilityInventory.medicine_id == medicine_id)
    ).scalar_one_or_none()
    
    if not inv:
        raise HTTPException(status_code=404, detail="Inventory not found")
        
    lead_time_days = inv.medicine.standard_lead_time_days
    csv_path = os.path.join(os.path.dirname(__file__), "inventory_logs.csv")
    
    try:
        forecasts = run_forecast(csv_path, facility_id, medicine_id, horizon=lead_time_days, lead_time_days=lead_time_days)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
        
    total_consumption = sum(f["predicted_consumption"] for f in forecasts)
    suggested = max(0, total_consumption - inv.current_stock)
    
    return SuggestedQuantityResponse(
        facility_id=facility_id,
        medicine_id=medicine_id,
        suggested_quantity=round(suggested, 2),
        based_on={
            "current_stock": inv.current_stock,
            "predicted_daily_consumption": inv.avg_daily_consumption,
            "lead_time_days": lead_time_days
        }
    )


@router.post("/transfers", response_model=TransferRequestOut, status_code=201)
def create_transfer(payload: TransferRequestCreate, db: Session = Depends(get_db)):
    requester = db.get(Facility, payload.requesting_facility_id)
    if not requester:
        raise HTTPException(status_code=404, detail="Facility not found")
        
    is_dire = is_dire_situation(db, payload.requesting_facility_id, payload.medicine_id)
    candidates = find_candidates(db, payload.requesting_facility_id, payload.medicine_id)
    
    if not candidates:
        # Escalate immediately
        req = TransferRequest(
            requesting_facility_id=payload.requesting_facility_id,
            medicine_id=payload.medicine_id,
            quantity_requested=payload.quantity_requested,
            priority=payload.priority,
            status=TransferStatus.escalated,
            current_escalation_level=EscalationLevel.regional_authority,
            is_dire=is_dire
        )
        db.add(req)
        db.commit()
        db.refresh(req)
        return _format_transfer_response(req)
        
    if is_dire and len(candidates) > 1:
        # Fan out
        first_req = None
        for cand in candidates:
            req = TransferRequest(
                requesting_facility_id=payload.requesting_facility_id,
                medicine_id=payload.medicine_id,
                quantity_requested=payload.quantity_requested,
                priority=payload.priority,
                status=TransferStatus.pending,
                current_escalation_level=EscalationLevel.peer_facility if cand["tierScore"] == 1 else EscalationLevel.zonal_distributor,
                parent_request_id=first_req.id if first_req else None,
                is_dire=True
            )
            db.add(req)
            db.commit()
            db.refresh(req)
            
            if first_req is None:
                first_req = req
                
            match = TransferMatch(
                transfer_request_id=req.id,
                supplying_facility_id=cand["sourceId"],
                quantity_offered=min(payload.quantity_requested, cand["availableStock"]),
                distance_km=cand["distance"],
                estimated_transit_minutes=cand["transitMinutes"],
                match_status="proposed"
            )
            db.add(match)
            db.commit()
            
        db.refresh(first_req)
        return _format_transfer_response(first_req)
    else:
        top_cand = candidates[0]
        req = TransferRequest(
            requesting_facility_id=payload.requesting_facility_id,
            medicine_id=payload.medicine_id,
            quantity_requested=payload.quantity_requested,
            priority=payload.priority,
            status=TransferStatus.pending,
            current_escalation_level=EscalationLevel.peer_facility if top_cand["tierScore"] == 1 else EscalationLevel.zonal_distributor,
            is_dire=is_dire
        )
        db.add(req)
        db.commit()
        db.refresh(req)
        
        match = TransferMatch(
            transfer_request_id=req.id,
            supplying_facility_id=top_cand["sourceId"],
            quantity_offered=min(payload.quantity_requested, top_cand["availableStock"]),
            distance_km=top_cand["distance"],
            estimated_transit_minutes=top_cand["transitMinutes"],
            match_status="proposed"
        )
        db.add(match)
        db.commit()
        db.refresh(req)
        return _format_transfer_response(req)


@router.get("/candidates")
def get_candidates(requesting_facility_id: int, medicine_id: int, db: Session = Depends(get_db)):
    candidates = find_candidates(db, requesting_facility_id, medicine_id)
    return {"candidates": candidates}

@router.patch("/transfers/{id}/respond", response_model=TransferRequestOut)
def respond_transfer(id: int, payload: TransferRespondRequest, db: Session = Depends(get_db)):
    req = db.get(TransferRequest, id)
    if not req:
        raise HTTPException(status_code=404, detail="Transfer not found")
        
    match = db.get(TransferMatch, payload.match_id)
    if not match or match.transfer_request_id != req.id:
        raise HTTPException(status_code=404, detail="Match not found")
        
    if payload.action == "accept":
        match.match_status = "accepted"
        offered = payload.quantity_offered
        match.quantity_offered = offered
        req.quantity_fulfilled += offered
        
        if req.quantity_fulfilled >= req.quantity_requested:
            req.status = TransferStatus.in_transit
            req.resolved_at = datetime.datetime.now(datetime.UTC)
        else:
            req.status = TransferStatus.in_transit
            # Create shortfall request
            shortfall = req.quantity_requested - req.quantity_fulfilled
            
            # Find next candidate
            used_ids = [m.supplying_facility_id for m in req.matches]
            candidates = find_candidates(db, req.requesting_facility_id, req.medicine_id, exclude_ids=used_ids)
            
            if candidates:
                next_cand = candidates[0]
                new_req = TransferRequest(
                    requesting_facility_id=req.requesting_facility_id,
                    medicine_id=req.medicine_id,
                    quantity_requested=shortfall,
                    priority=req.priority,
                    status=TransferStatus.pending,
                    current_escalation_level=EscalationLevel.peer_facility if next_cand["tierScore"] == 1 else EscalationLevel.zonal_distributor,
                    parent_request_id=req.id,
                    is_dire=req.is_dire
                )
                db.add(new_req)
                db.commit()
                db.refresh(new_req)
                
                new_match = TransferMatch(
                    transfer_request_id=new_req.id,
                    supplying_facility_id=next_cand["sourceId"],
                    quantity_offered=min(shortfall, next_cand["availableStock"]),
                    distance_km=next_cand["distance"],
                    estimated_transit_minutes=next_cand["transitMinutes"],
                    match_status="proposed"
                )
                db.add(new_match)
            else:
                new_req = TransferRequest(
                    requesting_facility_id=req.requesting_facility_id,
                    medicine_id=req.medicine_id,
                    quantity_requested=shortfall,
                    priority=req.priority,
                    status=TransferStatus.escalated,
                    current_escalation_level=EscalationLevel.regional_authority,
                    parent_request_id=req.id,
                    is_dire=req.is_dire
                )
                db.add(new_req)
                
    elif payload.action == "reject":
        match.match_status = "rejected"
        
        used_ids = [m.supplying_facility_id for m in req.matches]
        candidates = find_candidates(db, req.requesting_facility_id, req.medicine_id, exclude_ids=used_ids)
        
        if candidates:
            next_cand = candidates[0]
            new_match = TransferMatch(
                transfer_request_id=req.id,
                supplying_facility_id=next_cand["sourceId"],
                quantity_offered=min(req.quantity_requested, next_cand["availableStock"]),
                distance_km=next_cand["distance"],
                estimated_transit_minutes=next_cand["transitMinutes"],
                match_status="proposed"
            )
            db.add(new_match)
            req.status = TransferStatus.pending
            req.current_escalation_level = EscalationLevel.peer_facility if next_cand["tierScore"] == 1 else EscalationLevel.zonal_distributor
        else:
            req.status = TransferStatus.escalated
            req.current_escalation_level = EscalationLevel.regional_authority

    db.commit()
    db.refresh(req)
    return _format_transfer_response(req)


@router.get("/transfers", response_model=TransferListResponse)
def get_transfers(
    status: Optional[TransferStatus] = None,
    parent_request_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    query = select(TransferRequest)
    if status:
        query = query.where(TransferRequest.status == status)
    if parent_request_id is not None:
        query = query.where(TransferRequest.parent_request_id == parent_request_id)
        
    requests = db.execute(query).scalars().all()
    return TransferListResponse(items=[_format_transfer_response(req) for req in requests])


def _format_transfer_response(req: TransferRequest):
    return {
        "id": req.id,
        "requesting_facility_id": req.requesting_facility_id,
        "requesting_facility_name": req.requesting_facility.name if req.requesting_facility else f"Facility #{req.requesting_facility_id}",
        "medicine_id": req.medicine_id,
        "medicine_name": req.medicine.name if req.medicine else f"Medicine #{req.medicine_id}",
        "quantity_requested": req.quantity_requested,
        "quantity_fulfilled": req.quantity_fulfilled,
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
                "quantity_offered": m.quantity_offered,
                "distance_km": m.distance_km,
                "estimated_transit_minutes": m.estimated_transit_minutes,
                "match_status": m.match_status
            }
            for m in req.matches
        ]
    }
