import os
from database import SessionLocal, User, Profile, Category, Topic, Post, WikiArticle, MarketListing, Event, Base, engine, PostLike, WikiLike
from datetime import datetime, timedelta
import random

def seed_enhanced_data():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    
    # Check if we already have a lot of users to avoid double seeding
    if db.query(User).count() > 10:
        print("Database already looks populated. Skipping enhanced seed.")
        db.close()
        return

    print("Breating life into Skufia Ecosystem...")

    # 1. Create More Diverse Users
    users_data = [
        {"username": "Stallman_Fan", "email": "rms@skufia.net", "rank": "Ветеран Linux", "karma": 2100, "bio": "Компилирую ядро по утрам вместо кофе."},
        {"username": "Dendy_Master", "email": "8bit@skufia.net", "rank": "Мастер Картриджей", "karma": 1200, "bio": "Знаю, как починить джойстик зубочисткой."},
        {"username": "No_Cloud_Skuf", "email": "local@skufia.net", "rank": "Локальный Пророк", "karma": 800, "bio": "Моё облако — это мой NAS в шкафу."},
        {"username": "Intern_Artem", "email": "artem@skufia.net", "rank": "Новичок в майке", "karma": 50, "bio": "А почему мы не используем Docker Desktop?"},
        {"username": "Gourmet_Skuf", "email": "chef@skufia.net", "rank": "Ценитель Пельменей", "karma": 450, "bio": "Лучший сорт пельменей — те, что с майонезом."},
        {"username": "Solder_King", "email": "flux@skufia.net", "rank": "Король Канифоли", "karma": 1700, "bio": "Могу припаять надежду к безнадеге."},
    ]

    all_users = []
    # Add original admin
    admin = db.query(User).filter(User.username == "System_Overseer").first()
    if admin: all_users.append(admin)

    for u_data in users_data:
        user = User(username=u_data['username'], email=u_data['email'], hashed_password="hashed_pass")
        db.add(user)
        db.commit()
        db.refresh(user)
        prof = Profile(user_id=user.id, rank=u_data['rank'], karma=u_data['karma'], bio=u_data['bio'])
        db.add(prof)
        all_users.append(user)

    # 2. Add More Categories
    new_categories = [
        {"name": "Гаражные Байки", "desc": "Истории, которые лучше рассказывать под капотом или у верстака."},
        {"name": "Программная Археология", "desc": "Запуск софта, который старше большинства пользователей."},
        {"name": "Пельменная Критика", "desc": "Главный гастрономический раздел портала."},
    ]
    
    cat_objs = []
    for c in new_categories:
        cat = Category(name=c['name'], description=c['desc'])
        db.add(cat)
        db.commit()
        db.refresh(cat)
        cat_objs.append(cat)

    # 3. Add Many Topics and Conversations
    conversations = [
        {
            "cat_idx": 0, # Гаражные Байки
            "title": "Как я пытался завести 'Победу' в -30",
            "author": "Solder_King",
            "replies": [
                {"u": "Stallman_Fan", "t": "Надо было просто прогреть карбюратор феном, как мы серваки греем."},
                {"u": "Solder_King", "t": "Фен сгорел на второй минуте. Пришлось использовать паяльную лампу."},
                {"u": "Dendy_Master", "t": "У меня так приставка однажды сплавилась, когда я её у батареи оставил."},
                {"u": "No_Cloud_Skuf", "t": "В гараже должен быть запас угля и дров на такие случаи!"}
            ]
        },
        {
            "cat_idx": 1, # Программная Археология
            "title": "Запустил Win95 на умном чайнике",
            "author": "Stallman_Fan",
            "replies": [
                {"u": "Intern_Artem", "t": "А зачем? Там же даже Chrome не пойдет."},
                {"u": "Old_School_Coder", "t": "Артем, ты не понимаешь... Это же чистое искусство!"},
                {"u": "Stallman_Fan", "t": "Зато там Сапёр летает. И никакого телеметрии от Microsoft."},
                {"u": "Gourmet_Skuf", "t": "Главное, чтобы чайник всё еще воду кипятил, а то пельмени не в чем варить будет."}
            ]
        },
        {
            "cat_idx": 2, # Пельменная Критика
            "title": "Рейтинг майонеза 2026: Что не превращает еду в пластик?",
            "author": "Gourmet_Skuf",
            "replies": [
                {"u": "Tea_Master", "t": "Лучший майонез — это сметана."},
                {"u": "Gourmet_Skuf", "t": "Сметана для слабаков. Настоящий Скуф выбирает Провансаль 67%."},
                {"u": "No_Cloud_Skuf", "t": "Я сам делаю. Яйца от соседа, масло из погреба. Никакой химии."},
                {"u": "Intern_Artem", "t": "А я заказал через дрон-доставку 'Light Mayo', вроде норм."},
                {"u": "Gourmet_Skuf", "t": "Бан за 'Light Mayo'. Это оскорбление традиций."}
            ]
        }
    ]

    for conv in conversations:
        # Get category or fallback to first
        cat = cat_objs[conv['cat_idx']] if conv['cat_idx'] < len(cat_objs) else cat_objs[0]
        author = db.query(User).filter(User.username == conv['author']).first()
        topic = Topic(title=conv['title'], category_id=cat.id, author_id=author.id)
        db.add(topic)
        db.commit()
        db.refresh(topic)
        
        # Initial post
        db.add(Post(topic_id=topic.id, author_id=author.id, content=f"Стартуем тред: {conv['title']}"))
        
        # Replies
        for reply in conv['replies']:
            u = db.query(User).filter(User.username == reply['u']).first()
            if u:
                post = Post(topic_id=topic.id, author_id=u.id, content=reply['t'])
                db.add(post)
                db.commit()
                db.refresh(post)
                
                # Random likes
                for _ in range(random.randint(0, 5)):
                    liker = random.choice(all_users)
                    if not db.query(PostLike).filter(PostLike.post_id == post.id, PostLike.user_id == liker.id).first():
                        db.add(PostLike(post_id=post.id, user_id=liker.id))

    # 4. More Wiki Articles
    wiki_data = [
        {"t": "Классификация тапочек по уровню комфорта", "c": "1. Резиновые (для душа/гаража)\n2. Пушистые (для зимы)\n3. 'Батины' кожаные (ультимативный выбор)."},
        {"t": "Как выжить, если упал StackOverflow", "c": "Ищите старые книги по C++ в шкафу. Там всё есть. Даже то, чего нет в интернете."},
        {"t": "Этика использования системных ресурсов", "c": "Если CPU греется выше 70 градусов — значит, ты либо компилируешь ядро, либо майнишь. Второе запрещено Кодексом."},
    ]
    
    for art in wiki_data:
        author = random.choice(all_users)
        db.add(WikiArticle(title=art['t'], content=art['c'], author_id=author.id, is_verified=True))

    db.commit()
    print("Skufia is now ALIVE and BUSY!")
    db.close()

if __name__ == '__main__':
    seed_enhanced_data()
