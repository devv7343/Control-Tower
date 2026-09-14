"""
Control Tower — SQLAlchemy Models
===================================
This is the actual live schema for the SQLite prototype. schema.sql (Postgres
+ PostGIS) stays as documented reference design only — it is not executed
against anything. Two deliberate differences from schema.sql:

1. facilities.location (GEOGRAPHY(POINT, 4326) in schema.sql) is two plain
   float columns here: latitude and longitude. This prototype computes
   distance via plain-Python Haversine (see geo.py), not PostGIS functions,
   so there's no reason to need a geo-aware column type.
2. Enums use Python's `enum.Enum` + SQLAlchemy's `Enum` type rather than a
   native Postgres ENUM. This still writes the exact same lowercase string
   values into the database (matching API_CONTRACT.md's enum lists), and if
   DATABASE_URL is ever switched to Postgres, SQLAlchemy automatically
   creates a real native ENUM type there instead — nothing here would need
   to change.

Everything else (table names, column names, the parent_facility_id /
parent_request_id / quantity_fulfilled / is_dire additions from the schema.sql
update) matches schema.sql exactly.
"""

from __future__ import annotations

import enum
from datetime import date, datetime
from typing import Optional

from sqlalchemy import CheckConstraint, Enum as SqlEnum, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


# =================================================================
# Enums — same lowercase string values as schema.sql and API_CONTRACT.md
# =================================================================
class FacilityType(str, enum.Enum):
    clinic = "clinic"
    hospital = "hospital"
    distributor = "distributor"
    warehouse = "warehouse"


class StockStatus(str, enum.Enum):
    surplus = "surplus"
    warning = "warning"
    critical = "critical"
    stockout = "stockout"


class TransferStatus(str, enum.Enum):
    pending = "pending"
    matched = "matched"
    escalated = "escalated"
    in_transit = "in_transit"
    completed = "completed"
    cancelled = "cancelled"
    rejected = "rejected"


class EscalationLevel(str, enum.Enum):
    peer_facility = "peer_facility"
    zonal_distributor = "zonal_distributor"
    regional_authority = "regional_authority"


# =================================================================
# Zones
# =================================================================
class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(nullable=False)
    region: Mapped[Optional[str]] = mapped_column(default=None)
    # schema.sql's boundary GEOGRAPHY(POLYGON) is skipped — nothing in this
    # prototype queries it, and it's the same PostGIS-only situation as
    # facilities.location above.

    facilities: Mapped[list["Facility"]] = relationship(back_populates="zone")


# =================================================================
# Facilities
# =================================================================
class Facility(Base):
    __tablename__ = "facilities"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(nullable=False)
    type: Mapped[FacilityType] = mapped_column(SqlEnum(FacilityType), nullable=False)
    zone_id: Mapped[Optional[int]] = mapped_column(ForeignKey("zones.id"), default=None)

    # Default escalation parent: clinic -> hospital, hospital -> distributor.
    # NULL for facilities at the top of the hierarchy (distributors).
    parent_facility_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("facilities.id"), default=None
    )

    latitude: Mapped[float] = mapped_column(nullable=False)
    longitude: Mapped[float] = mapped_column(nullable=False)

    address: Mapped[Optional[str]] = mapped_column(default=None)
    contact_phone: Mapped[Optional[str]] = mapped_column(default=None)
    contact_email: Mapped[Optional[str]] = mapped_column(default=None)
    storage_capacity_units: Mapped[Optional[int]] = mapped_column(default=None)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    zone: Mapped[Optional["Zone"]] = relationship(back_populates="facilities")
    parent_facility: Mapped[Optional["Facility"]] = relationship(
        remote_side=[id], backref="child_facilities"
    )

    __table_args__ = (
        CheckConstraint(
            "parent_facility_id IS NULL OR parent_facility_id != id",
            name="ck_facility_not_own_parent",
        ),
    )


# =================================================================
# Medicine catalog
# =================================================================
class Medicine(Base):
    __tablename__ = "medicines"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(nullable=False, unique=True)
    category: Mapped[Optional[str]] = mapped_column(default=None)
    unit: Mapped[str] = mapped_column(default="units")
    standard_lead_time_days: Mapped[int] = mapped_column(default=3)
    is_essential: Mapped[bool] = mapped_column(default=True)


# =================================================================
# Current inventory snapshot
# =================================================================
class FacilityInventory(Base):
    __tablename__ = "facility_inventory"

    id: Mapped[int] = mapped_column(primary_key=True)
    facility_id: Mapped[int] = mapped_column(
        ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False
    )
    medicine_id: Mapped[int] = mapped_column(
        ForeignKey("medicines.id", ondelete="CASCADE"), nullable=False
    )
    current_stock: Mapped[float] = mapped_column(default=0)
    avg_daily_consumption: Mapped[float] = mapped_column(default=0)
    reorder_point: Mapped[Optional[float]] = mapped_column(default=None)
    status: Mapped[Optional[StockStatus]] = mapped_column(SqlEnum(StockStatus), default=None)
    last_restocked_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    facility: Mapped["Facility"] = relationship()
    medicine: Mapped["Medicine"] = relationship()

    __table_args__ = (
        UniqueConstraint("facility_id", "medicine_id", name="uq_inventory_facility_medicine"),
    )


# =================================================================
# Historical daily logs — feeds forecast_model.py
# =================================================================
class InventoryLog(Base):
    __tablename__ = "inventory_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    facility_id: Mapped[int] = mapped_column(
        ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False
    )
    medicine_id: Mapped[int] = mapped_column(
        ForeignKey("medicines.id", ondelete="CASCADE"), nullable=False
    )
    log_date: Mapped[date] = mapped_column(nullable=False)
    stock_level: Mapped[float] = mapped_column(nullable=False)
    consumption: Mapped[float] = mapped_column(default=0)
    replenishment_received: Mapped[float] = mapped_column(default=0)
    recorded_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "facility_id", "medicine_id", "log_date", name="uq_log_facility_medicine_date"
        ),
    )


# =================================================================
# ML forecast outputs
# =================================================================
class ForecastResult(Base):
    __tablename__ = "forecast_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    facility_id: Mapped[int] = mapped_column(
        ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False
    )
    medicine_id: Mapped[int] = mapped_column(
        ForeignKey("medicines.id", ondelete="CASCADE"), nullable=False
    )
    forecast_date: Mapped[date] = mapped_column(nullable=False)
    predicted_stock: Mapped[Optional[float]] = mapped_column(default=None)
    predicted_consumption: Mapped[Optional[float]] = mapped_column(default=None)
    confidence_lower: Mapped[Optional[float]] = mapped_column(default=None)
    confidence_upper: Mapped[Optional[float]] = mapped_column(default=None)
    predicted_status: Mapped[Optional[StockStatus]] = mapped_column(SqlEnum(StockStatus), default=None)
    model_version: Mapped[Optional[str]] = mapped_column(default=None)
    generated_at: Mapped[datetime] = mapped_column(server_default=func.now())


# =================================================================
# Transfer requests — the redistribution engine
# =================================================================
class TransferRequest(Base):
    __tablename__ = "transfer_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    requesting_facility_id: Mapped[int] = mapped_column(ForeignKey("facilities.id"), nullable=False)
    medicine_id: Mapped[int] = mapped_column(ForeignKey("medicines.id"), nullable=False)
    quantity_requested: Mapped[float] = mapped_column(nullable=False)

    # Running total actually delivered so far against quantity_requested —
    # used to compute the remaining shortfall for a follow-up request.
    quantity_fulfilled: Mapped[float] = mapped_column(default=0)

    priority: Mapped[StockStatus] = mapped_column(SqlEnum(StockStatus), nullable=False)
    status: Mapped[TransferStatus] = mapped_column(
        SqlEnum(TransferStatus), default=TransferStatus.pending
    )
    current_escalation_level: Mapped[EscalationLevel] = mapped_column(
        SqlEnum(EscalationLevel), default=EscalationLevel.peer_facility
    )

    # Set when this request is a follow-up (partial fulfillment) or a dire
    # fan-out sibling of another request for the same shortage event.
    parent_request_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("transfer_requests.id"), default=None
    )
    # True if this request was allowed to have simultaneous sibling requests
    # (extremely critical situation) instead of the default single-target rule.
    is_dire: Mapped[bool] = mapped_column(default=False)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    resolved_at: Mapped[Optional[datetime]] = mapped_column(default=None)

    requesting_facility: Mapped["Facility"] = relationship()
    medicine: Mapped["Medicine"] = relationship()
    parent_request: Mapped[Optional["TransferRequest"]] = relationship(
        remote_side=[id], backref="follow_up_requests"
    )
    matches: Mapped[list["TransferMatch"]] = relationship(
        back_populates="transfer_request", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "parent_request_id IS NULL OR parent_request_id != id",
            name="ck_transfer_not_own_parent",
        ),
    )


# Candidate matches / offers proposed against a transfer request
class TransferMatch(Base):
    __tablename__ = "transfer_matches"

    id: Mapped[int] = mapped_column(primary_key=True)
    transfer_request_id: Mapped[int] = mapped_column(
        ForeignKey("transfer_requests.id", ondelete="CASCADE"), nullable=False
    )
    supplying_facility_id: Mapped[int] = mapped_column(ForeignKey("facilities.id"), nullable=False)
    quantity_offered: Mapped[float] = mapped_column(nullable=False)
    distance_km: Mapped[Optional[float]] = mapped_column(default=None)
    estimated_transit_minutes: Mapped[Optional[int]] = mapped_column(default=None)
    # proposed, accepted, rejected, delivered — enforced in application code,
    # not a DB-level enum, matching schema.sql's plain VARCHAR(20) here.
    match_status: Mapped[str] = mapped_column(default="proposed")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    transfer_request: Mapped["TransferRequest"] = relationship(back_populates="matches")
    supplying_facility: Mapped["Facility"] = relationship()


# =================================================================
# Alerts feed (dashboard notifications)
# =================================================================
class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    facility_id: Mapped[Optional[int]] = mapped_column(ForeignKey("facilities.id"), default=None)
    medicine_id: Mapped[Optional[int]] = mapped_column(ForeignKey("medicines.id"), default=None)
    alert_type: Mapped[Optional[str]] = mapped_column(default=None)  # stock_critical, forecast_warning, regional_cluster
    severity: Mapped[Optional[str]] = mapped_column(default=None)  # low, medium, high
    message: Mapped[Optional[str]] = mapped_column(default=None)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    resolved_at: Mapped[Optional[datetime]] = mapped_column(default=None)
