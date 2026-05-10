# Backend Handoff

## Mục tiêu

Backend là source of truth cho:

- couple account
- 2 member email thuộc cùng couple
- password hash
- session / refresh token
- `requiresPasswordChange`
- app content catalog
- couple snapshot
- media upload
- email outbox / audit log

## Quy tắc nghiệp vụ cốt lõi

- Không dùng room code hay join code.
- Mỗi couple có đúng 2 account email để login.
- First login và reset password luôn buộc `requiresPasswordChange = true`.
- `GET /api/app-content` là contract chính thức của app, không phải config phụ.
- `PUT /api/couple-space` hiện dùng cơ chế full snapshot overwrite với `last write wins`.
- Binary media phải upload riêng; snapshot chỉ chứa URL trỏ tới asset.

## Mapping implementation trong repo

- `couple_accounts`: thông tin cặp đôi
- `couple_members`: từng email login độc lập
- `refresh_tokens`: refresh JWT hash + revoke state
- `couple_snapshots`: snapshot JSON của cả cặp
- `app_content`: catalog active duy nhất
- `media_assets`: metadata file đã upload
- `email_jobs`: outbox để worker gửi mail
- `audit_logs`: dấu vết register, login fail, reset, upload, save snapshot

Schema vật lý nằm tại [db/schema.sql](../db/schema.sql).

## Auth model

- Access token:
  - HS256 JWT
  - claims: `sub`, `coupleId`, `email`, `type=access`
- Refresh token:
  - HS256 JWT
  - có `jti`
  - vẫn được lưu `sha256(token)` trong DB để revoke/rotate
- Middleware auth:
  - verify JWT
  - load member + couple
  - chặn account disabled
  - chặn endpoint dữ liệu khi `requiresPasswordChange=true`

## Email flow

- Register và reset password không gửi mail inline ngay trong HTTP handler.
- Handler tạo record vào `email_jobs`.
- Worker mẫu tại [scripts/process-email-jobs.ts](../scripts/process-email-jobs.ts).
- `MAIL_PROVIDER=queued` hoặc `log` chỉ là placeholder dev; production cần nối provider thật.

## App content

- Seed mặc định nằm trong `src/domain.ts` dưới `DEFAULT_APP_CONTENT`.
- Script seed: [scripts/seed-app-content.ts](../scripts/seed-app-content.ts)
- Validation khóa các enum:
  - `homeFeatures.route`
  - `artworkOptions`
  - `secretReactions.id`
  - `galleryStageOptions.value`

## Couple snapshot

- `GET /api/couple-space` trả `snapshot: null` với account mới.
- `PUT /api/couple-space` nhận full object `snapshot`.
- Server tự ghi `updatedAt`, `updatedByMemberId`, `revision`.
- Chưa bật optimistic lock ở phase này.

## Media

- Upload nhận `multipart/form-data`
- `kind=image|audio`
- image mime:
  - `image/jpeg`
  - `image/png`
  - `image/webp`
- audio mime:
  - `audio/m4a`
  - `audio/mp4`
  - `audio/aac`
  - `audio/mpeg`
- File được lưu vào `storage/uploads/couple/{coupleId}/{kind}/...`

## Checklist hiện repo đã có

- schema DB rõ ràng
- seed `app_content`
- auth endpoints
- `app-content`
- `couple-space`
- media upload
- email outbox worker mẫu
- `.env.example`
- OpenAPI
- integration tests cho flow chính

## Việc production còn cần làm

- thay worker email mẫu bằng provider thật
- thêm rate limit phân tán nếu chạy nhiều instance
- thêm log/metrics/error tracking tập trung
- chiến lược backup cho SQLite và upload storage
- signed URL nếu cần siết riêng tư media
