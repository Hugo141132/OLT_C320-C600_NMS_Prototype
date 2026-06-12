"""Add snmp_community column to olt_profiles table."""
from database import engine
from sqlalchemy import text
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("migrate-snmp")

def migrate():
    logger.info("Adding snmp_community column to olt_profiles...")
    try:
        with engine.connect() as conn:
            conn.execute(text(
                "ALTER TABLE olt_profiles ADD COLUMN IF NOT EXISTS snmp_community VARCHAR DEFAULT 'public'"
            ))
            conn.commit()
            logger.info("Migration complete - snmp_community column added.")
    except Exception as e:
        logger.error(f"Migration failed: {e}")

if __name__ == "__main__":
    migrate()
