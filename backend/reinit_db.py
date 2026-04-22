import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import engine, Base, MarketListing, ListingImage, ListingFavorite

def reinit():
    ListingFavorite.__table__.drop(engine, checkfirst=True)
    ListingImage.__table__.drop(engine, checkfirst=True)
    MarketListing.__table__.drop(engine, checkfirst=True)
    Base.metadata.create_all(engine)
    print("Tables dropped and recreated.")

if __name__ == '__main__':
    reinit()
