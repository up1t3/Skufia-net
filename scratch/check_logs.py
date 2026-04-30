import paramiko, sys
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('147.45.245.133', username='root', password='y38N*dQM.X33k?')

stdin, stdout, stderr = client.exec_command('''
cd /opt/skufia
docker compose -f docker-compose.production.yml logs --tail=50 backend-green
''')

out = stdout.read().decode()
err = stderr.read().decode()
print("=== BACKEND LOGS ===")
print(out)
if err:
    print("=== STDERR ===")
    print(err)
client.close()
