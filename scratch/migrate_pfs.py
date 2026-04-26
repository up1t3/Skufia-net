import os
import sys

# Pre-add to sys.path to allow imports if running directly
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import engine, Base, UserIdentityKey, UserSignedPreKey, UserOneTimePreKey
from sqlalchemy import Table, MetaData

def migrate_pfs():
    print("Starting PFS DB Migration...")
    metadata = MetaData()
    metadata.reflect(bind=engine)
    
    # Drop RoomKeyBundle if exists
    if 'room_key_bundles' in metadata.tables:
        print("Dropping old room_key_bundles table...")
        metadata.tables['room_key_bundles'].drop(engine)
    
    # Create new tables
    print("Creating new PFS tables...")
    UserIdentityKey.__table__.create(engine, checkfirst=True)
    UserSignedPreKey.__table__.create(engine, checkfirst=True)
    UserOneTimePreKey.__table__.create(engine, checkfirst=True)
    
    print("PFS DB Migration Complete.")

if __name__ == '__main__':
    migrate_pfs()
