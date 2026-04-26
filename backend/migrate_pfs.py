import os
import sys

# Pre-add to sys.path to allow imports if running directly
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import engine, Base, RoomKeyBundle
from sqlalchemy import Table, MetaData

def rollback_pfs():
    print("Starting PFS DB Rollback...")
    metadata = MetaData()
    metadata.reflect(bind=engine)
    
    # Drop new tables if exist
    if 'user_onetime_prekeys' in metadata.tables:
        metadata.tables['user_onetime_prekeys'].drop(engine)
    if 'user_signed_prekeys' in metadata.tables:
        metadata.tables['user_signed_prekeys'].drop(engine)
    if 'user_identity_keys' in metadata.tables:
        metadata.tables['user_identity_keys'].drop(engine)
    
    # Restore RoomKeyBundle
    print("Restoring room_key_bundles table...")
    RoomKeyBundle.__table__.create(engine, checkfirst=True)
    
    print("PFS DB Rollback Complete.")

if __name__ == '__main__':
    rollback_pfs()
