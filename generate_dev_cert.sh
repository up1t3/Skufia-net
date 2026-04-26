#!/bin/bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout certs/skufia.key -out certs/skufia.crt -subj "/C=RU/ST=Moscow/L=Moscow/O=Skufia/OU=IT/CN=localhost"
echo "Dummy certs generated in ./certs"
