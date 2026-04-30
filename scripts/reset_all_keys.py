import os
import sys

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend')))

try:
    from database import SessionLocal, RoomKeyBundle
except ImportError:
    # Fallback for different execution environments
    sys.path.append(os.getcwd())
    sys.path.append(os.path.join(os.getcwd(), 'backend'))
    from database import SessionLocal, RoomKeyBundle

def main():
    db = SessionLocal()
    try:
        count = db.query(RoomKeyBundle).delete()
        db.commit()
        print(f"Successfully reset all keys. Deleted {count} bundles.")
    except Exception as e:
        db.rollback()
        print(f"An error occurred: {e}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    main()
