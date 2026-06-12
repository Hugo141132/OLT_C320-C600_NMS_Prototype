import logging
from database import engine, Base, SessionLocal
from sqlalchemy import text
from seed import seed

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fix-db")

def fix():
    if not engine:
        logger.error("No database engine.")
        return

    logger.info("Dropping and recreating olt_profiles table to sync schema...")
    try:
        with engine.connect() as conn:
            # We use cascade to be safe, though there are likely no FKs
            conn.execute(text("DROP TABLE IF EXISTS olt_profiles CASCADE"))
            conn.commit()
        
        # Now create all tables (this will recreate olt_profiles with correct schema)
        Base.metadata.create_all(bind=engine)
        logger.info("Table recreated. Running seed...")
        
        # Re-seed the data
        seed()
        logger.info("Database fixed successfully.")
        
    except Exception as e:
        logger.error(f"Failed to fix database: {e}")

if __name__ == "__main__":
    fix()
