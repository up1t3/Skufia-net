#!/bin/bash
# Blue-Green Deployment Script for Skufia-Net (Windows + Docker + Git Bash)
# Обеспечивает деплой бэкенда без даунтайма (Zero-Downtime)

set -e

# Конфигурация
NGINX_CONF="frontend/upstream.conf"
DOCKER_COMPOSE_FILE="docker-compose.yml"
BLUE_PORT=5011
GREEN_PORT=5012

echo "🔄 Начинаем Blue-Green деплой..."

# 1. Определяем текущую активную среду из конфига Nginx
if grep -q "server skufia-api-blue:8007;" "$NGINX_CONF"; then
    CURRENT_ENV="blue"
    CURRENT_PORT=$BLUE_PORT
    NEXT_ENV="green"
    NEXT_PORT=$GREEN_PORT
elif grep -q "server skufia-api-green:8007;" "$NGINX_CONF"; then
    CURRENT_ENV="green"
    CURRENT_PORT=$GREEN_PORT
    NEXT_ENV="blue"
    NEXT_PORT=$BLUE_PORT
else
    echo "⚠️ Текущая среда не распознана, используем Green ($GREEN_PORT) по умолчанию."
    CURRENT_ENV="blue"
    CURRENT_PORT=$BLUE_PORT
    NEXT_ENV="green"
    NEXT_PORT=$GREEN_PORT
fi

echo "🟢 Текущая среда: $CURRENT_ENV (порт $CURRENT_PORT)"
echo "🚀 Разворачиваем новую версию в: $NEXT_ENV (порт $NEXT_PORT)"

# 2. Обновляем код
echo "📥 Выкачиваем свежий код из репозитория..."
git pull origin main || echo "Локальные изменения, git pull пропущен"

# 3. Поднимаем новый контейнер
echo "🐳 Сборка и запуск сервиса backend-$NEXT_ENV..."
docker compose -f $DOCKER_COMPOSE_FILE up -d --build backend-$NEXT_ENV

# 4. Проверяем здоровье (Healthcheck) нового контейнера через опубликованный порт
echo "⏳ Ожидаем готовности нового сервера на порту $NEXT_PORT..."
HEALTHY=false
for i in {1..15}; do
    # Наш бэкенд отдает {"status": "ok"} на /api/health (или просто проверяем корень API)
    # Если health_check нет, можно проверить любой публичный эндпоинт, например /docs
    if curl -s "http://127.0.0.1:$NEXT_PORT/docs" | grep -q "Swagger UI"; then
        echo "✅ Сервер $NEXT_ENV успешно запустился и отвечает!"
        HEALTHY=true
        break
    fi
    echo "Ожидание... ($i/15)"
    sleep 2
done

if [ "$HEALTHY" != true ]; then
    echo "❌ ОШИБКА: Новый сервер не ответил вовремя. Откат (тушим backend-$NEXT_ENV)."
    docker compose stop backend-$NEXT_ENV
    exit 1
fi

# 5. Переключаем Nginx (перенаправляем трафик) внутри файла конфигурации
echo "🔁 Переключение трафика Nginx на $NEXT_ENV..."
sed -i "s/server skufia-api-$CURRENT_ENV:8007;/server skufia-api-$NEXT_ENV:8007;/g" $NGINX_CONF

# Перезагружаем Nginx внутри контейнера frontend
echo "🔄 Перезагрузка Nginx в контейнере skufia-web..."
docker exec skufia-web nginx -s reload

echo "🎉 Трафик успешно переключен на $NEXT_ENV версию!"

# 6. Тушим старый контейнер
echo "🛑 Останавливаем старую версию (backend-$CURRENT_ENV)..."
docker compose stop backend-$CURRENT_ENV || true

echo "✅ Blue-Green деплой успешно завершен. Пользователи ничего не заметили!"
