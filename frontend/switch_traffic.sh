#!/bin/bash

# Blue-Green Nginx Traffic Switcher
UPSTREAM_FILE="upstream.conf"

if grep -q "skufia-api-green" "$UPSTREAM_FILE"; then
    echo "Current active backend: GREEN. Switching to BLUE..."
    sed -i 's/skufia-api-green/skufia-api-blue/g' "$UPSTREAM_FILE"
elif grep -q "skufia-api-blue" "$UPSTREAM_FILE"; then
    echo "Current active backend: BLUE. Switching to GREEN..."
    sed -i 's/skufia-api-blue/skufia-api-green/g' "$UPSTREAM_FILE"
else
    echo "Could not detect active backend in $UPSTREAM_FILE"
    exit 1
fi

echo "Configuration updated. Reloading Nginx..."
# Reloading Nginx inside the Docker container
docker exec skufia-web nginx -s reload
echo "Traffic successfully switched!"
