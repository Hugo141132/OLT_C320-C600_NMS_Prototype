"""Add snmp_port column to olt_profiles table."""
import os
import sys
import logging

# Ensure backend directory is in the python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import engine
from sqlalchemy import text

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("migrate-snmp-port")

def migrate():
    logger.info("Adding snmp_port column to olt_profiles...")
    try:
        with engine.connect() as conn:
            conn.execute(text(
                "ALTER TABLE olt_profiles ADD COLUMN IF NOT EXISTS snmp_port INTEGER DEFAULT 161"
            ))
            conn.commit()
            logger.info("Migration complete - snmp_port column added.")
    except Exception as e:
        logger.error(f"Migration failed: {e}")

if __name__ == "__main__":
    migrate()
