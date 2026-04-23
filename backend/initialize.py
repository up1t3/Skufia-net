from database import engine, Base, MarketListing, ListingFavorite

def initialize_market_module():
    print("Initializing Market Module...")
    print("Dropping old market_listings and listing_favorites tables...")

    # We drop these explicitly to wipe out old data and schema
    try:
        ListingFavorite.__table__.drop(engine, checkfirst=True)
        MarketListing.__table__.drop(engine, checkfirst=True)
    except Exception as e:
        print(f"Error dropping tables: {e}")

    print("Recreating market_listings and listing_favorites tables...")
    MarketListing.__table__.create(engine, checkfirst=True)
    ListingFavorite.__table__.create(engine, checkfirst=True)

    print("Market Module initialized successfully.")

if __name__ == "__main__":
    initialize_market_module()
