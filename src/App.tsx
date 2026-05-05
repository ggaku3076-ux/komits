/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  motion, 
  AnimatePresence 
} from 'motion/react';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  serverTimestamp, 
  doc, 
  getDocFromServer,
  onSnapshot,
  orderBy,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from 'firebase/auth';
import { 
  ShoppingBag, 
  ClipboardList, 
  Phone, 
  User as UserIcon, 
  MapPin, 
  CheckCircle2, 
  Upload, 
  Loader2, 
  LogOut,
  ChevronRight,
  Info,
  Shirt
} from 'lucide-react';
import { db, auth } from './lib/firebase';
import { Order, OrderStatus, OperationType } from './types';

// Error Handler
const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo.error;
};

const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || 'rehanalay9@gmail.com')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  const [ordersError, setOrdersError] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    address: '',
    size: 'M' as Order['size'],
    color: 'Hitam',
    quantity: 1,
    paymentProofUrl: ''
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && (error.message.includes('the client is offline') || error.message.includes('unavailable'))) {
          console.error("Firestore connectivity issue:", error);
          alert(`Gagal terhubung ke database. Pastikan Firestore sudah diaktifkan di Console Firebase untuk project ${import.meta.env.VITE_FIREBASE_PROJECT_ID || 'Firebase'} dan database ${(import.meta.env.VITE_FIRESTORE_DATABASE_ID || '(default)')}.`);
        }
      }
    };
    testConnection();

    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAdmin(u ? ADMIN_EMAILS.includes((u.email || '').toLowerCase()) : false);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setOrders([]);
      setOrdersError('');
      return;
    }

    const q = isAdmin
      ? query(collection(db, 'orders'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'orders'), where('userId', '==', user.uid));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Order[];
      if (!isAdmin) {
        ordersData.sort((a, b) => {
          const left = a.createdAt?.toMillis?.() || 0;
          const right = b.createdAt?.toMillis?.() || 0;
          return right - left;
        });
      }
      setOrders(ordersData);
      setOrdersError('');
    }, (error) => {
      const message = handleFirestoreError(error, OperationType.GET, 'orders');
      setOrdersError(`Data pesanan belum bisa dibaca: ${message}`);
    });

    return unsubscribe;
  }, [user, isAdmin]);

  const syncToSheet = async (orderData: Partial<Order> & { id?: string }) => {
    try {
      await fetch('/api/sync-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...orderData,
          updatedAt: new Date().toISOString() // Use ISO for Sheet
        })
      });
    } catch (error) {
      console.warn('Google Sheet sync failed:', error);
    }
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login error:', error);
      const firebaseError = error as { code?: string; message?: string };
      alert(`Login Google gagal: ${firebaseError.code || firebaseError.message || 'unknown_error'}`);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 800000) { // Keep it under 800KB for Firestore doc limit
        alert("Ukuran file terlalu besar. Maksimal 800KB.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, paymentProofUrl: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!formData.paymentProofUrl) {
      alert("Silakan upload bukti pembayaran");
      return;
    }

    setSubmitting(true);
    try {
      const orderData = {
        userId: user.uid,
        customerEmail: user.email,
        customerName: user.displayName,
        ...formData,
        status: OrderStatus.PENDING,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      const docRef = await addDoc(collection(db, 'orders'), orderData);
      
      // Sync to Sheet
      syncToSheet({ id: docRef.id, ...orderData });

      setSuccess(true);
      setSubmitMessage('Terimakasih sudah mengirim preorder. Data sudah masuk ke dashboard admin.');
      setFormData({
        name: '',
        phone: '',
        address: '',
        size: 'M',
        color: 'Hitam',
        quantity: 1,
        paymentProofUrl: ''
      });
      setTimeout(() => setSuccess(false), 7000);
    } catch (error) {
      const message = handleFirestoreError(error, OperationType.CREATE, 'orders');
      alert(`Preorder belum terkirim: ${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (orderId: string, newStatus: OrderStatus) => {
    if (!isAdmin) return;
    try {
      const orderRef = doc(db, 'orders', orderId);
      await updateDoc(orderRef, {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
      // Update local state for modal if open
      if (selectedOrder && selectedOrder.id === orderId) {
        setSelectedOrder({ ...selectedOrder, status: newStatus });
        syncToSheet({ ...selectedOrder, status: newStatus });
      } else {
        // Find order in list if not selected
        const order = orders.find(o => o.id === orderId);
        if (order) syncToSheet({ ...order, status: newStatus });
      }
    } catch (error) {
      const message = handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
      alert(`Status belum bisa diubah: ${message}`);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!isAdmin) return;
    if (!confirm('Apakah Anda yakin ingin menghapus pesanan ini?')) return;
    try {
      await deleteDoc(doc(db, 'orders', orderId));
      setSelectedOrder(null);
    } catch (error) {
      const message = handleFirestoreError(error, OperationType.DELETE, `orders/${orderId}`);
      alert(`Pesanan belum bisa dihapus: ${message}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F5F7FA]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F7FA] font-sans text-gray-900 pb-12">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <ShoppingBag className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">KOMITS 2025</h1>
          </div>
          
          {user ? (
            <div className="flex items-center gap-3">
              <div className="hidden sm:block text-right">
                <p className="text-xs font-medium text-gray-500">
                  Welcome {isAdmin && <span className="bg-red-100 text-red-600 px-1.5 py-0.5 rounded text-[10px] ml-1 uppercase font-bold">Admin</span>}
                </p>
                <p className="text-sm font-semibold">{user.displayName}</p>
              </div>
              <button 
                onClick={handleLogout}
                className="p-2 hover:bg-red-50 text-red-600 rounded-full transition-colors"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-full text-sm font-semibold transition-all flex items-center gap-2"
            >
              <UserIcon className="w-4 h-4" />
              Login with Google
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 pt-8">
        {/* Banner */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl p-8 mb-8 text-white relative overflow-hidden"
        >
          <div className="relative z-10">
            <p className="text-blue-100 font-mono text-xs uppercase tracking-widest mb-2">Exclusive Release</p>
            <h2 className="text-4xl font-extrabold mb-4 leading-tight">KOMITS 2025<br />Pre Order System</h2>
            <p className="text-blue-100 max-w-md opacity-90 leading-relaxed">
              Dapatkan kaos official KOMITS 2025 edisi terbatas. Pilih ukuran, warna favorit, dan miliki sekarang!
            </p>
          </div>
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
          <div className="absolute bottom-0 right-12 opacity-10">
            <Shirt size={200} />
          </div>
        </motion.div>

        {!user ? (
          <div className="text-center bg-white border border-gray-200 rounded-3xl p-12 shadow-sm">
            <div className="bg-blue-50 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Info className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Silakan Login Terlebih Dahulu</h3>
            <p className="text-gray-500 mb-8 max-w-sm mx-auto">
              Anda perlu login menggunakan akun Google Anda untuk melakukan preorder dan melihat status pesanan.
            </p>
            <button 
              onClick={handleLogin}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-2xl font-bold transition-all transform hover:scale-[1.02] active:scale-95 shadow-lg shadow-blue-200"
            >
              Mulai Sekarang
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-8">
            {/* Form Section */}
            <motion.section 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-sm">
                <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-blue-600" />
                  Form Preorder
                </h3>
                <div className="mb-5 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  Setelah dikirim, data tersimpan di database dan langsung tampil di dashboard admin.
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Nama Lengkap</label>
                    <input 
                      required
                      type="text"
                      className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-600 focus:bg-white outline-none transition-all"
                      placeholder="Contoh: Budi Santoso"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">No Telepon / WA</label>
                    <div className="relative">
                      <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input 
                        required
                        type="tel"
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl pl-11 pr-4 py-3 focus:ring-2 focus:ring-blue-600 focus:bg-white outline-none transition-all"
                        placeholder="081234567890"
                        value={formData.phone}
                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Alamat Pengiriman</label>
                    <div className="relative">
                      <MapPin className="absolute left-4 top-3 w-4 h-4 text-gray-400" />
                      <textarea 
                        required
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl pl-11 pr-4 py-3 focus:ring-2 focus:ring-blue-600 focus:bg-white outline-none transition-all min-h-[100px] resize-none"
                        placeholder="Tuliskan alamat lengkap pengiriman..."
                        value={formData.address}
                        onChange={e => setFormData({ ...formData, address: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Ukuran</label>
                      <select 
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-3 focus:ring-2 focus:ring-blue-600 focus:bg-white outline-none transition-all appearance-none"
                        value={formData.size}
                        onChange={e => setFormData({ ...formData, size: e.target.value as Order['size'] })}
                      >
                        {['S', 'M', 'L', 'XL', 'XXL', 'XXXL'].map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Warna</label>
                      <select 
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-3 focus:ring-2 focus:ring-blue-600 focus:bg-white outline-none transition-all appearance-none"
                        value={formData.color}
                        onChange={e => setFormData({ ...formData, color: e.target.value })}
                      >
                        {['Hitam', 'Putih', 'Navy', 'Maroon'].map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Jumlah</label>
                    <input 
                      type="number"
                      min="1"
                      max="100"
                      className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-600 focus:bg-white outline-none transition-all"
                      value={formData.quantity}
                      onChange={e => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Bukti Pembayaran</label>
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all hover:bg-gray-50 ${formData.paymentProofUrl ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}
                    >
                      {formData.paymentProofUrl ? (
                        <>
                          <CheckCircle2 className="w-8 h-8 text-green-500" />
                          <span className="text-xs font-bold text-green-600">Berhasil diupload</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 text-gray-300" />
                          <span className="text-xs font-medium text-gray-400">Klik untuk upload bukti</span>
                        </>
                      )}
                    </div>
                    <input 
                      type="file"
                      ref={fileInputRef}
                      hidden
                      accept="image/*"
                      onChange={handleFileUpload}
                    />
                  </div>

                  <button 
                    disabled={submitting}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-blue-100 mt-4 flex items-center justify-center gap-2"
                  >
                    {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Kirim Preorder Sekarang'}
                  </button>

                  <AnimatePresence>
                    {success && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="bg-green-50 text-green-700 p-4 rounded-xl text-center text-sm font-medium border border-green-100"
                      >
                        {submitMessage}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </form>
              </div>
            </motion.section>

            {/* Orders Tracking */}
            <motion.section 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-sm overflow-hidden">
                <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-blue-600" />
                  {isAdmin ? `Dashboard Admin (${orders.length})` : 'Pesanan Saya'}
                </h3>
                {isAdmin && (
                  <div className="mb-4 grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-orange-50 p-3 text-center">
                      <p className="text-[10px] font-bold uppercase text-orange-500">Pending</p>
                      <p className="text-lg font-black text-orange-700">{orders.filter(order => order.status === OrderStatus.PENDING).length}</p>
                    </div>
                    <div className="rounded-xl bg-green-50 p-3 text-center">
                      <p className="text-[10px] font-bold uppercase text-green-500">Verified</p>
                      <p className="text-lg font-black text-green-700">{orders.filter(order => order.status === OrderStatus.VERIFIED).length}</p>
                    </div>
                    <div className="rounded-xl bg-blue-50 p-3 text-center">
                      <p className="text-[10px] font-bold uppercase text-blue-500">Total</p>
                      <p className="text-lg font-black text-blue-700">{orders.length}</p>
                    </div>
                  </div>
                )}

                {ordersError && (
                  <div className="mb-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-700">
                    {ordersError}
                  </div>
                )}

                <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                  {orders.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-gray-400 text-sm italic">Belum ada pesanan.</p>
                    </div>
                  ) : (
                    orders.map((order, idx) => (
                      <motion.div 
                        key={order.id} 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        onClick={() => setSelectedOrder(order)}
                        className="border border-gray-100 rounded-2xl p-4 bg-gray-50/50 hover:bg-white hover:border-blue-100 hover:shadow-md transition-all group cursor-pointer"
                      >
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Order ID: {order.id?.slice(-6).toUpperCase()}</p>
                            <h4 className="font-bold text-gray-800">{order.size} - {order.color}</h4>
                            {isAdmin && <p className="text-xs text-gray-500">{order.customerEmail || order.name}</p>}
                          </div>
                          <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded-lg flex items-center gap-1 ${
                            order.status === OrderStatus.PENDING ? 'bg-orange-100 text-orange-600' :
                            order.status === OrderStatus.VERIFIED ? 'bg-green-600 text-white shadow-sm shadow-green-100' :
                            'bg-blue-600 text-white'
                          }`}>
                            {order.status === OrderStatus.VERIFIED && <CheckCircle2 className="w-2.5 h-2.5" />}
                            {order.status}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div className="bg-white/50 p-2 rounded-lg">
                            <p className="text-[10px] text-gray-400 uppercase font-bold">Jumlah</p>
                            <p className="text-sm font-bold text-gray-600">{order.quantity} pcs</p>
                          </div>
                          <div className="bg-white/50 p-2 rounded-lg">
                            <p className="text-[10px] text-gray-400 uppercase font-bold">Pemesan</p>
                            <p className="text-sm font-bold text-gray-600 truncate">{order.name}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <MapPin className="w-3 h-3" />
                          <span className="truncate">{order.address}</span>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              </div>

              {/* Info Card */}
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex gap-3 text-amber-800">
                <Info className="w-5 h-5 shrink-0" />
                <div>
                  <p className="text-sm font-bold mb-1">Informasi Pembayaran</p>
                  <p className="text-xs leading-relaxed opacity-80">
                    Silakan transfer ke rekening <strong>Bank ABC 123456789 a.n. KOMITS</strong>. 
                    Upload bukti transfer pada form di samping untuk verifikasi.
                  </p>
                </div>
              </div>
            </motion.section>
          </div>
        )}
      </main>

      {/* Order Detail Modal */}
      <AnimatePresence>
        {selectedOrder && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedOrder(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-xl">Detail Pesanan</h3>
                  <p className="text-xs text-gray-400 font-mono">ID: {selectedOrder.id}</p>
                </div>
                <button 
                  onClick={() => setSelectedOrder(null)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <LogOut className="w-5 h-5 rotate-180" />
                </button>
              </div>

              <div className="p-6 max-h-[80vh] overflow-y-auto custom-scrollbar space-y-6">
                {/* Status Section */}
                <div className="flex flex-col gap-4 bg-gray-50 p-4 rounded-2xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Status Pesanan</p>
                      <p className="font-bold text-blue-600 capitalize">{selectedOrder.status}</p>
                    </div>
                    <div className={`p-3 rounded-xl ${
                      selectedOrder.status === OrderStatus.VERIFIED ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'
                    }`}>
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="pt-4 border-t border-gray-200">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 text-center">Admin Controls: Update Status</p>
                      <div className="flex flex-wrap gap-2 justify-center">
                        {[OrderStatus.PENDING, OrderStatus.VERIFIED, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.COMPLETED].map((status) => (
                          <button
                            key={status}
                            onClick={() => handleUpdateStatus(selectedOrder.id!, status)}
                            disabled={selectedOrder.status === status}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                              selectedOrder.status === status 
                                ? 'bg-blue-600 text-white cursor-default' 
                                : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300'
                            }`}
                          >
                            {status.toUpperCase()}
                          </button>
                        ))}
                      </div>
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <button
                          onClick={() => handleDeleteOrder(selectedOrder.id!)}
                          className="w-full py-2 rounded-xl text-xs font-bold text-red-600 hover:bg-red-50 transition-colors border border-red-100"
                        >
                          Hapus Pesanan (Admin Only)
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Items Section */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Informasi Produk</h4>
                  <div className="flex items-center gap-4 bg-white border border-gray-100 p-4 rounded-2xl">
                    <div className="bg-blue-50 p-3 rounded-xl">
                      <Shirt className="w-8 h-8 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-bold text-lg">Kaos KOMITS 2025</p>
                      <p className="text-sm text-gray-500">{selectedOrder.size} • {selectedOrder.color} • {selectedOrder.quantity} pcs</p>
                    </div>
                  </div>
                </div>

                {/* Delivery Section */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Alamat Pengiriman</h4>
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <UserIcon className="w-4 h-4 text-gray-400 shrink-0 mt-1" />
                      <div>
                        <p className="text-xs font-bold text-gray-400">Penerima</p>
                        <p className="text-sm font-medium">{selectedOrder.name}</p>
                        {isAdmin && selectedOrder.customerEmail && (
                          <p className="text-xs text-gray-500">{selectedOrder.customerEmail}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Phone className="w-4 h-4 text-gray-400 shrink-0 mt-1" />
                      <div>
                        <p className="text-xs font-bold text-gray-400">Telepon</p>
                        <p className="text-sm font-medium">{selectedOrder.phone}</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <MapPin className="w-4 h-4 text-gray-400 shrink-0 mt-1" />
                      <div>
                        <p className="text-xs font-bold text-gray-400">Alamat</p>
                        <p className="text-sm font-medium leading-relaxed">{selectedOrder.address}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Payment Proof Section */}
                <div className="space-y-4 pb-4">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Bukti Pembayaran</h4>
                  <div className="rounded-2xl overflow-hidden border border-gray-100 bg-gray-50">
                    <img 
                      src={selectedOrder.paymentProofUrl} 
                      alt="Payment Proof" 
                      className="w-full h-auto object-contain max-h-[300px]"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
