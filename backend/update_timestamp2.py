from database import SessionLocal
from sqlalchemy import text

db = SessionLocal()
try:
    db.execute(text("UPDATE onu_power_history SET timestamp = timestamp + interval '7 hours' WHERE timestamp >= '2026-05-21 05:00:00' AND timestamp <= '2026-05-21 06:00:00'"))
    db.commit()
    print("Berhasil fix data UTC yang baru masuk")
except Exception as e:
    print(f"Error: {e}")
    db.rollback()
finally:
    db.close()
