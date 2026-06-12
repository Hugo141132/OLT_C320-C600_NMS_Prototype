import sqlite3
import os

db_path = r"c:\Users\hugop\Documents\Dokumentasi Web\OLT-WEB\backend\olt.db"

if not os.path.exists(db_path):
    print(f"Database not found at {db_path}")
else:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("--- Tables ---")
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    for table in tables:
        print(table[0])
        
    print("\n--- ONUHourlyMetrics Content (Last 10) ---")
    try:
        cursor.execute("SELECT * FROM onu_hourly_metrics ORDER BY timestamp DESC LIMIT 10;")
        rows = cursor.fetchall()
        for row in rows:
            print(row)
    except Exception as e:
        print(f"Error reading onu_hourly_metrics: {e}")
        
    print("\n--- SystemSettings (selected_olt_id) ---")
    cursor.execute("SELECT * FROM system_settings WHERE key='selected_olt_id';")
    print(cursor.fetchone())
    
    conn.close()
