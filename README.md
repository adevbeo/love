# love.api

Backend starter cho `Nha Cua Hai Dua`, bám theo handoff backend cho auth, `app-content`, `couple-space`, media upload và email outbox.

Repo này ưu tiên một nền chạy được ngay với Node 24+ native TypeScript + `node:sqlite`, để đội backend có thể bắt tay vào triển khai mà không cần scaffold thêm framework trước. Contract API và dữ liệu được giữ ổn định để có thể chuyển sang Next.js route handlers sau nếu muốn.

## Yêu cầu runtime

- Node `>= 24`
- Không cần cài package ngoài cho bản starter hiện tại

## Khởi động nhanh

```bash
cp .env.example .env
npm run seed:app-content
npm run dev
```

Worker email mẫu:

```bash
npm run email:work
```

Test tích hợp:

```bash
npm test
```

## Tài liệu

- [docs/required-apis.md](docs/required-apis.md)
- [docs/backend-handoff.md](docs/backend-handoff.md)
- [docs/openapi.yaml](docs/openapi.yaml)
- [docs/postman/love.api.postman_collection.json](docs/postman/love.api.postman_collection.json)
- [docs/postman/love.api.local.postman_environment.json](docs/postman/love.api.local.postman_environment.json)

## Postman

Import 2 file sau vao Postman:

- `docs/postman/love.api.postman_collection.json`
- `docs/postman/love.api.local.postman_environment.json`

Flow dung nhanh:

1. `Health`
2. `Get App Content`
3. `Auth / Register Couple`
4. chay `npm run email:work`, copy temp password vao bien Postman `tempPassword`
5. `Auth / Login With Temp Password`
6. `Auth / Complete Password Change`
7. `Couple Space / Get` va `Put`
8. `Media / Upload Image` hoac `Upload Audio`

Luu y:

- Request upload file co the can chon lai file bang tay trong Postman sau khi import.
- `tempPassword` khong duoc expose qua API; hien tai phai lay tu output cua email worker.

## Kiến trúc hiện tại

- Auth dùng access token JWT HS256 + refresh token JWT HS256, refresh token vẫn được lưu hash server-side để revoke/rotate.
- SQLite là source of truth cho account cặp đôi, 2 member login, snapshot, app content, media metadata, refresh tokens, email outbox, audit log.
- Upload file ghi trực tiếp vào `storage/uploads`, sau đó trả URL public tại `/uploads/...`.
- Email hiện được đưa vào `email_jobs`; worker `npm run email:work` là điểm tích hợp để nối Resend/SMTP/Ses sau này.

## Thư mục chính

- `src/app.ts`: HTTP server + route handlers
- `src/db.ts`: schema access + repository methods
- `src/crypto.ts`: argon2 password hashing, JWT signing/verify
- `db/schema.sql`: schema SQLite
- `scripts/seed-app-content.ts`: seed `app_content`
- `scripts/process-email-jobs.ts`: worker email mẫu
- `tests/api.test.ts`: integration tests theo flow sản phẩm

## Ghi chú production

- `MAIL_PROVIDER=queued` chỉ phù hợp dev/staging nội bộ.
- `node:sqlite` hiện vẫn là module core experimental.
- Khi deploy lên Vercel Functions, SQLite và upload mặc định sẽ rơi vào `/tmp`, nên chỉ phù hợp demo hoặc preview vì dữ liệu không bền vững qua cold start/scale.
- Nếu triển khai public thật, cần thay worker email mẫu bằng provider thật, thêm persistent rate limit, logging/metrics và backup cho thư mục upload.
