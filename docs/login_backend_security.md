# 🔒 PENJELASAN BACKEND & KEAMANAN MENU LOGIN — OPTIPROV

Dokumen ini menjelaskan secara rinci sistem keamanan dan alur kerja *backend* FastAPI yang menangani menu login pada aplikasi **OptiProv**.

---

## 1. Layer Pengendali Kecepatan Akses (Rate Limiting)
Sebelum request masuk ke logika autentikasi, FastAPI menerapkan penyaringan laju akses menggunakan pustaka `slowapi`.

### Pendeteksian IP Asli (Proxy-Aware IP Extraction)
Karena aplikasi dideploy di balik *reverse proxy* (Cloudflare/Next.js Proxy), `slowapi` secara default akan membaca IP dari kontainer frontend (`172.19.0.x`). Jika dibiarkan, percobaan login gagal oleh satu user akan memblokir seluruh pengguna di jaringan. Backend mengatasi ini dengan fungsi `get_client_ip(request)` pada [main.py:L83-91](file:///c:/Users/hugop/Documents/Dokumentasi%20Web/OLT-WEB/backend/main.py#L83-L91):

```python
def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip() # IP asli client
    return request.client.host
```

### Rate Limit Threshold
Endpoint `/api/auth/login` dibatasi maksimal **5 kali percobaan per menit** (`@limiter.limit("5/minute")`).

### Penanganan HTTP 429
Jika batas terlampaui, `custom_rate_limit_exceeded_handler` memotong request dan mengembalikan respons `HTTP 429 Too Many Requests` dengan format JSON `{"detail": "Wait:retry_after"}` agar frontend dapat menampilkan hitung mundur (*countdown*) secara visual.

---

## 2. Validasi Skema Request (Pydantic Layer)
Data JSON yang dikirimkan oleh frontend (Next.js) harus lolos validasi tipe data di FastAPI sebelum diproses oleh database.

Request dipetakan ke kelas `LoginRequest` pada [main.py:L937-939](file:///c:/Users/hugop/Documents/Dokumentasi%20Web/OLT-WEB/backend/main.py#L937-L939):

```python
class LoginRequest(BaseModel):
    username: str
    password: str
```

Jika payload tidak lengkap atau berformat salah, FastAPI secara otomatis langsung melempar error `HTTP 422 Unprocessable Entity` tanpa membebani database PostgreSQL.

---

## 3. Basis Data & Autentikasi Pengguna (Database & Verification Layer)
Ketika skema valid, backend membuka koneksi sesi database PostgreSQL via SQLAlchemy *dependency injection* (`Depends(get_db)`).

### User Lookup
Sistem mengecek data pada tabel `users` berdasarkan input `username`:

```python
user = db.query(User).filter(User.username == req.username).first()
```

### Password Hashing & Verification (Bcrypt)
Password tidak disimpan dalam bentuk teks biasa. Algoritma **Bcrypt** digunakan melalui `passlib.context.CryptContext` pada [security_utils.py:L13](file:///c:/Users/hugop/Documents/Dokumentasi%20Web/OLT-WEB/backend/security_utils.py#L13). Sistem memanggil fungsi berikut untuk mencocokkan password:

```python
def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)
```

Bcrypt menggunakan metode *adaptive hashing* yang lambat secara sengaja (*work factor*) ditambah *salt* acak untuk mencegah serangan *brute-force* berbasis GPU dan *Rainbow Table*.

### Mekanisme Self-Healing (Database Seeding)
Saat startup aplikasi (`lifespan`), backend mendeteksi apakah tabel `users` kosong. Jika kosong, sistem otomatis melakukan seeding user bawaan secara aman pada [main.py:L802-825](file:///c:/Users/hugop/Documents/Dokumentasi%20Web/OLT-WEB/backend/main.py#L802-L825):
*   `falcom` dengan password `falcom180` (sebagai admin).
*   `guest` dengan password `guest123` (sebagai guest / read-only).

### Pencegahan User Enumeration
Jika username tidak ditemukan atau password salah, backend melempar exception seragam: `raise HTTPException(status_code=401, detail="Invalid username or password")`. Ini mencegah penyerang mengetahui apakah suatu username terdaftar atau tidak di sistem.

---

## 4. Manajemen Sesi berbasis HMAC-SHA256 Token
Setelah kredensial valid, backend tidak menggunakan JWT standar eksternal, melainkan mekanisme internal *Signed Session Token* berbasis **HMAC-SHA256** untuk meningkatkan performa dan fleksibilitas *revocation* (pencabutan sesi).

### Konstruksi Payload
Sesi diikat dengan metadata berupa `username`, `role`, `session_version`, dan waktu kedalwarsa (`expiry` = 4 jam dari waktu login).

### Dynamic Secret Key
Secret key untuk tanda tangan digital (*signature*) diambil secara dinamis dari tabel `SystemSettings` (menggunakan key `fernet_key`). Kunci ini digenerate acak sekali saat inisiasi database pertama kali menggunakan pustaka kriptografi `Fernet` pada [security_utils.py:L22-34](file:///c:/Users/hugop/Documents/Dokumentasi%20Web/OLT-WEB/backend/security_utils.py#L22-L34).

### Token Sign & Encode
```python
payload = f"{username}|{role}|{session_version}|{expiry}"
signature = hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()
full_data = f"{payload}.{signature}"
token = base64.b64encode(full_data.encode()).decode()
```

### Pencabutan Sesi Seketika (Token Revocation via session_version)
Keunggulan metode ini adalah integrasi `session_version` pada payload. Jika Administrator melakukan reset password pada pengguna tersebut di menu manajemen user, nilai `session_version` di database dinaikkan sebesar $+1$. Ketika user dengan token lama mencoba mengakses API, token tersebut langsung ditolak karena ada ketidakcocokan versi (*session_version mismatch*), meskipun masa kedaluwarsa token 4 jam tersebut belum habis.

---

## 5. Pengamanan Cookie (Secure Session Delivery)
Token sesi yang dihasilkan dikirimkan kembali ke browser pengguna dalam bentuk cookie HTTP response dengan atribut keamanan tinggi pada [main.py:L975-983](file:///c:/Users/hugop/Documents/Dokumentasi%20Web/OLT-WEB/backend/main.py#L975-L983):

```python
response.set_cookie(
    key="olt_session",
    value=token,
    httponly=True,  # Proteksi XSS
    samesite="lax", # Proteksi CSRF
    secure=False,   # Diatur False untuk deployment lokal HTTP, namun diamankan SSL Cloudflare di Produksi
    max_age=86400   # Masa berlaku cookie di browser (24 Jam)
)
```

*   **HttpOnly=True:** Mencegah skrip JavaScript (seperti serangan *Cross-Site Scripting* / XSS) mengakses cookie ini melalui `document.cookie`. Ini adalah perlindungan utama dari pencurian sesi.
*   **SameSite=Lax:** Mencegah pengiriman cookie pada request lintas situs (*cross-site request*), secara efektif memitigasi serangan *Cross-Site Request Forgery* (CSRF).

---

## 6. Pengikatan IP Administratif (IP Audit Logging)
Sebagai langkah audit terakhir setelah login sukses, backend mencatat IP administratif terakhir yang berhasil login ke dalam tabel pengaturan database:

```python
_set_db_setting(db, "last_admin_ip", client_ip)
```

Hal ini memastikan administrator jaringan dapat memantau IP mana saja yang sedang mengoperasikan sistem OptiProv secara real-time.
