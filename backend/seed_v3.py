import os
from database import SessionLocal, User, Profile, Category, Topic, Post, WikiArticle, MarketListing, Event, Base, engine, PostLike, WikiLike
from datetime import datetime, timedelta
import random

def seed_serious_nostalgia():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    
    print("Enriching Skufia with Serious Nostalgia...")

    # 1. New Categories
    new_categories = [
        {"name": "Эпоха 'Железа'", "desc": "Времена, когда компьютер пах озоном, а Pentium был пределом мечтаний."},
        {"name": "Дисковый Хаос", "desc": "Митино, Горбушка и легендарные сборники программ 100-в-1."},
        {"name": "Тёмная Сеть", "desc": "О диалапе, первых локалках и ночных бдениях за скачиванием MP3."},
    ]
    
    cat_objs = []
    for c in new_categories:
        existing = db.query(Category).filter(Category.name == c['name']).first()
        if not existing:
            cat = Category(name=c['name'], description=c['desc'])
            db.add(cat)
            db.commit()
            db.refresh(cat)
            cat_objs.append(cat)
        else:
            cat_objs.append(existing)

    # 2. Key Users for the Atmosphere
    # We already have Stallman_Fan, Solder_King, No_Cloud_Skuf from seed_v2.py
    # Let's ensure we have them at hand
    def get_user(uname):
        return db.query(User).filter(User.username == uname).first()

    admin = get_user("System_Overseer")
    stallman = get_user("Stallman_Fan")
    solder = get_user("Solder_King")
    nocloud = get_user("No_Cloud_Skuf")
    dendy = get_user("Dendy_Master")
    gourmet = get_user("Gourmet_Skuf")
    
    # In case users aren't there (should be from seed_v2), we use admin
    active_users = [u for u in [stallman, solder, nocloud, dendy, gourmet] if u]
    if not active_users:
        active_users = [admin]

    # 3. Serious Topics
    conversations = [
        {
            "cat_idx": 0, # Эпоха 'Железа'
            "title": "Первый Pentium и начало конца спокойной жизни",
            "author": "Stallman_Fan",
            "replies": [
                {"u": "Solder_King", "t": "Помню, как в 96-м купил Celeron 300A и разогнал его до 450. Это была магия. Шина 100 МГц тогда казалась телепортом в будущее."},
                {"u": "No_Cloud_Skuf", "t": "А я сидел на 486DX4 до победного. Текст в Лексиконе набирался мгновенно, а больше ничего и не нужно было."},
                {"u": "Dendy_Master", "t": "Мой первый ПК был вообще без звуковухи. PC Speaker — вот настоящий хардкор. Prince of Persia под писки динамика... до мурашек."},
                {"u": "Stallman_Fan", "t": "Звук BIOS — это же молитва перед запуском системы. Если один раз пискнул, значит, всё хорошо, мир стоит на месте."}
            ]
        },
        {
            "cat_idx": 1, # Дисковый Хаос
            "title": "Горбушка 1999 года: Атмосфера и запахи",
            "author": "No_Cloud_Skuf",
            "replies": [
                {"u": "Gourmet_Skuf", "t": "Помню запах паленого пластика и кофе в маленьких стаканчиках. И бесконечные ряды с дисками 'Русский проект' и 'Фаргус'."},
                {"u": "Stallman_Fan", "t": "Фаргус делал великие локализации. Да, кривые, но в них была душа. Акелла и Бука уже потом стали 'серьезными', а тогда всё было диким полем."},
                {"u": "Solder_King", "t": "Купил там диск 'Золотая Сотня №5'. До сих пор где-то лежит. Там был софт на все случаи жизни, от Winamp до AutoCAD."},
                {"u": "No_Cloud_Skuf", "t": "Главное было не нарваться на 'болванку', которая не читается на твоем CD-ROM. Проверка дисков прямо у прилавка — это был целый ритуал."}
            ]
        },
        {
            "cat_idx": 2, # Тёмная Сеть
            "title": "Ночные бдения под визг модема US Robotics",
            "author": "Solder_King",
            "replies": [
                {"u": "Stallman_Fan", "t": "Диалап — это школа терпения. Когда ты качаешь одну песню MP3 весом 3.5 Мб целую ночь, а на 99% связь обрывается..."},
                {"u": "Dendy_Master", "t": "И мама поднимает трубку в самый неподходящий момент. 'Алё? КТО ЭТО?!' - и всё, коннекта нет."},
                {"u": "No_Cloud_Skuf", "t": "Зато какая радость была, когда поставили первую выделенку на 64 кбита. Мы чувствовали себя королями мира."},
                {"u": "Intern_Artem", "t": "А почему нельзя было просто через Starlink?"},
                {"u": "Solder_King", "t": "Артем, иди Docker обновляй. Ты не поймешь эту романтику цифрового дефицита."}
            ]
        }
    ]

    for conv in conversations:
        cat = cat_objs[conv['cat_idx']]
        author = get_user(conv['author']) or admin
        topic = Topic(title=conv['title'], category_id=cat.id, author_id=author.id)
        db.add(topic)
        db.commit()
        db.refresh(topic)
        
        db.add(Post(topic_id=topic.id, author_id=author.id, content=f"Расскажите свои истории: {conv['title']}"))
        
        for reply in conv['replies']:
            u = get_user(reply['u']) or admin
            post = Post(topic_id=topic.id, author_id=u.id, content=reply['t'])
            db.add(post)
            db.commit()
            db.refresh(post)
            # Add some likes
            for _ in range(random.randint(1, 4)):
                liker = random.choice(active_users)
                if not db.query(PostLike).filter(PostLike.post_id == post.id, PostLike.user_id == liker.id).first():
                    db.add(PostLike(post_id=post.id, user_id=liker.id))

    # 4. Wiki Articles (Serious)
    serious_wiki = [
        {"t": "Эволюция локальных сетей в спальных районах", "c": "В начале 2000-х интернет в квартиры приходил не по оптоволокну, а по 'витухе', перекинутой между домами. Грозы были главными врагами таких сетей — сгорал не только свич в подъезде, но и сетевая карта в компьютере. Это было время 'Локальных Хабов' и файлообмена DC++."},
        {"t": "Искусство разгона CPU в домашних условиях", "c": "Карандашный мод для Athlon, перемычки на материнской плате и кулеры размером с кулак. Разгон тогда был не баловством, а способом выживания, чтобы запустить Half-Life на старом железе."},
        {"t": "Кодекс CD-коллекционера", "c": "Настоящий ценитель знал: если диск с желтым логотипом 'Фаргус' — перевод будет качественным. Если коробка 'Jewel' — значит, лицензия или хороший пират. Все диски хранились в 'портмоне' на 100 мест."},
    ]
    
    for art in serious_wiki:
        u = random.choice(active_users)
        db.add(WikiArticle(title=art['t'], content=art['c'], author_id=u.id, is_verified=True))
        db.commit()

    # 5. Market Listings
    market_items = [
        {"title": "Видеокарта 3dfx Voodoo 2 12MB", "desc": "Легенда в рабочем состоянии. В комплекте кабель VGA-passthrough. Для ценителей Glide.", "price": "5000", "cat": "Hardware"},
        {"title": "Стопка журналов 'Страна Игр' (1998-2001)", "desc": "Почти все номера с постерами. Состояние удовлетворительное. Запах истории бесплатно.", "price": "2000", "cat": "Collectibles"},
        {"title": "Диалап-модем US Robotics Courier", "desc": "Лучшее, что могло случиться с вашей телефонной линией. Держит коннект даже на 'гнилой' меди.", "price": "1500", "cat": "Hardware"},
    ]
    
    for m in market_items:
        u = random.choice(active_users)
        db.add(MarketListing(title=m['title'], description=f"[{m['cat']}] {m['desc']}", price=m['price'], seller_id=u.id))
        db.commit()

    print("Skufia now breathes the 90s atmosphere!")
    db.close()

if __name__ == '__main__':
    seed_serious_nostalgia()
