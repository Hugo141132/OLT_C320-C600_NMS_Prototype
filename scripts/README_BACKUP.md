# Panduan Automated Backup OLT-WEB

Folder ini berisi skrip PowerShell untuk melakukan backup database PostgreSQL secara otomatis. Karena saat ini log backend belum dikonfigurasikan untuk disimpan ke dalam file `.log`, skrip ini difokuskan pada backup database.

## Struktur File
1. `backup_olt.ps1` - Skrip utama yang mengeksekusi `pg_dump`, mengompres hasilnya ke dalam ZIP, dan menghapus file ZIP yang usianya lebih dari 7 hari.
2. `register_task.ps1` - Skrip *helper* yang secara otomatis mendaftarkan `backup_olt.ps1` ke **Windows Task Scheduler** agar berjalan setiap hari pada pukul 02:00 pagi.

## Cara Menggunakan

1. **Jalankan Skrip Registrasi**
   Buka **PowerShell** dengan *Run as Administrator*, navigasikan ke folder `scripts` ini, lalu jalankan:
   ```powershell
   .\register_task.ps1
   ```
   *Catatan: Pastikan Execution Policy mengizinkan Anda untuk menjalankan skrip (misalnya dengan menjalankan `Set-ExecutionPolicy RemoteSigned` jika diperlukan).*

2. **Cek Task Scheduler**
   - Buka **Task Scheduler** di Windows.
   - Di daftar *Task Scheduler Library*, cari task bernama **OLT-WEB-DailyBackup**.
   - Klik kanan dan pilih **Run** untuk menguji coba backup pertama kali.

3. **Cek Hasil Backup**
   - Buka folder `C:\OLT-WEB-Backups`.
   - Pastikan terdapat file `olt_db_[tanggal_waktu].zip` di dalamnya. File aslinya `.sql` akan dihapus secara otomatis untuk menghemat ruang.
