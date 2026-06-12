import base64
import enum
import logging
from datetime import datetime, timedelta
from passlib.context import CryptContext
from cryptography.fernet import Fernet
from sqlalchemy.orm import Session
from models_db import SystemSettings

logger = logging.getLogger("security")

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

# Encryption for OLT credentials
def get_encryption_key(db: Session):
    key_setting = db.query(SystemSettings).filter(SystemSettings.key == "fernet_key").first()
    if not key_setting:
        try:
            key = Fernet.generate_key().decode()
            key_setting = SystemSettings(key="fernet_key", value=key)
            db.add(key_setting)
            db.commit()
            return key.encode()
        except Exception as e:
            logger.error(f"Failed to generate/save encryption key: {e}")
            raise RuntimeError("CRITICAL: Failed to get or generate encryption key. Database might be unreachable.")
    return key_setting.value.encode()

def encrypt_password(plain_text: str, db: Session) -> str:
    if not plain_text:
        return plain_text
    try:
        f = Fernet(get_encryption_key(db))
        return f.encrypt(plain_text.encode()).decode()
    except Exception as e:
        logger.error(f"Encryption failed: {e}")
        return plain_text

def decrypt_password(cipher_text: str, db: Session) -> str:
    if not cipher_text:
        return cipher_text
    try:
        f = Fernet(get_encryption_key(db))
        return f.decrypt(cipher_text.encode()).decode()
    except Exception as e:
        logger.warning(f"Decryption failed (maybe plain text?): {e}")
        return cipher_text

import hmac
import hashlib

# Session Management with HMAC Signing
def get_session_secret(db: Session) -> bytes:
    """Uses the same Fernet key as a secret for HMAC signing."""
    return get_encryption_key(db)

def create_session_token(username: str, role: str, db: Session):
    from models_db import User
    user = db.query(User).filter(User.username == username).first()
    session_version = user.session_version if user else 1

    expiry = (datetime.now() + timedelta(hours=4)).timestamp()
    payload = f"{username}|{role}|{session_version}|{expiry}"
    
    # Sign the payload
    secret = get_session_secret(db)
    signature = hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()
    
    full_data = f"{payload}.{signature}"
    return base64.b64encode(full_data.encode()).decode()

def parse_session_token(token: str, db: Session):
    if not token: return None
    try:
        decoded = base64.b64decode(token.encode()).decode()
        if "." not in decoded: return None
        
        payload, signature = decoded.rsplit(".", 1)
        
        # Verify signature
        secret = get_session_secret(db)
        expected_signature = hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()
        
        if not hmac.compare_digest(signature, expected_signature):
            logger.warning("Invalid session token signature detected!")
            return None
            
        username, role, session_version, expiry = payload.split("|")
        if float(expiry) < datetime.now().timestamp():
            return None
            
        from models_db import User
        user = db.query(User).filter(User.username == username).first()
        if not user or str(user.session_version) != session_version:
            logger.warning("Token session_version mismatch (revoked token).")
            return None
            
        return {"username": username, "role": role}
    except Exception as e:
        logger.error(f"Token parsing error: {e}")
        return None
