import logging
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes
from .database import SessionLocal, User, Profile
from .auth import create_access_token

import os

# Configuration should be moved to environment variables in production
BOT_TOKEN = os.environ.get('BOT_TOKEN', '')
BASE_URL = os.environ.get('BASE_URL', 'http://localhost:5551')

logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Welcome message for the Operator"""
    user = update.effective_user
    await update.message.reply_text(
        f"Привет, Оператор {user.first_name}!\n\nДобро пожаловать в терминал управления Skufia.\n\nДоступные команды:\n/profile - Ваш статус и карма\n/wiki - Последние записи библиотеки\n/login - Получить ссылку для входа на портал",
        parse_mode='Markdown'
    )

async def get_profile(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Fetch user profile from the DB using telegram_id"""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.telegram_id == str(update.effective_user.id)).first()
        if not user:
            await update.message.reply_text("Вы еще не зарегистрированы в системе Skufia. Пожалуйста, создайте аккаунт на портале.")
            return

        profile = db.query(Profile).filter(Profile.user_id == user.id).first()
        rank = profile.rank if profile else 'Новичок'
        karma = profile.karma if profile else 0

        await update.message.reply_text(
            f"📋 **Профиль Оператора**\n\nИмя: {user.username or user.first_name}\nРанг: {rank}\nКарма: {karma} pts",
            parse_mode='Markdown'
        )
    finally:
        db.close()

async def get_login_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Generate a magic link for seamless login"""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.telegram_id == str(update.effective_user.id)).first()
        if not user:
            await update.message.reply_text("Вы еще не зарегистрированы в системе Skufia. Пожалуйста, создайте аккаунт на портале и привяжите Telegram.")
            return

        token = create_access_token(data={"sub": user.username, "user_id": user.id})
        await update.message.reply_text(
            f"Ваш персональный одноразовый ключ для входа:\n\n`{token}`\n\nИспользуйте его на главной странице портала: {BASE_URL}",
            parse_mode='Markdown'
        )
    finally:
        db.close()

async def run_bot():
    if not BOT_TOKEN:
        logging.warning("BOT_TOKEN is not set. Telegram bot will not start.")
        return

    application = ApplicationBuilder().token(BOT_TOKEN).build()

    application.add_handler(CommandHandler('start', start))
    application.add_handler(CommandHandler('profile', get_profile))
    application.add_handler(CommandHandler('login', get_login_link))

    # Using start_polling instead of run_polling so it doesn't block the event loop
    await application.initialize()
    await application.start()
    await application.updater.start_polling()
    logging.info("Telegram Bot started successfully.")
