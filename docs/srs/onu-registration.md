# SRS: Sistem Registrasi ONU (ZTE OLT)

Dokumen ini menjelaskan spesifikasi teknis bagaimana sistem OLT-WEB menangani registrasi ONU baru secara otomatis.

## 1. Alur Kerja (Workflow)

1.  **Detection**: Deteksi dilakukan secara **On-Demand** (Manual Refresh) melalui UI. Sistem memindai tabel unconfigured menggunakan tiga OID utama untuk ZTE C3xx:
    *   **Serial Number**: `.1.3.6.1.4.1.3902.1082.500.10.2.2.5.1.2`
    *   **Equipment ID (Model)**: `.1.3.6.1.4.1.3902.1082.500.10.2.2.5.1.7`
    *   **Software Version**: `.1.3.6.1.4.1.3902.1082.500.10.2.2.5.1.8`
2.  **UI Interaction**: User mengklik tombol **Regist** pada tabel Unregistered.
3.  **Priority Control**: Sistem memastikan tidak ada operasi SNMP berat yang berjalan untuk mencegah tabrakan Telnet.
4.  **Hardware Connection**: Membuka sesi Telnet ke In-Band IP OLT.
5.  **Provisioning**: Mengeksekusi perintah CLI untuk binding SN dan penetapan Tipe ONU.
6.  **State Transition**: ONU berpindah dari status `Unregistered` ke `Unconfigured` (Registered but no WAN/VLAN).

## 2. Logika ONU-ID (Gap Filling)

*   **Pengecekan**: Database `ConfiguredONU` digunakan sebagai sumber data ID yang sudah terpakai.
*   **Algoritma**: Mencari ID terkecil (1-128) yang belum terdaftar pada port PON yang sama.
*   **Manual Entry**: User tetap diberikan opsi untuk mengisi ID secara manual di UI.

## 3. Komponen Perintah CLI

```bash
conf t
interface gpon-olt_{rack}/{slot}/{port}
  onu {onu_id} type {type} sn {sn}
exit
```

---
**Status**: Final
**Last Updated**: 2026-05-14
