# OLT Cards Backend Architecture Documentation

Dokumen ini menjelaskan arsitektur backend, alur data, integrasi SNMP, dan sistem keamanan yang bekerja pada menu **OLT Cards** (Card Management) di aplikasi **OptiProv**.

---

## 1. Alur API & Endpoint Utama

Saat halaman OLT Card dibuka di frontend (`components/olt-cards.tsx`), satu-satunya API backend yang dipanggil adalah:

*   **`GET /api/olt/cards`**
    *   **Query Parameter:** `refresh: bool` (default: `False`). Jika bernilai `True`, request akan membypass cache memori dan memaksa query langsung ke OLT.
    *   **Deskripsi:** Mengambil daftar card perangkat OLT aktif (Rack, Shelf, Slot, Tipe Card, Versi HW/SW, dan Status Operasional).

> [!NOTE]
> Operasi **"Add Card"** dan **"Delete Card"** pada UI saat ini hanya memanipulasi state lokal di sisi frontend (React State). Menu ini **tidak melakukan mutasi data (POST/PUT/DELETE)** ke backend, sehingga tidak memicu operasi SNMP SET atau perintah Telnet modifikasi ke hardware OLT fisik.

---

## 2. Keamanan & Autentikasi (Security Layer)

Endpoint `/api/olt/cards` dilindungi oleh lapisan keamanan berikut:
1.  **JWT Cookie Session Verification:** Menggunakan decorator `Depends(get_current_user)` untuk memvalidasi token JWT dari cookie `olt_session` milik operator yang sedang aktif.
2.  **Database Dependency:** Endpoint memverifikasi ketersediaan database PostgreSQL (`Depends(get_db)`) sebelum melakukan lookup data profil.

---

## 3. Resolusi Profil OLT

Sebelum melakukan koneksi SNMP, backend memproses request dengan langkah berikut:
1.  Mengambil OLT ID yang sedang aktif dari tabel `SystemSettings` (key: `"selected_olt_id"`).
2.  Melakukan lookup ke tabel `OLTProfileDB` untuk mencocokkan profile OLT (tipe `c300`, `c320`, atau `c600`).
3.  Mengekstrak alamat IP OLT (`in_band_ip`) dan string SNMP Community (`snmp_community`, fallback ke `"public"` jika kosong).

---

## 4. Lapisan Caching & Proteksi OLT (SingleFlight)

Untuk melindungi CPU OLT agar tidak kelebihan beban (*overload*) akibat request berulang dari banyak operator secara bersamaan:

*   **Memory Cache (`olt_card_cache`):** Hasil query SNMP disimpan di memori RAM backend dengan masa berlaku (TTL) **3600 detik (1 jam)**. Cache disimpan/dimuat secara otomatis melalui fungsi `save_cards_cache()`.
*   **SingleFlight (`_sf.do`):** Menggunakan key `f"cards:{ip}:{refresh}"`. Jika beberapa operator mengakses antarmuka OLT Cards secara bersamaan, backend hanya akan mengeksekusi **1 kali pemanggilan SNMP** ke OLT, lalu membagikan hasilnya secara paralel ke seluruh request yang sedang mengantre.

---

## 5. Integrasi SNMP (OIDs & Operasi)

Fungsi internal `_fetch_cards(...)` secara asinkron mengambil data inventaris card menggunakan library `pysnmp` 7.x.

### A. OID Mappings (MIB ZTE Modern 1082)

| Parameter | OID Key | Nilai OID | Deskripsi |
|---|---|---|---|
| **Card Index** | `olt_card_index` | `1.3.6.1.4.1.3902.1082.10.1.2.4.1.2` | Menentukan index fisik card |
| **Configured Type** | `olt_card_type` | `1.3.6.1.4.1.3902.1082.10.1.2.4.1.4` | Tipe card yang dikonfigurasi (e.g. GTGO, GTGH) |
| **Port Count** | `olt_card_port` | `1.3.6.1.4.1.3902.1082.10.1.2.4.1.7` | Jumlah port pada card tersebut |
| **Hardware Version** | `olt_card_hw_ver` | `1.3.6.1.4.1.3902.1082.10.1.2.4.1.23` | Versi hardware fisik card |
| **Operational Status** | `olt_card_status` | `1.3.6.1.4.1.3902.1082.10.1.2.4.1.5` | Status operasional card (dalam bentuk integer) |
| **Configuration Status** | `olt_card_cfg_status` | `1.3.6.1.4.1.3902.1082.10.1.2.4.1.13` | Status konfigurasi card |
| **Software Version (C3xx)** | `olt_card_sw_ver_c3xx` | `1.3.6.1.4.1.3902.1082.20.30.2.2.2.1.7` | Versi software card (Khusus untuk tipe OLT C300/C320) |

### B. Jenis Operasi SNMP Berdasarkan Tipe OLT

Backend mendeteksi tipe OLT secara dinamis untuk mengoptimalkan jenis request:
*   **ZTE C6xx:** Menggunakan operasi **`async_snmp_bulkwalk`** (bulkwalk asinkron, timeout 3 detik) untuk performa optimal.
*   **ZTE C3xx (C300/C320):** Menggunakan operasi **`async_snmp_walk`** (walk asinkron standar, timeout 3 detik).

### C. Mekanisme Rate Limiting (Breathing Room)
Untuk menghindari spike pada CPU OLT, pemanggilan walk/bulkwalk dari 6-7 OID di atas dilakukan secara sekuensial dengan memberikan jeda waktu istirahat bagi hardware:
```python
await asyncio.sleep(0.1)  # Jeda 100ms di antara setiap pemanggilan walk OID
```

### D. Pengolahan Data & Suffix Decoding

1.  **Decoding Suffix OID (`decode_card_index`)**:
    Suffix dari OID index di-decode oleh backend untuk mengekstrak letak fisik card:
    *   Format suffix: `rack.shelf.slot` (diambil dari 3 segmen angka terakhir dari suffix OID).
    *   *Contoh:* Suffix `.1.1.4` di-decode menjadi `rack=1`, `shelf=1`, `slot=4`.
2.  **Konversi Kode Status (`CARD_STATUS_MAP`)**:
    Nilai integer mentah dari status operasional card di-map ke string status berikut:
    *   `1` $\rightarrow$ `INSERVICE`
    *   `2` $\rightarrow$ `STANDBY`
    *   `3` $\rightarrow$ `OFFLINE`
    *   `4` $\rightarrow$ `CONFIGING`
    *   `5` $\rightarrow$ `TYPEMISMATCH`
    *   `6` $\rightarrow$ `HWONLINE`
    *   `7` $\rightarrow$ `DISABLE`
    *   `8` $\rightarrow$ `NOPOWER`
    *   `9` $\rightarrow$ `CONFIGFAILED`
3.  **Pengurutan (Sorting):**
    Data cards yang diperoleh diurutkan secara ascending berdasarkan `rack`, `shelf`, dan `slot` sebelum dikirimkan ke frontend.

---

## 6. Integrasi Telnet (Cek Status / Modifikasi)

*   **Tidak ada sistem Telnet** yang berjalan atau dipanggil secara aktif pada menu OLT Cards ini. Pengecekan data dan status card sepenuhnya mengandalkan SNMP Walk/Bulkwalk.
*   *Catatan:* Fungsi parser CLI Telnet `_parse_olt_cards` (yang memparsing output perintah `show card`) didefinisikan di dalam `backend/main.py` tetapi berstatus sebagai **dead code / legacy** dan tidak dipanggil di mana pun dalam kode aktif menu OLT Cards saat ini.
