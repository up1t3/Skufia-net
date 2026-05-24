#!/bin/bash
docker exec skufia-postgres psql -U postgres -d skufia -c "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wallpaper_idx VARCHAR DEFAULT '0';"
