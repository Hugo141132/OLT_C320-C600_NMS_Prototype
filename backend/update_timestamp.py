from database import SessionLocal
from sqlalchemy import text

db = SessionLocal()
try:
    # Adding 7 hours to existing timestamp
    db.execute(text("UPDATE onu_power_history SET timestamp = timestamp + interval '7 hours'"))
    db.commit()
    print("Berhasil mengupdate timestamp di onu_power_history menjadi GMT+7")
except Exception as e:
    print(f"Error: {e}")
    db.rollback()
finally:
    db.close()
