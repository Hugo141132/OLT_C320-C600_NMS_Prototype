"""Add hw_version column to unregistered_onus table."""
from database import engine
from sqlalchemy import text
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("migrate-c6xx-unreg")

def migrate():
    logger.info("Adding hw_version column to unregistered_onus...")
    try:
        with engine.connect() as conn:
            conn.execute(text(
                "ALTER TABLE unregistered_onus ADD COLUMN IF NOT EXISTS hw_version VARCHAR DEFAULT NULL"
            ))
            conn.commit()
            logger.info("Migration complete - hw_version column added successfully.")
    except Exception as e:
        logger.error(f"Migration failed: {e}")

if __name__ == "__main__":
    migrate()
