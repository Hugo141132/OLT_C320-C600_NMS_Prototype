from database import engine
from sqlalchemy import text

def migrate():
    print("Migrating database...")
    try:
        with engine.connect() as conn:
            # Check if column exists first
            res = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'olt_profiles' AND column_name = 'olt_type'"))
            if not res.fetchone():
                print("Adding column olt_type to olt_profiles...")
                conn.execute(text("ALTER TABLE olt_profiles ADD COLUMN olt_type VARCHAR(50)"))
                conn.commit()
                print("Migration successful.")
            else:
                print("Column olt_type already exists.")
    except Exception as e:
        print(f"Migration failed: {e}")

if __name__ == "__main__":
    migrate()
