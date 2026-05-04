import sys
import os

# Add the current directory to the path so we can import from backend modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal, User
from auth import get_password_hash

def reset_password(username: str, new_password: str):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            print(f"[-] Пользователь '{username}' не найден.")
            return

        user.hashed_password = get_password_hash(new_password)
        db.commit()
        print(f"[+] Пароль для пользователя '{username}' успешно изменен!")
        print(f"    Новый пароль: {new_password}")
    except Exception as e:
        print(f"[-] Ошибка при обновлении пароля: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Использование: python reset_password.py <имя_пользователя> <новый_пароль>")
        print("Пример: python reset_password.py admin 12345678")
        sys.exit(1)
        
    username = sys.argv[1]
    new_password = sys.argv[2]
    reset_password(username, new_password)
