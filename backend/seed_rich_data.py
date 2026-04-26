import os
import random
from database import SessionLocal, User, Profile, Category, Topic, Post, WikiArticle, MarketListing, Event, Base, engine, ChatRoom, ChatRoomMember
from auth import get_password_hash
from datetime import datetime, timedelta

def seed_rich_data():
    print("Initializing Skufia-Net Rich Lore Seeder (2000-2007 Edition - DEEP IMMERSION)...")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    # Default password for all seeded users
    default_password = get_password_hash("password123")

    # 1. Users with distinct personalities
    users_data = [
        {"username": "Admin_Skuf", "email": "admin@skufia.net", "rank": "SysOp", "karma": 1337, "bio": "ROOT. Помню фидонет и звонки по модему."},
        {"username": "Tea_Master", "email": "tea@skufia.net", "rank": "Магистр Заварки", "karma": 850, "bio": "ICQ: 123456. Не стучать, если не к спеху."},
        {"username": "L2_Hero", "email": "l2@skufia.net", "rank": "Герой Адена", "karma": 620, "bio": "Teon x1. Сливаю нубов у Диона. 2007 - лучший год."},
        {"username": "CRT_Guru", "email": "crt@skufia.net", "rank": "Архитектор ЭЛТ", "karma": 1100, "bio": "Mitsubishi Diamondtron - это предел мечтаний."},
        {"username": "Anime_Ripper", "email": "rip@skufia.net", "rank": "DVD-700", "karma": 480, "bio": "Кодирую XviD за еду. Верните мне мой 2007-й."},
        {"username": "Pentium_IV", "email": "p4@skufia.net", "rank": "478 Pin", "karma": 300, "bio": "Hyper-Threading тащит. Греюсь до 70 градусов."},
        {"username": "Winamp_User", "email": "mp3@skufia.net", "rank": "Llama Ass Kicker", "karma": 550, "bio": "Skins: Modern. EQ: Full Bass & Treble."},
        {"username": "Gothic_Fan", "email": "gothic@skufia.net", "rank": "Ксардас", "karma": 900, "bio": "Готика 2: Ночь Ворона - шедевр на века."},
        {"username": "Morrowinder", "email": "nerevar@skufia.net", "rank": "Нереварин", "karma": 770, "bio": "Где это? Справа от входа, за деревом..."},
        {"username": "CounterStroke", "email": "cs16@skufia.net", "rank": "Pro-1.6", "karma": 400, "bio": "Не кемпери, нуб. 320x240 - мой конфиг."},
    ]

    user_objs = {}
    for u in users_data:
        user = User(username=u['username'], email=u['email'], hashed_password=default_password)
        db.add(user)
        db.commit()
        db.refresh(user)
        prof = Profile(user_id=user.id, rank=u['rank'], karma=u['karma'], bio=u['bio'], avatar_url=f"https://api.dicebear.com/7.x/pixel-art/svg?seed={u['username']}")
        db.add(prof)
        user_objs[u['username']] = user

    # 2. Categories
    categories = [
        {"name": "Железо и Археология", "desc": "AGP, PCI, ISA и прочие древности."},
        {"name": "Культура 2007", "desc": "ICQ, челки, блейзер и Lineage II."},
        {"name": "Склад Дампов", "desc": "DVD-рипы, софт и архивы."},
        {"name": "Игровая Зона", "desc": "Обсуждение хитов 2000-х."},
    ]
    cat_objs = {c['name']: Category(name=c['name'], description=c['desc']) for c in categories}
    for c in cat_objs.values(): db.add(c)
    db.commit()

    # 3. 60 Days of Lore Snippets
    now = datetime.utcnow()
    usernames = list(user_objs.keys())
    cat_names = list(cat_objs.keys())
    
    lore_snippets = [
        "Кто-нибудь знает, как запустить Crysis на GeForce 6600?",
        "Вчера подняли сервер Lineage 2 C4, пинг отличный!",
        "Купил блейзер, сижу слушаю Amatory. Где мой 2007-й?",
        "ICQ опять тупит, перехожу на QIP 2005.",
        "Нашел на антресоли Pentium III, буду собирать ретро-машину.",
        "Чем лучше жать DVD? DivX или XviD?",
        "Dota Allstars 6.43 вышла, имба на имбе.",
        "Статуса 'Invisible' в аське достаточно, чтобы скрыться от военкомата?",
        "Помните запах новых дискет?",
        "Gothic 3 тормозит даже на топ-железе, разрабы - криворукие.",
        "S.T.A.L.K.E.R. Тени Чернобыля - это шедевр, хоть и багованный.",
        "WoW Burning Crusade - Иллидан ждет нас!",
        "Продам Radeon 9600 Pro за 500 рублей. Почти не гнал.",
        "Как установить скины на Winamp 2.8?",
        "Re: Ищу crack для Need for Speed Carbon.",
        "Counter-Strike 1.6 vs Source. Олдфаги выбирают 1.6.",
        "Кто помнит чат Bivest или Mail.ru Агент?",
        "Качаю аниме через eMule, скорость 5 Кб/с, кайф.",
        "Обзор диска Игромании за май. Видеомания рулит!",
        "Как пропатчить KDE2 под FreeBSD? (Классика)"
    ]

    print("Generating 60 days of community history...")
    for i in range(60, -1, -1):
        day = now - timedelta(days=i)
        num_topics = random.randint(1, 3)
        for _ in range(num_topics):
            author_name = random.choice(usernames)
            cat_name = random.choice(cat_names)
            snippet = random.choice(lore_snippets)
            topic_title = f"{snippet[:40]}..."
            topic = Topic(title=topic_title, category_id=cat_objs[cat_name].id, author_id=user_objs[author_name].id, created_at=day)
            db.add(topic)
            db.commit()
            db.refresh(topic)
            
            num_posts = random.randint(3, 8)
            for p_idx in range(num_posts):
                p_author = random.choice(usernames)
                p_content = f"Re: {topic_title}\n{random.choice(lore_snippets)}\n{'!' * random.randint(1, 5)}"
                post = Post(topic_id=topic.id, author_id=user_objs[p_author].id, content=p_content, created_at=day + timedelta(hours=p_idx*3))
                db.add(post)
    
    # 4. Rich Wiki (15+ Articles)
    wiki_data = [
        ("Кодекс Скуфа: Редакция 2007", "1. Чай должен быть горячим.\n2. Монитор - тяжелым.\n3. ICQ - включенным.\n4. Windows XP ZverCD - базой.\n5. Блейзер - по пятницам."),
        ("ICQ Инструктажи", "Секреты порта 5190. Как получить 6-знак. История Мирабилиса. Почему QIP 2005 лучше оригинального клиента."),
        ("Герои Адена", "Сервер Teon. Кланы RedSky и Dw. Хроники Interlude. Почему Lineage 2 - это вторая работа. Осада Адена 2007-го."),
        ("Эра AGP", "Последние вздохи шины AGP. Radeon X1950 Pro - лебединая песня. Почему переход на PCI-Express был болезненным."),
        ("Готика 2: Гайд", "Где найти драконий корень. Как вступить в паладины без СМС и регистрации. Пиво от Корагона - лучший бафф."),
        ("Талмуд по Winamp", "Skins, Visualizations (MilkDrop!), и почему версия 5.0 'The best of both worlds'."),
        ("Культура ZverCD", "История самой популярной сборки Windows XP в СНГ. Почему драйвера ставились сами, а обои были вырвиглазными."),
        ("Священные войны: DivX vs XviD", "Битва кодеков. Почему 700Мб - это стандарт для рипа. Резаки Nec и диски Verbatim."),
        ("Сталкер: Путь в Припять", "История разработки. Ждалкер 2002-2007. Как спастись от кровососа в Агропроме."),
        ("Diablo II: Runewords", "Enigma, Infinity, Insight. Почему Баал-ран - это смысл жизни. Сет Тал Раши."),
        ("WoW: Burning Crusade", "Портал открыт. Иллидан: 'You are not prepared!'. Как летать в Запределье."),
        ("История Counter-Strike", "От мода Half-Life к мировому господству. Легендарные карты: de_dust2, cs_militia, de_aztec."),
        ("Даркнет 2007", "IRC-каналы, приватные FTP, и почему никто не боялся 'товарища майора'."),
        ("Morrowind: Lore", "Вивек, Альмалексия, Сота Сил. Почему Дагот Ур - не злодей, а патриот."),
        ("Need for Speed: Carbon", "Автоскульпт, каньоны и почему Most Wanted 2005 всё равно лучше."),
        ("GTA: San Andreas", "Hot Coffee, моды на русские тачки и поиски Бигфута в лесу."),
        ("Игромания: Наследие", "Видеомания с Логвиновым и Кузьменко. Наклейки, диск, и запах свежего журнала.")
    ]
    for title, content in wiki_data:
        db.add(WikiArticle(title=title, content=content, author_id=user_objs['Admin_Skuf'].id))

    # 5. Market Listings
    market_items = [
        ("GeForce 8800 GTX", "Топ за свои деньги. Потянет Crysis!", 5000),
        ("Диск Lineage 2 C4", "Лицензия от Буки.", 300),
        ("Монитор SyncMaster 757MB", "100Гц в 1024x768! Глаза не болят.", 1200),
        ("Коврик для мыши SteelSeries", "Для про-геймеров.", 600),
    ]
    for title, desc, price in market_items:
        db.add(MarketListing(title=title, description=desc, price=price, seller_id=user_objs[random.choice(usernames)].id))

    db.commit()
    db.close()
    print("Skufia-Net IMMERSION COMPLETE. 60 days of history and 15+ Wiki articles seeded.")

if __name__ == '__main__':
    seed_rich_data()
