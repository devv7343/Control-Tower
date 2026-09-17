"""
Control Tower — Database Engine & Session
==========================================
Provides the core database connection and session management setup.
This prototype uses SQLite by default. `schema.sql` (Postgres + PostGIS) 
stays as the documented target design; `models.py` is the actual source of truth 
for what gets created against SQLite for the demo. 

Switching to real Postgres later just means changing the DATABASE_URL below 
and installing psycopg2-binary — nothing else here needs to change.
"""

import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase

load_dotenv()

DB_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB_PATH = os.path.join(DB_DIR, "control_tower.db").replace("\\", "/")
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")

# SQLite only allows the connection to be touched by the thread that opened
# it, by default. FastAPI can hand a request off to a different worker
# thread than the one that created the session, so this flag is required
# specifically for SQLite. Postgres/MySQL don't need it.
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)

if DATABASE_URL.startswith("sqlite"):
    # SQLite silently ignores every foreign key constraint (including
    # ON DELETE CASCADE) unless this pragma is turned on for every single
    # connection — it does not persist in the database file itself. Without
    # this, models.py's cascade deletes (e.g. deleting a facility should
    # also delete its facility_inventory rows) would just do nothing.
    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """
    Every table in models.py inherits from this DeclarativeBase.
    This acts as the registry for all our SQLAlchemy models.
    """
    pass


from typing import Generator
from sqlalchemy.orm import Session

def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency: yields one session per request.
    Ensures that the session is always closed afterward, even if the request raises an exception.
    """
    database_session = SessionLocal()
    try:
        yield database_session
    finally:
        database_session.close()


def init_db():
    """
    Creates all tables from models.py's Base metadata. 
    
    No migrations are used for this prototype — call this once at startup 
    (main.py will do this), or run `python -c "from database import init_db; init_db()"` 
    to rebuild control_tower.db from scratch after a schema change.
    """
    import models  # noqa: F401 — importing this registers every table class
    # onto Base.metadata before create_all() runs below. Local import, not
    # top-of-file, specifically to avoid a circular import: models.py itself
    # does `from database import Base`, so database.py can't import models.py
    # at module load time without the two files importing each other.
    Base.metadata.create_all(bind=engine)
