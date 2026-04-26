#!/bin/bash
source .env 2>/dev/null
sshpass -p "$SERVER_PASSWORD" ssh -o StrictHostKeyChecking=no root@147.45.245.133 'docker logs skufia-api-green --tail 100 2>&1' | grep -iE 'upload|error|415|413|SECURITY|failed' | tail -30
