# Arsitektur & Mekanisme Backend TCONT Profile Provisioning (OptiProv)

Dokumen ini menjelaskan secara rinci arsitektur backend, alur logika, pemetaan MIB/OID SNMP, mekanisme indexing suffix berbasis ASCII, concurrency locking, caching, serta analisis keamanan pada fitur manajemen **TCONT Profile** di sistem OptiProv.

---

## 1. Arsitektur Endpoint Backend (FastAPI Controller)

Fitur manajemen TCONT Profile dilayani oleh 4 endpoint utama di dalam file [`backend/main.py`](file:///c:/Users/hugop/Documents/Dokumentasi%20Web/OLT-WEB/backend/main.py):

| Method | Route Path | Handler Function | Deskripsi |
| :--- | :--- | :--- | :--- |
| **GET** | `/api/provisioning/tcont-profiles` | `get_tcont_profiles` | Mengambil daftar profil TCONT aktif dari cache/OLT. |
| **POST** | `/api/provisioning/tcont-profiles` | `create_tcont_profile` | Menambahkan profil TCONT baru pada OLT via SNMP. |
| **PUT** | `/api/provisioning/tcont-profiles` | `edit_tcont_profile` | Memperbarui parameter bandwidth profil TCONT. |
| **DELETE** | `/api/provisioning/tcont-profiles` | `delete_tcont_profiles` | Menghapus satu atau beberapa profil TCONT dari OLT. |

---

## 2. Pemetaan MIB & OID SNMP ZTE

Seluruh konfigurasi TCONT Profile disimpan pada tabel OLT ZTE di bawah root OID MIB berikut:  
**`1.3.6.1.4.1.3902.1082.500.10.2.1.2.1`**

### Suffix Indexing (ASCII Encoding)
Indeks baris tabel SNMP dibentuk secara dinamis menggunakan representasi desimal ASCII dari nama profil TCONT. Format suffix OID adalah:
`[panjang_nama].[char1_ascii].[char2_ascii]...`

*   **Contoh:** Nama profil `"TEST"`
    *   Panjang nama = `4`
    *   Karakter ASCII = `T (84)`, `E (69)`, `S (83)`, `T (84)`
    *   Index Suffix = **`4.84.69.83.84`**

Metode encoding ini ditangani di [`backend/snmp_manager.py`](file:///c:/Users/hugop/Documents/Dokumentasi%20Web/OLT-WEB/backend/snmp_manager.py) menggunakan fungsi `string_to_oid_suffix` dan didekode kembali menggunakan `decode_oid_ascii_suffix`.

### Struktur Kolom Tabel OID TCONT:
Setiap entri baris tabel TCONT Profile didefinisikan oleh kolom-kolom berikut:
*   **Fixed Bandwidth (FBW) - Kolom `.2`:** `1.3.6.1.4.1.3902.1082.500.10.2.1.2.1.2.[suffix]` (Tipe: Integer, dalam kbps)
*   **Assured Bandwidth (ABW) - Kolom `.3`:** `1.3.6.1.4.1.3902.1082.500.10.2.1.2.1.3.[suffix]` (Tipe: Integer, dalam kbps)
*   **Maximum Bandwidth (MBW) - Kolom `.4`:** `1.3.6.1.4.1.3902.1082.500.10.2.1.2.1.4.[suffix]` (Tipe: Integer, dalam kbps)
*   **Profile Type - Kolom `.5`:** `1.3.6.1.4.1.3902.1082.500.10.2.1.2.1.5.[suffix]` (Tipe: Integer, rentang 1-5)
*   **RowStatus - Kolom `.50`:** `1.3.6.1.4.1.3902.1082.500.10.2.1.2.1.50.[suffix]` (Tipe: Integer, `4` = createAndReady, `6` = destroy)

---

## 3. Alur Operasional Detail

### A. Operasi Get (Query Tabel)
1. Klien mengirim request `GET` ke `/api/provisioning/tcont-profiles`.
2. Backend memeriksa apakah cache memory `tcont_profile_cache` untuk IP OLT aktif masih valid (TTL: 1800 detik / 30 menit).
3. Jika cache tidak tersedia atau parameter `refresh=True` dikirim, backend memicu operasi **`SNMP BULK WALK`** pada root OID `1.3.6.1.4.1.3902.1082.500.10.2.1.2.1`.
4. Hasil walk berupa kamus OID dan nilai mentahnya di-parsing:
   - Mengambil bagian suffix setelah root OID.
   - Mendekode representasi desimal ASCII kembali menjadi string nama profil.
   - Memetakan nilainya ke parameter profil (fbw, abw, mbw, type) berdasarkan kolom OID-nya.
5. Data profil dikembalikan dalam bentuk list berurutan (sorting alfabetis nama profil) dan disimpan dalam cache.

### B. Operasi Create (Pembuatan Profil)
1. Klien mengirim payload `ProvisioningTcontProfileRequest` ke `POST` `/api/provisioning/tcont-profiles`.
2. Backend mengubah nama profil menjadi index suffix ASCII.
3. Menyiapkan daftar pasangan OID dan nilai yang akan dikirim dalam satu PDU SNMP SET (**`snmp_set_multi_ints`**):
   - Menetapkan Type di kolom `.5`
   - Menetapkan RowStatus di kolom `.50` ke nilai `4` (createAndReady)
   - Menambahkan parameter bandwidth yang sesuai dengan tipe profil:
     - **Type 1:** FBW (kolom `.2`)
     - **Type 2:** ABW (kolom `.3`)
     - **Type 3:** ABW (kolom `.3`) & MBW (kolom `.4`)
     - **Type 4:** MBW (kolom `.4`)
     - **Type 5:** FBW (kolom `.2`), ABW (kolom `.3`), & MBW (kolom `.4`)
4. Mengamankan eksekusi dengan `pause_monitoring()`.
5. Mengosongkan cache OLT agar daftar terbaru diambil kembali di pemanggilan berikutnya.

### C. Operasi Edit (Pembaruan Profil)
1. Klien mengirim request `PUT` ke `/api/provisioning/tcont-profiles`.
2. Backend menyiapkan PDU SNMP SET berisi Type dan limit bandwidth baru.
3. > [!IMPORTANT]
   > Pada operasi pembaruan (`PUT`), kolom `.50` (`RowStatus`) **sengaja tidak dikirimkan** untuk mencegah timbulnya kesalahan `inconsistentValue` dari sisi agen SNMP OLT ZTE.
4. Perubahan dikirim secara terpadu melalui `snmp_set_multi_ints`, monitoring dijeda sementara, dan cache dihapus.

### D. Operasi Delete (Penghapusan Profil)
1. Klien mengirim request `DELETE` ke `/api/provisioning/tcont-profiles` membawa daftar nama profil yang akan dihapus.
2. Untuk setiap profil, backend menerbitkan perintah **`SNMP SET`**:
   - Kolom RowStatus (`.50.[suffix]`) $\rightarrow$ diberi nilai `6` (destroy).
3. Eksekusi dilindungi `pause_monitoring()`, dan cache dibersihkan.

---

## 4. Mekanisme Concurrency & Caching

Untuk menjamin kestabilan CPU OLT yang cenderung single-threaded dan rentan overload, OptiProv menerapkan 3 taktik konkurensi:

1. **`pause_monitoring()` Context Manager**: Menjeda sementara proses polling status OLT background agar tidak bentrok dengan operasi SET SNMP penulisan data.
2. **SingleFlight Pattern (`_sf.do`)**: Mencegah fenomena cache stampede. Jika ada 10+ user memuat daftar TCONT profile secara bersamaan saat cache kosong, backend hanya akan memicu 1 SNMP Walk ke OLT. Request lainnya akan mengantre dan menerima data hasil walk yang sama.
3. **In-Memory TTL Caching**: Cache berdurasi 30 menit digunakan untuk meminimalkan beban query fisik ke hardware OLT, dengan penghapusan otomatis instan saat mutasi dilakukan.

---

## 5. Audit & Sistem Keamanan (JWT Session)

* **Autentikasi Cookie JWT**: Akses membaca daftar profil (`GET`) dibatasi ketat menggunakan dependency `Depends(get_current_user)` yang memeriksa keabsahan session token (`olt_session`) di dalam HttpOnly cookie.
* **Kerentanan Keamanan (JWT Auth Bypass)**: Audit keamanan mendeteksi bahwa endpoint mutasi (`POST`, `PUT`, `DELETE`) pada awalnya tidak menyertakan dependency `get_current_user` sehingga rentan dipicu tanpa otentikasi dari luar.
* **Solusi Perbaikan**: Dependency `Depends(get_current_user)` wajib ditambahkan di setiap handler mutasi tersebut untuk menutup celah bypass keamanan.
