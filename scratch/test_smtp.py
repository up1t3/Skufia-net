import smtplib
from email.mime.text import MIMEText

def test_smtp():
    try:
        sender_email = 'skuf-net@yandex.com'
        sender_password = 'jzglcxwopljrzyvp'
        to_email = 'e.zaikina0509@gmail.com'
        
        msg = MIMEText("Тестовое сообщение от SKUFenger E2E SMTP Diagnostics.")
        msg['Subject'] = 'SKUFenger SMTP Test'
        msg['From'] = f"SKUFenger <{sender_email}>"
        msg['To'] = to_email
        
        print("Connecting to host.docker.internal:2525...")
        server = smtplib.SMTP('host.docker.internal', 2525, timeout=10)
        print("Logging in...")
        server.login(sender_email, sender_password)
        print("Sending test mail...")
        server.sendmail(sender_email, [to_email], msg.as_string())
        server.quit()
        print("SUCCESS: SMTP test completed successfully!")
    except Exception as e:
        print(f"FAILED: SMTP test failed: {e}")

if __name__ == '__main__':
    test_smtp()
