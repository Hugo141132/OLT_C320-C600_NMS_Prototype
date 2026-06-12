import os
import sys

# Ensure backend directory is in path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal
from models_db import OLTProfileDB
from security_utils import get_encryption_key
from cryptography.fernet import Fernet
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("encrypt_script")

def run_migration():
    db = SessionLocal()
    try:
        key = get_encryption_key(db)
        f = Fernet(key)
        
        profiles = db.query(OLTProfileDB).all()
        updated_count = 0
        
        for profile in profiles:
            changed = False
            
            # Check and encrypt password
            if profile.password:
                try:
                    f.decrypt(profile.password.encode())
                except Exception:
                    # Decryption failed, it's plain text. Encrypt it.
                    profile.password = f.encrypt(profile.password.encode()).decode()
                    changed = True
                    logger.info(f"Encrypted 'password' for OLT: {profile.olt_type}")
            
            # Check and encrypt enable_password
            if profile.enable_password:
                try:
                    f.decrypt(profile.enable_password.encode())
                except Exception:
                    # Decryption failed, it's plain text. Encrypt it.
                    profile.enable_password = f.encrypt(profile.enable_password.encode()).decode()
                    changed = True
                    logger.info(f"Encrypted 'enable_password' for OLT: {profile.olt_type}")
            
            if changed:
                updated_count += 1
                
        if updated_count > 0:
            db.commit()
            logger.info(f"Successfully encrypted passwords for {updated_count} OLT profiles.")
        else:
            logger.info("No plain text passwords found. Everything is already secure.")
            
    except Exception as e:
        logger.error(f"Migration failed: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    run_migration()
