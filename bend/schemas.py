"""
Control Tower — Pydantic Schemas
===================================
These mirror API_CONTRACT.md field-for-field. Enums are imported from
models.py rather than redefined here — one definition of "what counts as a
valid status" instead of two files that could quietly drift apart.

Naming convention: "*Create" = request body the client sends in.
"*Out" = response shape the client receives. Nothing here reshapes data;
routes.py is where facility/medicine names actually get joined in before
being handed to these schemas — that's a routes.py concern, not this file's.
"""

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, model_validator

from models import EscalationLevel, FacilityType, StockStatus, TransferStatus


# =================================================================
# GET /facilities — GeoJSON FeatureCollection
# =================================================================
class FacilityMedicineStatus(BaseModel):
    """Represents the inventory status of a specific medicine at a facility."""
    medicine_id: int
    medicine_name: str
    status: StockStatus
    current_stock: int
    capacity: Optional[int] = 100
    avg_daily_consumption: Optional[float] = None


class FacilityProperties(BaseModel):
    """Business properties associated with a facility in a GeoJSON feature."""
    id: int
    name: str
    type: FacilityType
    zone_id: Optional[int] = None
    parent_facility_id: Optional[int] = None
    worst_status: StockStatus
    medicines: list[FacilityMedicineStatus]


class FacilityGeometry(BaseModel):
    """GeoJSON Point geometry for a facility."""
    type: Literal["Point"] = "Point"
    coordinates: tuple[float, float]  # [longitude, latitude] — GeoJSON order


class FacilityFeature(BaseModel):
    """GeoJSON Feature representing a single facility on the map."""
    type: Literal["Feature"] = "Feature"
    geometry: FacilityGeometry
    properties: FacilityProperties


class FacilityFeatureCollection(BaseModel):
    """GeoJSON FeatureCollection containing all facilities."""
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[FacilityFeature]


# =================================================================
# GET /inventory
# =================================================================
class InventoryItem(BaseModel):
    """Detailed record of a single facility's inventory for one medicine."""
    model_config = ConfigDict(from_attributes=True)

    facility_id: int
    facility_name: str
    medicine_id: int
    medicine_name: str
    current_stock: int
    avg_daily_consumption: float
    status: StockStatus
    updated_at: datetime


class InventorySummary(BaseModel):
    """Aggregated counts of inventory statuses across the network."""
    critical: int
    warning: int
    surplus: int


class InventoryResponse(BaseModel):
    """Full response containing both summary metrics and detailed inventory items."""
    summary: InventorySummary
    items: list[InventoryItem]


# =================================================================
# GET /forecast — matches forecast_model.py's --json output exactly
# =================================================================
class ForecastDay(BaseModel):
    """Predicted inventory and consumption for a single future day."""
    date: date
    predicted_consumption: float
    predicted_stock: int
    confidence_lower: int
    confidence_upper: int
    status: StockStatus


class ForecastResponse(BaseModel):
    """Time-series forecast response for a specific facility and medicine."""
    facility_id: int
    facility_name: Optional[str] = None
    medicine_id: int
    medicine_name: Optional[str] = None
    forecast: list[ForecastDay]


# =================================================================
# GET /forecast/suggested-quantity
# =================================================================
class SuggestedQuantityBasedOn(BaseModel):
    """The underlying metrics used to calculate the suggested quantity."""
    current_stock: int
    predicted_daily_consumption: float
    lead_time_days: int


class SuggestedQuantityResponse(BaseModel):
    """Recommended quantity to request to survive the resupply lead time."""
    facility_id: int
    medicine_id: int
    suggested_quantity: int
    based_on: SuggestedQuantityBasedOn


# =================================================================
# Transfers — shared between POST /transfers, GET /transfers,
# and PATCH /transfers/{id}/respond (all three return this same shape)
# =================================================================
class TransferRequestCreate(BaseModel):
    """POST /transfers request body."""
    requesting_facility_id: int
    medicine_id: int
    quantity_requested: int
    priority: StockStatus  # in practice always "critical" or "warning"


class TransferMatchOut(BaseModel):
    """A proposed or active supply offer fulfilling part of a transfer request."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplying_facility_id: int
    supplying_facility_name: str
    quantity_offered: int
    distance_km: Optional[float] = None
    estimated_transit_minutes: Optional[int] = None
    match_status: Literal["proposed", "accepted", "rejected", "delivered"]


class TransferRequestOut(BaseModel):
    """Detailed transfer request including its current status and matches."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    requesting_facility_id: int
    requesting_facility_name: Optional[str] = None
    medicine_id: int
    medicine_name: Optional[str] = None
    quantity_requested: int
    quantity_fulfilled: int
    priority: StockStatus
    status: TransferStatus
    current_escalation_level: EscalationLevel
    parent_request_id: Optional[int] = None
    is_dire: bool
    created_at: datetime
    resolved_at: Optional[datetime] = None
    matches: list[TransferMatchOut]


class TransferListResponse(BaseModel):
    """GET /transfers wraps the same per-item shape as POST's response."""
    items: list[TransferRequestOut]


# =================================================================
# PATCH /transfers/{id}/respond
# =================================================================
class TransferRespondRequest(BaseModel):
    """Payload to accept or reject a proposed transfer match."""
    match_id: int
    action: Literal["accept", "reject"]
    quantity_offered: Optional[int] = None

    @model_validator(mode="after")
    def _quantity_required_on_accept(self) -> "TransferRespondRequest":
        if self.action == "accept" and self.quantity_offered is None:
            raise ValueError("quantity_offered is required when action is 'accept'")
        return self
