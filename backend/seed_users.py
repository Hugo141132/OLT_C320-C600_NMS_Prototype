import sys
import os

# Add the current directory to sys.path to import local modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal
from models_db import User, UserRole
from security_utils import get_password_hash

def seed():
    db = SessionLocal()
    try:
        # Check if admin already exists
        admin = db.query(User).filter(User.username == "falcom").first()
        if not admin:
            print("Creating default admin user: falcom / falcom180")
            admin = User(
                username="falcom",
                password_hash=get_password_hash("falcom180"),
                role="admin"
            )
            db.add(admin)
            db.commit()
            print("Admin user created successfully.")
        else:
            print("Admin user 'falcom' already exists.")
            
    except Exception as e:
        print(f"Error seeding database: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed()
