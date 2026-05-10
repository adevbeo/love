# Required APIs

## Auth

| Method | Path | Auth | Ghi chú |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register-couple` | No | Tạo couple account với 2 email, queue email mật khẩu tạm |
| `POST` | `/api/auth/login` | No | Login bằng email + password |
| `POST` | `/api/auth/refresh` | No | Rotate access/refresh token |
| `POST` | `/api/auth/request-reset` | No | Trả message generic, không lộ email tồn tại |
| `POST` | `/api/auth/complete-password-change` | Access token | Đổi mật khẩu sau first login hoặc reset |

## App content

| Method | Path | Auth | Ghi chú |
| --- | --- | --- | --- |
| `GET` | `/api/app-content` | No | Source of truth cho catalog động của app |

## Couple space

| Method | Path | Auth | Ghi chú |
| --- | --- | --- | --- |
| `GET` | `/api/couple-space` | Access token | Trả `snapshot: null` nếu chưa có dữ liệu |
| `PUT` | `/api/couple-space` | Access token | Ghi đè toàn bộ snapshot, `last write wins` |

## Media

| Method | Path | Auth | Ghi chú |
| --- | --- | --- | --- |
| `POST` | `/api/media/upload` | Access token | Multipart upload `kind=image|audio`, trả metadata + URL |
| `GET` | `/uploads/{storageKey}` | No | Static file route cho asset đã upload |

## Health

| Method | Path | Auth | Ghi chú |
| --- | --- | --- | --- |
| `GET` | `/api/health` | No | Smoke check service |

## Business rules khóa

- Mỗi couple account luôn có đúng `2` email login.
- `requiresPasswordChange=true` chặn truy cập `couple-space` và `media` cho đến khi đổi mật khẩu xong.
- `app-content` là source of truth cho catalog động; không được để rỗng trên môi trường chạy app.
- `couple-space` là full snapshot write, không patch nhỏ, không merge diff ở phase hiện tại.
- Media binary không đi vào snapshot; snapshot chỉ giữ URL/metadata tham chiếu.
