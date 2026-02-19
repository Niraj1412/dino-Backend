#!/bin/sh
set -e

npm run migrate:deploy
npm run seed:sql

exec node dist/server.js