from sqlalchemy.orm import Session
from database import SessionLocal, engine, Base
from models_db import User
from security_utils import get_password_hash

def init_admin():
    db = SessionLocal()
    try:
        # Create tables if not exist
        Base.metadata.create_all(bind=engine)
        
        # Check if admin exists
        admin = db.query(User).filter(User.username == "admin").first()
        if not admin:
            print("Creating default admin user...")
            admin = User(
                username="admin",
                password_hash=get_password_hash("admin123"), # Default password
                role="admin",
                full_name="System Administrator"
            )
            db.add(admin)
            db.commit()
            print("Admin user created: admin / admin123")
        else:
            print("Admin user already exists.")
            
        # Check for guest
        guest = db.query(User).filter(User.username == "guest").first()
        if not guest:
            print("Creating default guest user...")
            guest = User(
                username="guest",
                password_hash=get_password_hash("guest123"),
                role="guest",
                full_name="Guest Viewer"
            )
            db.add(guest)
            db.commit()
            print("Guest user created: guest / guest123")
            
    finally:
        db.close()

if __name__ == "__main__":
    init_admin()
