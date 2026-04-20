import os
from database import SessionLocal, User, Profile, Category, Topic, Post, WikiArticle, MarketListing, Event, Base, engine, ChatRoom, ChatRoomMember, Message
from datetime import datetime, timedelta
from auth import get_password_hash

DEFAULT_PASSWORD = get_password_hash('password123')

def seed_data():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    # Clear data in FK-safe order (children before parents)
    db.query(Message).delete()
    db.query(ChatRoomMember).delete()
    db.query(ChatRoom).delete()
    db.query(WikiArticle).delete()
    db.query(MarketListing).delete()
    db.query(Post).delete()
    db.query(Topic).delete()
    db.query(Event).delete()
    db.query(Profile).delete()
    db.query(User).delete()
    db.commit()

    print("Creating initial system administrator...")
    admin = User(
        username="Vladimir Popov", 
        email="overseer@skufia.net", 
        hashed_password=DEFAULT_PASSWORD,
        handle="@up1t3rV",
        is_superadmin=True
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    
    # Create admin profile
    admin_prof = db.query(Profile).filter(Profile.user_id == admin.id).first()
    if not admin_prof:
        admin_prof = Profile(user_id=admin.id, nickname="Vladimir Popov", rank="Верховный Скуф", karma=9999, bio="Создатель и Хранитель Skufia-Net.")
        db.add(admin_prof)

    # 2. Create Archetypal Users
    users_data = [
        {"username": "Tea_Master", "email": "tea@skufia.net", "rank": "Магистр Заварки", "karma": 500, "bio": "Знаю всё о правильном чае и тишине."},
        {"username": "CRT_Guru", "email": "crt@skufia.net", "rank": "Архитектор ЭЛТ", "karma": 750, "bio": "Верну любой монитор к жизни."},
        {"username": "Old_School_Coder", "email": "code@skufia.net", "rank": "Легенда C++", "karma": 1200, "bio": "Писал код, когда интернет был по карточкам."},
    ]

    for u_data in users_data:
        user = db.query(User).filter(User.username == u_data['username']).first()
        if not user:
            user = User(username=u_data['username'], email=u_data['email'], hashed_password=DEFAULT_PASSWORD)
            db.add(user)
            db.commit()
            db.refresh(user)
            prof = Profile(user_id=user.id, rank=u_data['rank'], karma=u_data['karma'], bio=u_data['bio'])
            db.add(prof)

    # 3. Seed Forum Categories
    categories = [
        {"name": "Железо и Археология", "desc": "Обсуждение винтажного железа и способов его оживления."},
        {"name": "Бытовой Комфорт", "desc": "Лучшие майки, тапочки и эргономика дивана."},
        {"name": "Философия Скуфства", "desc": "Размышления о смысле жизни в эпоху цифрового шума."},
    ]

    cat_map = {}
    for c in categories:
        category = db.query(Category).filter(Category.name == c['name']).first()
        if not category:
            category = Category(name=c['name'], description=c['desc'])
            db.add(category)
            db.commit()
            db.refresh(category)
        cat_map[c['name']] = category

    # 4. Seed Forum Topics & Posts (Rich Historical Data: 60 Days)
    forum_content = [
        {"cat": "Железо и Археология", "title": "Эпоха 3dfx Voodoo", "author": "CRT_Guru"},
        {"cat": "Железо и Археология", "title": "Почему ЭЛТ лучше ЖК?", "author": "CRT_Guru"},
        {"cat": "Бытовой Комфорт", "title": "Обзор идеальной майки", "author": "Tea_Master"},
        {"cat": "Философия Скуфства", "title": "Симфония 56k", "author": "Old_School_Coder"},
        {"cat": "Философия Скуфства", "title": "Как перестать обновлять всё?", "author": "Old_School_Coder"},
        {"cat": "Железо и Археология", "title": "Ошибки IRQ: Воспоминания о дип-переключателях", "author": "Old_School_Coder"},
        {"cat": "Бытовой Комфорт", "title": "Рецепт идеальных пельменей", "author": "Tea_Master"},
    ]

    import random
    messages = [
        "База.", "Кринж, но забавно.", "Помню такое.", "Раньше было лучше.",
        "Лайк за Sony Trinitron.", "Это классика, это знать надо!",
        "Сколково отдыхает.", "У меня такой в гараже лежит.",
        "Плюсую.", "Не согласен, ЖК удобнее для глаз.",
        "Хватает ли 256 метров ОЗУ для этого?", "Кто в 2024 до сих пор сидит на ХР?",
        "Я.", "Стабильность превыше всего.", "Кодекс Скуфа не одобряет этот пост."
    ]

    for item in forum_content:
        user = db.query(User).filter(User.username == item['author']).first()
        if not user: continue
        
        topic = db.query(Topic).filter(Topic.title == item['title']).first()
        if not topic:
            # Random starting date within last 60 days
            start_date = datetime.utcnow() - timedelta(days=60)
            topic = Topic(title=item['title'], category_id=cat_map[item['cat']].id, author_id=user.id, created_at=start_date)
            db.add(topic)
            db.commit()
            db.refresh(topic)
            
            # Generate 15-20 posts over time
            for i in range(random.randint(15, 25)):
                post_date = start_date + timedelta(days=i * 2 + random.uniform(0, 1))
                if post_date > datetime.utcnow(): post_date = datetime.utcnow()
                random_user = db.query(User).filter(User.username != "System_Overseer").all()
                poster = random.choice(random_user)
                post = Post(topic_id=topic.id, author_id=poster.id, content=random.choice(messages), created_at=post_date)
                db.add(post)
    db.commit()

    # 5. Seed Wiki Articles (15+ Articles)
    wiki_articles = [
        {"title": "Кодекс Скуфа", "content": "1. Уважай старое железо. 2. Майка должна быть хлопковой. 3. Пиво — это жидкий хлеб."},
        {"title": "Руководство по реанимации ЭЛТ", "content": "Как оживить ваш Sony Trinitron с помощью паяльника и молитвы."},
        {"title": "История звука: OPL3", "content": "Почему синтезаторы Yamaha 90-х звучат лучше современной цифры."},
        {"title": "Сборка ПК в 2007-м", "content": "Core 2 Duo, 8800 GT и блок питания на 500Вт — предел мечтаний."},
        {"title": "Gothic 2: Секреты Хориниса", "content": "Как украсть всё у кузнеца и не попасться ополчению."},
        {"title": "Lineage II: Хроники С4", "content": "Воспоминания о бессонных ночах в катакомбах и очередях на рейдов."},
        {"title": "Терминология Скуфнета", "content": "Скуф, Альтушка, База, Кринж — словарь олдфага."},
        {"title": "Антенна из пивной банки", "content": "Как поймать сигнал там, где его никогда не было."},
        {"title": "Лучшие пельмени: Рейтинг 2024", "content": "Тестируем категорию А и Б под холодное светлое."},
        {"title": "Эстетика панелек ночью", "content": "Почему бетонные джунгли кажутся уютными под свет фонарей."},
        {"title": "Забытые браузерные игры", "content": "БК, Бойцовский клуб и прочие легенды эры Dial-up."},
        {"title": "Настройка Winamp skin", "content": "Как сделать ваш плеер похожим на приборную панель НЛО."},
        {"title": "Психология затворничества", "content": "Почему сидеть дома в 40 лет — это не депрессия, а осознанный выбор."},
        {"title": "Огород на балконе: Укроп", "content": "Технология выращивания закуски в условиях квартиры."},
        {"title": "Моддинг корпуса Inwin", "content": "Как вырезать окно в стальном листе 1мм болгаркой."},
        {"title": "Чистка клавиатуры Model M", "content": "Полная разборка и мойка клавиш в посудомойке."},
    ]
    for art in wiki_articles:
        db.add(WikiArticle(title=art['title'], content=art['content'], author_id=admin.id))

    # 6. Seed Market Listings
    market_items = [
        {"title": "Монитор Sony Trinitron", "desc": "В отличном состоянии, легкий засвет по углам.", "price": "Обмен на чай или 2000р", "seller": "CRT_Guru"},
        {"title": "Механическая клавиатура IBM Model M", "desc": "Звучит как пулемет. Состояние: музейное.", "price": "5000р", "seller": "Old_School_Coder"},
    ]
    for item in market_items:
        user = db.query(User).filter(User.username == item['seller']).first()
        if user and not db.query(MarketListing).filter(MarketListing.title == item['title']).first():
            db.add(MarketListing(title=item['title'], description=item['desc'], price=item['price'], seller_id=user.id))

    # 7. Seed Chat Rooms
    chat_rooms = [
        {"name": "Глобальный Сектор", "type": "channel"},
        {"name": "Курилка Железячников", "type": "group"},
        {"name": "Архив 56k", "type": "group"},
    ]
    for r_data in chat_rooms:
        if not db.query(ChatRoom).filter(ChatRoom.name == r_data['name']).first():
            room = ChatRoom(name=r_data['name'], room_type=r_data['type'])
            db.add(room)
            db.commit()
            db.refresh(room)
            # Add admin to rooms
            db.add(ChatRoomMember(room_id=room.id, user_id=admin.id))

    # 8. Seed Events
    event = Event(
        title="Великий Сбор в Гаражах",
        description="Обсуждение будущего интернета при отключении всех облаков.",
        event_date=datetime.utcnow() + timedelta(days=10),
        location="Гаражный кооператив 'Заря', бокс 42",
        organizer_id=admin.id
    )
    db.add(event)

    db.commit()
    print("Successfully seeded the Skufia Ecosystem with lore and content!")
    db.close()

if __name__ == '__main__':
    seed_data()