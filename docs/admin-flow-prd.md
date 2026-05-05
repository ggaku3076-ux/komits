# PRD Admin Preorder KOMITS 2025

## Tujuan
Membuat alur preorder yang jelas: klien mengirim data dan bukti pembayaran, data masuk ke dashboard admin, admin memverifikasi order, menghubungi klien lewat WhatsApp, dan melihat statistik penjualan serta total pendapatan berdasarkan harga produk.

## Peran Pengguna
- Klien: login Google, isi preorder, upload bukti pembayaran, melihat riwayat/status pesanan.
- Admin: login Google memakai email admin, melihat semua pesanan, melihat bukti pembayaran, mengubah status, mengirim WhatsApp ke klien, mengelola produk/stok, melihat statistik pendapatan.

## Alur Klien
1. Klien login dengan Google.
2. Klien memilih produk, ukuran, warna, jumlah, mengisi nama, nomor WhatsApp, alamat, dan bukti pembayaran.
3. Bukti pembayaran dikompres otomatis di browser agar aman disimpan di Firestore.
4. Sistem membuat dokumen order dengan status awal `pending`.
5. Klien melihat pesan sukses dan order muncul di riwayat klien.

## Alur Admin
1. Admin login dengan email yang terdaftar sebagai admin.
2. Tab default admin adalah `PESANAN`, bukan form preorder.
3. Admin melihat daftar semua order terbaru.
4. Admin membuka detail order untuk melihat data klien, produk, total item, alamat, nomor WhatsApp, dan bukti pembayaran.
5. Admin mengubah status order:
   - `pending`: menunggu verifikasi.
   - `verified`: pembayaran valid.
   - `processing`: barang sedang diproses/dibuat.
   - `shipped`: barang dikirim.
   - `completed`: pesanan selesai.
6. Admin bisa klik `Kirim WA ke Pemesan` untuk memberi kabar status ke nomor WhatsApp klien.
7. Admin bisa broadcast WA ke semua order jika dibutuhkan.

## Statistik Admin
- Total pendapatan dihitung dari order non-`pending`.
- Pendapatan per order = harga produk x jumlah.
- Jika belum ada produk aktif, klien tidak bisa memilih produk sampai admin menambahkan produk.
- Statistik menampilkan jumlah pending, verified/completed, status order, dan popularitas warna.

## Manajemen Produk
- Admin bisa menambah/mengubah/menghapus produk.
- Produk memiliki nama, deskripsi, harga, gambar dari upload file, ukuran, warna, dan status aktif.
- Harga produk digunakan untuk perhitungan pendapatan.

## Kriteria Sukses
- Admin tidak masuk ke form preorder ketika membuka tab `PESANAN`.
- Order klien masuk dan bisa dibuka admin.
- Bukti pembayaran tampil di detail order admin.
- Admin bisa mengirim WhatsApp berdasarkan nomor yang diisi klien.
- Total pendapatan berubah sesuai harga produk dan jumlah order yang sudah diverifikasi/diproses/dikirim/selesai.
