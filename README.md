# Business Zero Backend v2

Файлы этого архива предназначены ТОЛЬКО для серверного хостинга (например Render).

## Что загрузить в отдельный GitHub-репозиторий

- package.json
- server.js

## Секреты НЕ загружать в GitHub

На хостинге будут добавлены Environment Variables:

- BOT_TOKEN
- SUPABASE_URL
- SUPABASE_SECRET_KEY
- WEB_ORIGIN
- DEMO_MODE

Для Supabase используем современный серверный ключ вида `sb_secret_...`.
