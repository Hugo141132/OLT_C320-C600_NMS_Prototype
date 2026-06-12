from database import engine
from sqlalchemy import text
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fix-db")

def fix_schema():
    logger.info("🔧 Starting database schema fix and deduplication...")
    try:
        with engine.connect() as conn:
            # 0. Deduplicate olt_profiles
            logger.info("Step 0: Deduplicating olt_profiles...")
            conn.execute(text("""
                DELETE FROM olt_profiles a USING olt_profiles b
                WHERE a.id < b.id AND a.olt_type = b.olt_type;
            """))
            conn.commit()

            # 1. Handle olt_profiles unique constraints
            logger.info("Step 1: Updating olt_profiles constraints...")
            
            # Remove old unique constraint on in_band_ip if it exists
            res = conn.execute(text("""
                SELECT indexname FROM pg_indexes 
                WHERE tablename = 'olt_profiles' AND indexdef LIKE '%in_band_ip%';
            """))
            for row in res:
                idx_name = row[0]
                logger.info(f"Removing index: {idx_name}")
                conn.execute(text(f"DROP INDEX IF EXISTS {idx_name} CASCADE"))

            # Add unique constraint on olt_type
            logger.info("Adding unique constraint on olt_type...")
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS idx_olt_profiles_olt_type ON olt_profiles (olt_type)"))
            
            # Ensure in_band_ip has a non-unique index
            logger.info("Adding index on in_band_ip...")
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_olt_profiles_in_band_ip ON olt_profiles (in_band_ip)"))

            conn.commit()
            logger.info("✅ Database schema fix successful.")
    except Exception as e:
        logger.error(f"❌ Schema fix failed: {e}")

if __name__ == "__main__":
    fix_schema()
