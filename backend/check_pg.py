import logging
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("db-check")

# Database URL from database.py
DATABASE_URL = "postgresql://postgres:falcom180@localhost:5432/olt_db"

try:
    engine = create_engine(DATABASE_URL)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    
    with SessionLocal() as db:
        print("--- Testing Connection ---")
        db.execute(text('SELECT 1'))
        print("Connection Successful!")
        
        print("\n--- Tables in public schema ---")
        res = db.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"))
        for row in res:
            print(row[0])
            
        print("\n--- ONUHourlyMetrics Content (Last 5) ---")
        try:
            res = db.execute(text("SELECT * FROM onu_hourly_metrics ORDER BY timestamp DESC LIMIT 5"))
            rows = res.fetchall()
            if not rows:
                print("Table is EMPTY!")
            for row in rows:
                print(row)
        except Exception as e:
            print(f"Error reading onu_hourly_metrics: {e}")

        print("\n--- SystemSettings (selected_olt_id) ---")
        try:
            res = db.execute(text("SELECT * FROM system_settings WHERE key = 'selected_olt_id'"))
            row = res.fetchone()
            print(row)
        except Exception as e:
            print(f"Error reading system_settings: {e}")

except Exception as e:
    print(f"DATABASE CONNECTION FAILED: {e}")
