from sqlalchemy.orm import Session
from database import SessionLocal, engine
import models
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def seed():
    db = SessionLocal()
    
    # Check if a default user exists, if not create one
    admin = db.query(models.User).filter(models.User.username == "admin_archivist").first()
    if not admin:
        admin = models.User(username="admin_archivist", hashed_password=pwd_context.hash("skuf123"))
        db.add(admin)
        db.commit()
        db.refresh(admin)
        
        # Create profile
        profile = models.Profile(user_id=admin.id, rank="Archivist", karma=9999, avatar_url="https://api.dicebear.com/7.x/bottts/svg?seed=admin")
        db.add(profile)
        db.commit()

    # Seed Wiki
    if db.query(models.WikiArticle).count() == 0:
        articles = [
            models.WikiArticle(title="Эпоха модемов: Дозвон до провайдера", content="Инструкции по настройке US Robotics и ZyXEL. Шум модема как гимн 90-х.", author_id=admin.id),
            models.WikiArticle(title="Радиорынки и пиратские диски: История Фаргуса", content="Где достать редкие программы, кряки на играх и золотые сборники 200 игр на 1 диске.", author_id=admin.id),
            models.WikiArticle(title="Аппаратный апгрейд: от 386 до Pentium II", content="Переходные этапы. Звуковые карты Sound Blaster и революция 3Dfx Voodoo.", author_id=admin.id),
            models.WikiArticle(title="FIDO: Первая социальная сеть", content="Как работала Фидонет, поинты, ноды, эхоконференции и золотые правила сетевого этикета 90-х.", author_id=admin.id),
        ]
        db.add_all(articles)
        db.commit()

    # Seed Forum
    if db.query(models.Topic).count() == 0:
        topics = [
            models.Topic(title="Поиск редких драйверов под Windows 98", category_id=1, author_id=admin.id),
            models.Topic(title="Обсуждение железа: Разгон Celeron 300A", category_id=1, author_id=admin.id),
            models.Topic(title="Кто помнит журналы Хакер начала 2000-х?", category_id=2, author_id=admin.id),
            models.Topic(title="Житейские истории: Как мы собирали первый ПК", category_id=3, author_id=admin.id),
            models.Topic(title="Dendy против Sega: великое противостояние 90-х", category_id=4, author_id=admin.id),
        ]
        db.add_all(topics)
        db.commit()

    print("Seeding complete.")

if __name__ == "__main__":
    seed()
