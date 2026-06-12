import logging
import time
from sqlalchemy.exc import OperationalError
from database import engine, Base, SessionLocal
from models_db import OLTProfileDB

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def seed():
    if not engine:
        logger.error("No database engine configured. Seeding aborted.")
        return

    logger.info("Connecting to PostgreSQL to create tables...")
    try:
        # Create all tables
        Base.metadata.create_all(bind=engine)
    except OperationalError as e:
        logger.error(f"PostgreSQL is not reachable. Please start the server and run seed.py later. Error: {e}")
        return
    except Exception as e:
        logger.error(f"Failed to create tables: {e}")
        return

    db = SessionLocal()
    try:
        default_olts = [
            {
                "hostname": "ZXAN",
                "olt_name": "ZTE C600",
                "olt_type": "c600",
                "in_band_ip": None, 
                "telnet_port": 23,
                "enable_password": "zxr10",
                "username": "zte",
                "password": "zte"
            },
            {
                "hostname": "ZXAN",
                "olt_name": "ZTE C300",
                "olt_type": "c300",
                "in_band_ip": None,
                "telnet_port": 23,
                "enable_password": "zxr10",
                "username": "zte",
                "password": "zte"
            },
            {
                "hostname": "ZXAN",
                "olt_type": "c320",
                "in_band_ip": None,
                "telnet_port": 23,
                "enable_password": "zxr10",
                "username": "zte",
                "password": "zte"
            }
        ]

        for config in default_olts:
            existing = db.query(OLTProfileDB).filter(OLTProfileDB.olt_type == config["olt_type"]).first()
            if not existing:
                new_conf = OLTProfileDB(**config)
                db.add(new_conf)
                logger.info(f"Seeded: {config.get('hostname', 'Unknown')}")
            else:
                # Update existing hostname if needed, but don't touch IP if it's already set
                if existing.in_band_ip in ['c600', 'c300', 'c320']:
                    existing.in_band_ip = None
                logger.info(f"Verified/Cleaned: {config.get('hostname', 'Unknown')}")
        
        db.commit()
        logger.info("Database seeding complete.")
    except Exception as e:
        logger.error(f"Error seeding database: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed()
