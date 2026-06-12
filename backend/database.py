from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker
import logging

logger = logging.getLogger(__name__)

import os
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:falcom180@localhost:5432/olt_db")
# Create Database Engine (lazy — actual connection happens on first query)
try:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"connect_timeout": 3},  # fail fast if DB is down
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
except Exception as e:
    logger.error(f"Failed to create database engine: {e}")
    engine = None
    SessionLocal = None


Base = declarative_base()


def get_db():
    """
    FastAPI dependency that yields a DB session.
    Yields None (instead of crashing) when PostgreSQL is not reachable,
    so endpoints can gracefully return 503 instead of unhandled 500.
    """
    if not SessionLocal:
        yield None
        return

    db = SessionLocal()

    # Test connectivity before handing session to the endpoint
    try:
        db.execute(text('SELECT 1'))
    except Exception as e:
        logger.warning(f"Database not reachable, returning None to endpoint: {e}")
        try:
            db.close()
        except Exception:
            pass
        yield None
        return

    # Database is alive — yield the session
    try:
        yield db
    finally:
        try:
            db.close()
        except Exception:
            pass
