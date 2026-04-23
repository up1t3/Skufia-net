import os
import sqlalchemy

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./backend/data/skufia.db")
engine = sqlalchemy.create_engine(DATABASE_URL)

def main():
    with engine.connect() as conn:
        if "sqlite" in DATABASE_URL:
            conn.execute(sqlalchemy.text("DELETE FROM room_key_bundles;"))
        else:
            conn.execute(sqlalchemy.text("TRUNCATE TABLE room_key_bundles RESTART IDENTITY CASCADE;"))
        conn.commit()
    print("All keys reset.")

if __name__ == "__main__":
    main()
