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
  Shirt,
  Send,
  FileDown,
  Printer,
  Download,
  Search,
  LayoutDashboard,
  BarChart3,
  PieChart as PieChartIcon,
  TrendingUp,
  AlertTriangle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  Legend
} from 'recharts';
import { db, auth } from './lib/firebase';
import { Order, OrderStatus, OperationType, Product } from './types';

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

const DEFAULT_PRODUCT: Product = {
  id: 'default-komits-2025-shirt',
  name: 'Kaos KOMITS 2025',
  description: 'Kaos official KOMITS 2025 edisi preorder.',
  price: 100000,
  imageUrl: '',
  availableSizes: ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
  availableColors: ['Hitam', 'Putih', 'Navy', 'Maroon'],
  isActive: true,
  createdAt: null,
};

const MAX_PAYMENT_PROOF_STORED_CHARS = 850_000;

const compressPaymentProofToDataUrl = (file: File) => {
  if (!file.type.startsWith('image/')) {
    return Promise.reject(new Error('File bukti pembayaran harus berupa gambar JPG, PNG, atau format gambar lain yang didukung browser.'));
  }

  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    let maxDimension = 1600;
    let quality = file.size > 5 * 1024 * 1024 ? 0.72 : 0.82;

    const renderCompressedImage = () => {
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));

      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Browser tidak bisa memproses gambar ini. Coba gunakan JPG atau PNG.'));
        return;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);

      if (dataUrl.length <= MAX_PAYMENT_PROOF_STORED_CHARS) {
        resolve(dataUrl);
        return;
      }

      if (quality > 0.45) {
        quality = Math.max(0.45, quality - 0.1);
        renderCompressedImage();
        return;
      }

      if (maxDimension > 720) {
        maxDimension = Math.max(720, Math.floor(maxDimension * 0.75));
        quality = 0.72;
        renderCompressedImage();
        return;
      }

      reject(new Error('Bukti pembayaran tetap terlalu besar setelah dikompres. Coba crop bagian bukti transfer saja.'));
    };

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      renderCompressedImage();
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Format gambar tidak bisa dibaca browser. Coba upload JPG atau PNG.'));
    };

    image.src = objectUrl;
  });
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [stockLimits, setStockLimits] = useState<Record<string, number>>({});
  const [stockUsed, setStockUsed] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [editingStock, setEditingStock] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  const [ordersError, setOrdersError] = useState('');
  const [waSending, setWaSending] = useState(false);
  const [waMessage, setWaMessage] = useState('');
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [submitStatus, setSubmitStatus] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [activeTab, setActiveTab] = useState<'preorder' | 'history' | 'stats' | 'products'>('preorder');
  const [activeAdminTab, setActiveAdminTab] = useState<'orders' | 'stats' | 'products'>('orders');

  // Product Form State
  const [productFormData, setProductFormData] = useState({
    name: '',
    description: '',
    price: 0,
    imageUrl: '',
    availableSizes: 'S,M,L,XL,XXL,XXXL',
    availableColors: 'Hitam,Putih,Navy,Maroon',
    isActive: true
  });

  // Search State
  const [searchPhone, setSearchPhone] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

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
  const activeProducts = products.filter(p => p.isActive || isAdmin);
  const preorderProducts = activeProducts.length > 0 ? activeProducts : [DEFAULT_PRODUCT];
  const currentProduct = preorderProducts.find(p => p.id === selectedProductId) || preorderProducts[0];

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

    const unsubscribeStock = onSnapshot(doc(db, 'settings', 'stock'), (snapshot) => {
      if (snapshot.exists()) {
        setStockLimits(snapshot.data().stockLimits);
      }
    });

    const unsubscribeProducts = onSnapshot(collection(db, 'products'), (snapshot) => {
      const productsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Product[];
      setProducts(productsData);
      if (productsData.length > 0 && !selectedProductId) {
        setSelectedProductId(productsData[0].id!);
      } else if (productsData.length === 0 && !selectedProductId) {
        setSelectedProductId(DEFAULT_PRODUCT.id!);
      }
    });

    return () => {
      unsubscribe();
      unsubscribeStock();
      unsubscribeProducts();
    };
  }, [user, isAdmin]);

  useEffect(() => {
    const usage = orders.reduce((acc, order) => {
      const key = `${order.productId}_${order.size}`;
      acc[key] = (acc[key] || 0) + order.quantity;
      return acc;
    }, {} as Record<string, number>);
    
    setStockUsed(usage);
  }, [orders]);

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

  const getAdminAuthHeaders = async () => {
    const token = await auth.currentUser?.getIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const getWhatsAppResultMessage = (summary: { sent?: number; mocked?: number; skipped?: number; failed?: number; reason?: string; requestId?: string | number }) => {
    const delivered = (summary.sent || 0) + (summary.mocked || 0);
    const mode = summary.mocked ? 'mode mock, belum benar-benar terkirim karena WHATSAPP_API_KEY belum diisi' : 'terkirim';
    const detail = summary.reason ? ` Info: ${summary.reason}.` : '';
    const request = summary.requestId ? ` Request ID: ${summary.requestId}.` : '';
    return `WhatsApp selesai: ${delivered} ${mode}, ${summary.skipped || 0} dilewati, ${summary.failed || 0} gagal.${detail}${request}`;
  };

  const readApiResponse = async (response: Response) => {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`API tidak mengembalikan JSON. Status ${response.status}. Pastikan endpoint Vercel /api sudah terdeploy.`);
    }
  };

  const handleSendOrderWhatsApp = async (order: Order) => {
    if (!isAdmin) return;
    setWaSending(true);
    setWaMessage('');
    try {
      const response = await fetch('/api/notify-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAdminAuthHeaders()),
        },
        body: JSON.stringify({
          orderId: order.id,
          phone: order.phone,
          name: order.name,
          status: order.status,
        }),
      });
      const result = await readApiResponse(response);
      if (!response.ok) throw new Error(result.error || 'WhatsApp gagal dikirim');
      setWaMessage(getWhatsAppResultMessage({
        sent: result.status === 'sent' ? 1 : 0,
        mocked: result.status === 'mocked' ? 1 : 0,
        skipped: result.status === 'skipped' ? 1 : 0,
        failed: result.status === 'failed' ? 1 : 0,
        reason: result.reason,
        requestId: result.requestId,
      }));
    } catch (error) {
      setWaMessage(`WhatsApp gagal: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setWaSending(false);
    }
  };

  const handleBroadcastWhatsApp = async () => {
    if (!isAdmin) return;
    if (!orders.length) {
      setWaMessage('Belum ada order untuk dikirim WhatsApp.');
      return;
    }
    if (!confirm(`Kirim pesan WhatsApp ke ${orders.length} order? Nomor kosong/tidak valid akan dilewati.`)) return;

    setWaSending(true);
    setWaMessage('');
    try {
      const response = await fetch('/api/broadcast-wa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAdminAuthHeaders()),
        },
        body: JSON.stringify({
          orders: orders.map((order) => ({
            id: order.id,
            phone: order.phone,
            name: order.name,
            status: order.status,
          })),
        }),
      });
      const result = await readApiResponse(response);
      if (!response.ok) throw new Error(result.error || 'Broadcast WhatsApp gagal');
      setWaMessage(getWhatsAppResultMessage(result));
    } catch (error) {
      setWaMessage(`Broadcast WhatsApp gagal: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setWaSending(false);
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
      if (!file.type.startsWith('image/')) {
        alert("Bukti pembayaran harus berupa gambar JPG atau PNG.");
        e.target.value = '';
        return;
      }
      setPaymentProofFile(file);
      setSubmitStatus('');
      setFormData(prev => ({ ...prev, paymentProofUrl: '' }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!paymentProofFile && !formData.paymentProofUrl) {
      alert("Silakan upload bukti pembayaran");
      return;
    }

    setSubmitting(true);
    setSubmitStatus('Mengecek data preorder...');
    try {
      const selectedProduct = currentProduct;
      if (!selectedProduct) {
        alert("Produk tidak ditemukan");
        setSubmitting(false);
        return;
      }

      // Re-verify stock before submission
      const productId = selectedProduct.id || DEFAULT_PRODUCT.id!;
      const stockKey = `${productId}_${formData.size}`;
      const currentUsed = stockUsed[stockKey] || 0;
      const limit = stockLimits[stockKey] || 50; // Default limit
      if (currentUsed + formData.quantity > limit) {
        alert("Maaf, stok untuk ukuran ini baru saja habis atau tidak mencukupi.");
        setSubmitting(false);
        return;
      }

      let paymentProofUrl = formData.paymentProofUrl;
      if (paymentProofFile) {
        setSubmitStatus('Mengompres bukti pembayaran...');
        paymentProofUrl = await compressPaymentProofToDataUrl(paymentProofFile);
      }

      setSubmitStatus('Menyimpan preorder...');
      const orderData = {
        userId: user.uid,
        customerEmail: user.email,
        customerName: user.displayName,
        productId,
        productName: selectedProduct.name,
        ...formData,
        paymentProofUrl,
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
      setPaymentProofFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setTimeout(() => setSuccess(false), 7000);
    } catch (error) {
      const message = handleFirestoreError(error, OperationType.CREATE, 'orders');
      alert(`Preorder belum terkirim: ${message}`);
    } finally {
      setSubmitting(false);
      setSubmitStatus('');
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
      
      // Find order for notification
      const order = orders.find(o => o.id === orderId);
      if (order) {
        fetch('/api/notify-status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await getAdminAuthHeaders()),
          },
          body: JSON.stringify({
            phone: order.phone,
            name: order.name,
            status: newStatus,
            orderId: orderId.slice(-6).toUpperCase()
          })
        }).catch(e => console.warn("WA Notification failed:", e));

        // Sync to Sheet
        syncToSheet({ ...order, status: newStatus });
      }

      // Update local state for modal if open
      if (selectedOrder && selectedOrder.id === orderId) {
        setSelectedOrder({ ...selectedOrder, status: newStatus });
      }
    } catch (error) {
      const message = handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
      alert(`Status belum bisa diubah: ${message}`);
    }
  };

  const handleSubmitProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSubmitting(true);
    try {
      const data = {
        ...productFormData,
        availableSizes: productFormData.availableSizes.split(',').map(s => s.trim()),
        availableColors: productFormData.availableColors.split(',').map(c => c.trim()),
        price: Number(productFormData.price),
        createdAt: serverTimestamp()
      };

      if (editingProduct) {
        await updateDoc(doc(db, 'products', editingProduct.id!), data);
      } else {
        await addDoc(collection(db, 'products'), data);
      }
      setIsAddingProduct(false);
      setEditingProduct(null);
      setProductFormData({
        name: '',
        description: '',
        price: 0,
        imageUrl: '',
        availableSizes: 'S,M,L,XL,XXL,XXXL',
        availableColors: 'Hitam,Putih,Navy,Maroon',
        isActive: true
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'products');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteProduct = (productId: string) => {
    if (!isAdmin) return;
    setProductToDelete(productId);
  };

  const confirmDeleteProduct = async () => {
    if (!productToDelete) return;
    setSubmitting(true);
    try {
      await deleteDoc(doc(db, 'products', productToDelete));
      setProductToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `products/${productToDelete}`);
    } finally {
      setSubmitting(false);
    }
  };

  const saveStockLimits = async (newLimits: Record<string, number>) => {
    if (!isAdmin) return;
    try {
      const { setDoc } = await import('firebase/firestore');
      const stockRef = doc(db, 'settings', 'stock');
      await setDoc(stockRef, { stockLimits: newLimits }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'settings/stock');
    }
    setEditingStock(false);
  };

  const handlePublicSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchPhone) return;
    setSearching(true);
    setHasSearched(true);
    try {
      const res = await fetch(`/api/order-status/${searchPhone}`);
      const data = await res.json();
      setSearchResults(data.orders || []);
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setSearching(false);
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

  const getOrderProduct = (order: Order) => {
    return products.find(p => p.id === order.productId) || (order.productId === DEFAULT_PRODUCT.id ? DEFAULT_PRODUCT : null);
  };

  const getOrderUnitPrice = (order: Order) => {
    return getOrderProduct(order)?.price || DEFAULT_PRODUCT.price;
  };

  const getOrderTotal = (order: Order) => {
    return getOrderUnitPrice(order) * order.quantity;
  };

  const exportToExcel = () => {
    if (!isAdmin) return;
    const worksheet = XLSX.utils.json_to_sheet(orders.map(o => ({
      ID: o.id,
      Produk: o.productName || getOrderProduct(o)?.name || 'Produk',
      Nama: o.name,
      Telepon: o.phone,
      Alamat: o.address,
      Ukuran: o.size,
      Warna: o.color,
      Jumlah: o.quantity,
      HargaSatuan: getOrderUnitPrice(o),
      Total: getOrderTotal(o),
      Status: o.status,
      Tanggal: o.createdAt ? (o.createdAt as any).toDate().toLocaleString() : ''
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Orders");
    XLSX.writeFile(workbook, "Data_Preorder_KOMITS_2025.xlsx");
  };

  const generateInvoice = (order: Order) => {
    const doc = new jsPDF();
    
    // Header
    doc.setFontSize(20);
    doc.text("INVOICE RESMI", 105, 20, { align: 'center' });
    doc.setFontSize(10);
    doc.text("KOMITS 2025 OFFICIAL MERCHANDISE", 105, 28, { align: 'center' });
    
    // Horizontal line
    doc.setLineWidth(0.5);
    doc.line(20, 35, 190, 35);
    
    // Customer Info
    doc.setFontSize(12);
    doc.text(`No Pesanan: ${order.id?.slice(-8).toUpperCase()}`, 20, 45);
    doc.text(`Tanggal: ${new Date().toLocaleDateString()}`, 20, 52);
    
    doc.text("Informasi Pelanggan:", 20, 70);
    doc.setFontSize(10);
    doc.text(`Nama: ${order.name}`, 20, 77);
    doc.text(`WA: ${order.phone}`, 20, 83);
    doc.text(`Alamat: ${order.address}`, 20, 89, { maxWidth: 100 });
    
    // Order Table
    autoTable(doc, {
      startY: 100,
      head: [['Produk', 'Detail', 'Jumlah', 'Total']],
      body: [
        [
          order.productName || getOrderProduct(order)?.name || 'Produk',
          `${order.size} - ${order.color}`,
          `${order.quantity} pcs`,
          `Rp ${getOrderTotal(order).toLocaleString()}`
        ],
      ],
      theme: 'grid',
      headStyles: { fillColor: [37, 99, 235] },
    });
    
    const finalY = (doc as any).lastAutoTable.finalY || 150;
    
    // Status
    doc.setFontSize(12);
    doc.setTextColor(37, 99, 235);
    doc.text(`STATUS: ${order.status.toUpperCase()}`, 20, finalY + 20);
    
    // Footer
    doc.setTextColor(150);
    doc.setFontSize(8);
    doc.text("Ini adalah dokumen resmi yang digenerate otomatis oleh sistem KOMITS 2025.", 105, 280, { align: 'center' });
    
    doc.save(`Invoice_${order.name.replace(/\s/g, '_')}.pdf`);
  };

  const generateShippingLabels = () => {
    if (!isAdmin) return;
    const doc = new jsPDF();
    
    let yPos = 20;
    orders.filter(o => o.status === OrderStatus.VERIFIED || o.status === OrderStatus.PROCESSING).forEach((order, index) => {
      if (index > 0 && index % 4 === 0) {
        doc.addPage();
        yPos = 20;
      }
      
      const currentY = yPos + (index % 4) * 60;
      
      // Label Box
      doc.setDrawColor(200);
      doc.rect(20, currentY, 170, 55);
      
      // Label Header
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("PENGIRIM: KOMITS 2025 (Official Office)", 25, currentY + 10);
      doc.text("0812-3456-7890", 25, currentY + 15);
      
      doc.line(20, currentY + 20, 190, currentY + 20);
      
      // Label Body
      doc.text("PENERIMA:", 25, currentY + 30);
      doc.setFontSize(14);
      doc.text(order.name.toUpperCase(), 25, currentY + 38);
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Tlp: ${order.phone}`, 25, currentY + 44);
      doc.text(`Alamat: ${order.address}`, 25, currentY + 50, { maxWidth: 160 });
      
      // Order ID on corner
      doc.setFontSize(8);
      doc.text(`ID: ${order.id?.slice(-6).toUpperCase()}`, 160, currentY + 10);
      doc.text(`${order.size} - ${order.color}`, 160, currentY + 15);
    });
    
    doc.save("Label_Pengiriman_KOMITS_2025.pdf");
  };

  const getAnalytics = () => {
    const colorData: Record<string, number> = {};
    const statusData: Record<string, number> = {
      'Pending': 0,
      'Verified': 0,
      'Shipped': 0,
      'Processing': 0,
      'Completed': 0
    };
    let totalRevenue = 0;

    orders.forEach(order => {
      // Color Stats
      colorData[order.color] = (colorData[order.color] || 0) + order.quantity;
      
      // Status Stats
      const statusLabel = order.status.charAt(0).toUpperCase() + order.status.slice(1);
      statusData[statusLabel] = (statusData[statusLabel] || 0) + 1;

      // Revenue Calculation
      if (order.status !== OrderStatus.PENDING) {
        totalRevenue += getOrderTotal(order);
      }
    });

    const colorChartData = Object.entries(colorData).map(([name, value]) => ({ name, value }));
    const statusChartData = Object.entries(statusData).map(([name, value]) => ({ name, value }));

    return { colorChartData, statusChartData, totalRevenue };
  };

  const { colorChartData, statusChartData, totalRevenue } = getAnalytics();
  const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
  const showPreorderForm = Boolean(user && !isAdmin && activeTab === 'preorder');
  const showOrdersDashboard = Boolean(user && (activeTab === 'history' || (isAdmin && activeTab === 'preorder')));
  const showHeroBanner = !user || showPreorderForm;

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
        {user && (
          <div className="mb-10 -mx-4 px-4 sm:mx-0 sm:px-0">
            <div className="flex gap-2 bg-gray-100/80 backdrop-blur-sm p-1.5 rounded-[1.25rem] w-fit max-w-full overflow-x-auto no-scrollbar scroll-smooth">
              {isAdmin ? (
                <>
                  <button 
                    onClick={() => { setActiveTab('preorder'); setActiveAdminTab('orders'); }}
                    className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-[13px] font-black whitespace-nowrap transition-all active:scale-95 ${activeTab === 'preorder' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <ClipboardList className="w-4 h-4" />
                    PESANAN
                  </button>
                  <button 
                    onClick={() => { setActiveTab('stats'); setActiveAdminTab('stats'); }}
                    className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-[13px] font-black whitespace-nowrap transition-all active:scale-95 ${activeTab === 'stats' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <BarChart3 className="w-4 h-4" />
                    STATISTIK
                  </button>
                  <button 
                    onClick={() => { setActiveTab('products'); setActiveAdminTab('products'); }}
                    className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-[13px] font-black whitespace-nowrap transition-all active:scale-95 ${activeTab === 'products' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <ShoppingBag className="w-4 h-4" />
                    PRODUK
                  </button>
                </>
              ) : (
                <>
                  <button 
                    onClick={() => setActiveTab('preorder')}
                    className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[13px] font-black transition-all active:scale-95 ${activeTab === 'preorder' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <Shirt className="w-4 h-4" />
                    PREORDER BARU
                  </button>
                  <button 
                    onClick={() => setActiveTab('history')}
                    className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[13px] font-black transition-all active:scale-95 ${activeTab === 'history' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <ClipboardList className="w-4 h-4" />
                    RIWAYAT
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Banner - Only show on Preorder Tab or when not logged in */}
        {showHeroBanner && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-[2rem] p-6 sm:p-8 mb-8 text-white relative overflow-hidden"
          >
            <div className="relative z-10">
              <p className="text-blue-100 font-mono text-[10px] sm:text-xs uppercase tracking-widest mb-2">Exclusive Release</p>
              <h2 className="text-2xl sm:text-4xl font-extrabold mb-3 leading-tight">KOMITS 2025<br />Pre Order System</h2>
              <p className="text-blue-100 max-w-sm text-sm sm:text-base opacity-90 leading-relaxed">
                Dapatkan kaos official KOMITS 2025 edisi terbatas. Pilih ukuran, warna favorit, dan miliki sekarang!
              </p>
            </div>
            <div className="absolute top-0 right-0 w-48 h-48 sm:w-64 sm:h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
            <div className="absolute bottom-0 right-4 sm:right-12 opacity-10">
              <Shirt size={120} className="sm:w-[200px] sm:h-[200px]" />
            </div>
          </motion.div>
        )}

          {isAdmin && activeAdminTab === 'stats' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6 sm:space-y-8 mb-12"
            >
              {/* Stat Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                <div className="bg-white p-6 rounded-[2rem] border border-blue-50 shadow-sm">
                  <div className="bg-blue-50 w-12 h-12 rounded-2xl flex items-center justify-center mb-5">
                    <TrendingUp className="w-6 h-6 text-blue-600" />
                  </div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Total Pendapatan</p>
                  <h4 className="text-2xl font-black text-gray-900">Rp {totalRevenue.toLocaleString()}</h4>
                  <p className="text-[10px] text-gray-400 mt-2 italic font-medium">*Non-pending orders</p>
                </div>
                <div className="bg-white p-6 rounded-[2rem] border border-green-50 shadow-sm">
                  <div className="bg-green-50 w-12 h-12 rounded-2xl flex items-center justify-center mb-5">
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  </div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Pesanan Sukses</p>
                  <h4 className="text-2xl font-black text-gray-900">{orders.filter(o => o.status === OrderStatus.COMPLETED || o.status === OrderStatus.VERIFIED).length}</h4>
                  <p className="text-[10px] text-gray-400 mt-2 italic font-medium">Verified & Completed</p>
                </div>
                <div className="bg-white p-6 rounded-[2rem] border border-orange-50 shadow-sm">
                  <div className="bg-orange-50 w-12 h-12 rounded-2xl flex items-center justify-center mb-5">
                    <Loader2 className="w-6 h-6 text-orange-600" />
                  </div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Proses Verifikasi</p>
                  <h4 className="text-2xl font-black text-gray-900">{orders.filter(o => o.status === OrderStatus.PENDING).length}</h4>
                  <p className="text-[10px] text-gray-400 mt-2 italic font-medium">Status: Pending</p>
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
                <div className="bg-white p-6 sm:p-8 rounded-[2.5rem] border border-gray-100 shadow-sm min-h-[380px] sm:min-h-[450px]">
                  <h4 className="font-black text-gray-800 mb-8 flex items-center gap-2 text-sm sm:text-base tracking-tight">
                    <div className="bg-blue-100 p-1.5 rounded-lg">
                      <BarChart3 className="w-4 h-4 text-blue-600" />
                    </div>
                    POPULARITAS WARNA
                  </h4>
                  <div className="h-[250px] sm:h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={colorChartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                        <XAxis dataKey="name" fontSize={10} stroke="#9CA3AF" axisLine={false} tickLine={false} />
                        <YAxis hide />
                        <Tooltip 
                          cursor={{ fill: '#F9FAFB', radius: 8 }}
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', padding: '12px' }}
                          itemStyle={{ fontWeight: '800', fontSize: '12px' }}
                        />
                        <Bar 
                          dataKey="value" 
                          fill="#2563eb" 
                          radius={[8, 8, 0, 0]} 
                          animationDuration={1500}
                          barSize={32}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-6 sm:p-8 rounded-[2.5rem] border border-gray-100 shadow-sm min-h-[380px] sm:min-h-[450px]">
                  <h4 className="font-black text-gray-800 mb-8 flex items-center gap-2 text-sm sm:text-base tracking-tight">
                    <div className="bg-indigo-100 p-1.5 rounded-lg">
                      <PieChartIcon className="w-4 h-4 text-indigo-600" />
                    </div>
                    STATUS PEMBAYARAN
                  </h4>
                  <div className="h-[250px] sm:h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusChartData}
                          innerRadius={60}
                          outerRadius={85}
                          paddingAngle={8}
                          dataKey="value"
                          stroke="none"
                        >
                          {statusChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} cornerRadius={8} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', padding: '12px' }}
                        />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '11px', fontWeight: 'bold' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {isAdmin && activeAdminTab === 'products' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white border border-blue-100 rounded-3xl p-6 mb-8 shadow-sm"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-blue-600 flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5" />
                  Admin: Manajemen Produk
                </h3>
                <button 
                  onClick={() => {
                    setIsAddingProduct(true);
                    setEditingProduct(null);
                    setProductFormData({
                      name: '',
                      description: '',
                      price: 0,
                      imageUrl: '',
                      availableSizes: 'S,M,L,XL,XXL,XXXL',
                      availableColors: 'Hitam,Putih,Navy,Maroon',
                      isActive: true
                    });
                  }}
                  className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors"
                >
                  Tambah Produk Baru
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {products.map(product => (
                  <div key={product.id} className="p-4 rounded-2xl border border-gray-100 bg-gray-50 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-sm">{product.name}</h4>
                      <p className="text-xs text-gray-500">Rp {product.price.toLocaleString()}</p>
                      <p className="text-[10px] text-gray-400 mt-1">{product.isActive ? 'Aktif' : 'Nonaktif'}</p>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          setEditingProduct(product);
                          setIsAddingProduct(true);
                          setProductFormData({
                            name: product.name,
                            description: product.description,
                            price: product.price,
                            imageUrl: product.imageUrl,
                            availableSizes: product.availableSizes.join(','),
                            availableColors: product.availableColors.join(','),
                            isActive: product.isActive
                          });
                        }}
                        className="p-2 hover:bg-blue-100 text-blue-600 rounded-lg transition-colors"
                      >
                        <Info className="w-4 h-4" />
                      </button>
                        <button 
                          onClick={() => handleDeleteProduct(product.id!)}
                          className="p-2 hover:bg-red-100 text-red-600 rounded-lg transition-colors group"
                          title="Hapus Produk"
                        >
                          <LogOut className="w-4 h-4 rotate-90 group-hover:scale-110 transition-transform" />
                        </button>
                    </div>
                  </div>
                ))}
              </div>

              <AnimatePresence>
                {isAddingProduct && (
                  <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setIsAddingProduct(false)}
                      className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    />
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 20 }}
                      className="relative bg-white w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl p-6"
                    >
                      <h3 className="font-bold text-xl mb-6">{editingProduct ? 'Edit Produk' : 'Tambah Produk'}</h3>
                      <form onSubmit={handleSubmitProduct} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase">Nama Produk</label>
                            <input 
                              required
                              className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 text-sm"
                              value={productFormData.name}
                              onChange={e => setProductFormData({...productFormData, name: e.target.value})}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase">Harga (Rp)</label>
                            <input 
                              required
                              type="number"
                              className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 text-sm"
                              value={productFormData.price}
                              onChange={e => setProductFormData({...productFormData, price: parseInt(e.target.value) || 0})}
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Deskripsi</label>
                          <textarea 
                            required
                            className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 text-sm min-h-[80px]"
                            value={productFormData.description}
                            onChange={e => setProductFormData({...productFormData, description: e.target.value})}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Image URL</label>
                          <input 
                            className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 text-sm"
                            value={productFormData.imageUrl}
                            onChange={e => setProductFormData({...productFormData, imageUrl: e.target.value})}
                            placeholder="https://example.com/image.jpg"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase">Ukuran (Pisahkan ,)</label>
                            <input 
                              className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 text-sm"
                              value={productFormData.availableSizes}
                              onChange={e => setProductFormData({...productFormData, availableSizes: e.target.value})}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase">Warna (Pisahkan ,)</label>
                            <input 
                              className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 text-sm"
                              value={productFormData.availableColors}
                              onChange={e => setProductFormData({...productFormData, availableColors: e.target.value})}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input 
                            type="checkbox"
                            checked={productFormData.isActive}
                            onChange={e => setProductFormData({...productFormData, isActive: e.target.checked})}
                          />
                          <label className="text-xs font-bold text-gray-600">Produk Aktif / Dijual</label>
                        </div>
                        <div className="flex gap-3 pt-4">
                          <button 
                            type="button"
                            onClick={() => setIsAddingProduct(false)}
                            className="flex-1 px-4 py-3 border border-gray-200 rounded-2xl text-sm font-bold text-gray-500 hover:bg-gray-50 transition-colors"
                          >
                            Batal
                          </button>
                          <button 
                            type="submit"
                            disabled={submitting}
                            className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-2xl text-sm font-bold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                          >
                            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                            Simpan Produk
                          </button>
                        </div>
                      </form>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>

              {/* Delete Product Confirmation Modal */}
              <AnimatePresence>
                {productToDelete && (
                  <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setProductToDelete(null)}
                      className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    />
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 20 }}
                      className="relative bg-white w-full max-w-sm rounded-[2.5rem] overflow-hidden shadow-2xl p-8 text-center"
                    >
                      <div className="bg-red-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                        <AlertTriangle className="w-10 h-10 text-red-500" />
                      </div>
                      <h3 className="text-xl font-black text-gray-900 mb-3">Hapus Produk?</h3>
                      <p className="text-gray-500 text-sm leading-relaxed mb-8">
                        Tindakan ini tidak dapat dibatalkan. Apakah Anda yakin ingin menghapus produk ini secara permanen?
                      </p>
                      <div className="flex flex-col gap-3">
                        <button 
                          onClick={confirmDeleteProduct}
                          disabled={submitting}
                          className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-black py-4 rounded-2xl transition-all shadow-lg shadow-red-100 flex items-center justify-center gap-2"
                        >
                          {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Ya, Hapus Permanen'}
                        </button>
                        <button 
                          onClick={() => setProductToDelete(null)}
                          disabled={submitting}
                          className="w-full bg-gray-50 hover:bg-gray-100 text-gray-600 font-bold py-4 rounded-2xl transition-all"
                        >
                          Batalkan
                        </button>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>

              <div className="mt-8 pt-6 border-t border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-red-600 flex items-center gap-2">
                    <Info className="w-5 h-5" />
                    Admin: Manajemen Stok Per Item
                  </h3>
                  <button 
                    onClick={() => setEditingStock(!editingStock)}
                    className="text-sm font-bold text-blue-600 hover:underline"
                  >
                    {editingStock ? 'Batal Edit' : 'Edit Kuota'}
                  </button>
                </div>

                <div className="space-y-6">
                  {products.map(product => (
                    <div key={product.id} className="bg-gray-50 p-4 rounded-2xl">
                      <h5 className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider">{product.name}</h5>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                        {product.availableSizes.map(size => {
                          const stockKey = `${product.id}_${size}`;
                          const used = stockUsed[stockKey] || 0;
                          const limit = stockLimits[stockKey] || 50;
                          return (
                            <div key={size} className={`p-3 rounded-xl border transition-all ${used >= limit ? 'bg-red-50 border-red-100' : 'bg-white border-gray-100'}`}>
                              <p className="text-[10px] font-bold text-gray-400 mb-1">SIZE {size}</p>
                              {editingStock ? (
                                <input 
                                  type="number"
                                  className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1 text-[10px] font-bold"
                                  defaultValue={limit}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value) || 0;
                                    setStockLimits(prev => ({ ...prev, [stockKey]: val }));
                                  }}
                                />
                              ) : (
                                <div className="flex items-baseline gap-1">
                                  <span className="text-base font-bold">{used}</span>
                                  <span className="text-[10px] text-gray-400">/ {limit}</span>
                                </div>
                              )}
                              <div className="w-full bg-gray-200 h-1 rounded-full mt-2 overflow-hidden">
                                <div 
                                  className={`h-full transition-all ${used >= limit ? 'bg-red-500' : 'bg-blue-500'}`}
                                  style={{ width: `${Math.min(100, (used / (limit || 1)) * 100)}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                
                {editingStock && (
                  <button 
                    onClick={() => saveStockLimits(stockLimits)}
                    className="mt-6 w-full bg-blue-600 text-white font-bold py-2 rounded-xl hover:bg-blue-700 transition-colors"
                  >
                    Simpan Semua Perubahan Kuota Stok
                  </button>
                )}
              </div>
            </motion.div>
          )}

        {!user && activeAdminTab !== 'stats' ? (
          <div className="space-y-8">
            {/* Search Tool for Non-Logged In */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white border border-gray-200 rounded-[2.5rem] p-6 sm:p-8 shadow-sm"
            >
              <h3 className="text-lg sm:text-xl font-bold mb-5 flex items-center gap-2">
                <div className="bg-blue-50 p-2 rounded-xl">
                  <Search className="w-5 h-5 text-blue-600" />
                </div>
                Cek Status Pesanan
              </h3>
              <form onSubmit={handlePublicSearch} className="flex flex-col sm:flex-row gap-3">
                <input 
                  type="tel"
                  placeholder="Nomor WhatsApp (08...)"
                  className="flex-1 bg-gray-50 border border-gray-100 rounded-2xl px-5 py-4 sm:py-3.5 outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all text-sm font-semibold"
                  value={searchPhone}
                  onChange={(e) => setSearchPhone(e.target.value)}
                />
                <button 
                  type="submit"
                  disabled={searching}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold px-8 py-4 sm:py-3.5 rounded-2xl transition-all flex items-center justify-center gap-2 active:scale-95 touch-manipulation shadow-lg shadow-blue-100"
                >
                  {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Cek Status
                </button>
              </form>

              <AnimatePresence>
                {hasSearched && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-8 pt-8 border-t border-gray-50 space-y-4"
                  >
                    {searchResults.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-sm text-gray-500 font-medium">Tidak ditemukan pesanan untuk nomor ini.</p>
                        <p className="text-[10px] text-gray-400 mt-1">Pastikan nomor yang dimasukkan benar.</p>
                      </div>
                    ) : (
                      searchResults.map((order) => (
                        <div key={order.id} className="flex items-center justify-between bg-gray-50/50 p-5 rounded-[1.5rem] border border-gray-100/50">
                          <div className="min-w-0 pr-3">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-1.5">ID: {order.id}</p>
                            <p className="text-sm font-bold text-gray-900 truncate leading-tight mb-1">{order.productName}</p>
                            <p className="text-[11px] text-gray-500 font-medium">{order.size} • {order.color} • {order.quantity} pcs</p>
                            <p className="text-[10px] text-gray-400 mt-1 italic">Atas nama: {order.name}</p>
                          </div>
                          <span className={`text-[10px] uppercase font-black px-4 py-2 rounded-xl shrink-0 tracking-widest ${
                            order.status === 'pending' ? 'bg-orange-100 text-orange-600' :
                            order.status === 'verified' ? 'bg-green-600 text-white shadow-sm shadow-green-100' :
                            'bg-blue-600 text-white shadow-sm shadow-blue-100'
                          }`}>
                            {order.status}
                          </span>
                        </div>
                      ))
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

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
        </div>
        ) : showPreorderForm ? (
            <div className="max-w-xl mx-auto">
              {/* Form Section */}
              <motion.section 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-sm">
                  <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                    <Shirt className="w-5 h-5 text-blue-600" />
                    Formulir Preorder
                  </h3>
                  <div className="mb-5 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                    Setelah dikirim, data tersimpan di database dan langsung tampil di dashboard admin.
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Pilih Produk</label>
                      <select 
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-600 focus:bg-white outline-none transition-all appearance-none"
                        value={currentProduct?.id || ''}
                        onChange={e => setSelectedProductId(e.target.value)}
                      >
                        {preorderProducts.map(product => (
                          <option key={product.id} value={product.id}>{product.name} (Rp {product.price.toLocaleString()})</option>
                        ))}
                      </select>
                    </div>

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
                            onChange={e => setFormData({ ...formData, size: e.target.value })}
                          >
                            {(currentProduct?.availableSizes || DEFAULT_PRODUCT.availableSizes).map(s => {
                              const stockKey = `${currentProduct?.id || DEFAULT_PRODUCT.id}_${s}`;
                              const used = stockUsed[stockKey] || 0;
                              const limit = stockLimits[stockKey] || 50;
                              const isSoldOut = used >= limit;
                              return (
                                <option key={s} value={s} disabled={isSoldOut}>
                                  {s} {isSoldOut ? '(SOLD OUT)' : `(Stok: ${limit - used})`}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Warna</label>
                        <select 
                          className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-3 focus:ring-2 focus:ring-blue-600 focus:bg-white outline-none transition-all appearance-none"
                          value={formData.color}
                          onChange={e => setFormData({ ...formData, color: e.target.value })}
                        >
                          {(currentProduct?.availableColors || DEFAULT_PRODUCT.availableColors).map(c => (
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
                        className={`border-2 border-dashed rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all hover:bg-gray-50 ${paymentProofFile || formData.paymentProofUrl ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}
                      >
                        {paymentProofFile || formData.paymentProofUrl ? (
                          <>
                            <CheckCircle2 className="w-8 h-8 text-green-500" />
                            <span className="text-xs font-bold text-green-600">
                              {paymentProofFile ? paymentProofFile.name : 'Bukti pembayaran siap dikirim'}
                            </span>
                            <span className="text-[10px] font-medium text-green-500">Akan dikompres otomatis saat dikirim</span>
                          </>
                        ) : (
                          <>
                            <Upload className="w-8 h-8 text-gray-300" />
                            <span className="text-xs font-medium text-gray-400">Klik untuk upload bukti transfer</span>
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
                      {submitting ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          {submitStatus || 'Mengirim preorder...'}
                        </>
                      ) : 'Kirim Preorder Sekarang'}
                    </button>

                    {submitting && submitStatus && (
                      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-center text-xs font-bold text-blue-700">
                        {submitStatus}
                      </div>
                    )}

                    <AnimatePresence>
                      {success && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                        className="bg-green-50 text-green-700 p-4 rounded-xl text-center text-sm font-medium border border-green-100"
                      >
                          {submitMessage || 'Pesanan Anda berhasil dikirim!'}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </form>
                </div>

                {/* Info Card - Simplified for single column */}
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex gap-3 text-amber-800">
                  <Info className="w-5 h-5 shrink-0" />
                  <div>
                    <p className="text-sm font-bold mb-1">Informasi Pembayaran</p>
                    <p className="text-xs leading-relaxed opacity-80">
                      Transfer ke rekening <strong>Bank ABC 123456789 a.n. KOMITS</strong>. 
                      Upload bukti transfer untuk verifikasi.
                    </p>
                  </div>
                </div>
              </motion.section>
            </div>
        ) : showOrdersDashboard ? (
          <div className="w-full">
            {/* Orders Tracking - Full Width */}
            <motion.section 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-sm overflow-hidden">
                <h3 className="text-lg font-bold mb-6 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="w-5 h-5 text-blue-600" />
                    {isAdmin ? 'Manajemen Pesanan' : 'Riwayat Pesanan Anda'}
                  </div>
                  {isAdmin && (
                    <div className="flex gap-2">
                      <button 
                        onClick={exportToExcel}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-600 rounded-lg text-xs font-bold hover:bg-green-100 transition-colors"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        Excel
                      </button>
                      <button 
                        onClick={generateShippingLabels}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Label WA
                      </button>
                    </div>
                  )}
                </h3>
                {isAdmin && (
                  <>
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
                    <button
                      onClick={handleBroadcastWhatsApp}
                      disabled={waSending || orders.length === 0}
                      className="mb-3 w-full rounded-xl bg-green-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-green-700 disabled:bg-green-300 flex items-center justify-center gap-2"
                    >
                      {waSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Broadcast WA Semua Order
                    </button>
                    {waMessage && (
                      <div className="mb-4 rounded-xl border border-green-100 bg-green-50 p-3 text-sm font-medium text-green-700">
                        {waMessage}
                      </div>
                    )}
                    <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs leading-relaxed text-gray-500">
                      Pesan WA memakai nomor dari field No Telepon / WA. Jika API key Fonnte belum diisi, sistem berjalan dalam mode mock untuk testing.
                    </div>
                  </>
                )}

                {ordersError && (
                  <div className="mb-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-700">
                    {ordersError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[800px] overflow-y-auto pr-2 custom-scrollbar">
                  {orders.length === 0 ? (
                    <div className="text-center py-12 col-span-2">
                      <p className="text-gray-400 text-sm italic">Belum ada pesanan.</p>
                      {!isAdmin && (
                        <button 
                          onClick={() => setActiveTab('preorder')}
                          className="mt-4 text-blue-600 font-bold text-sm hover:underline"
                        >
                          Mulai Preorder Sekarang
                        </button>
                      )}
                    </div>
                  ) : (
                    orders.map((order, idx) => (
                      <motion.div 
                        key={order.id} 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        onClick={() => setSelectedOrder(order)}
                        className="border border-gray-100 rounded-2xl p-4 bg-gray-50/50 hover:bg-white hover:border-blue-100 hover:shadow-md transition-all group cursor-pointer"
                      >
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Order ID: {order.id?.slice(-6).toUpperCase()}</p>
                            <h4 className="font-bold text-gray-800 line-clamp-1">{order.productName || 'Produk'}</h4>
                            <p className="text-[10px] text-gray-500">{order.size} - {order.color}</p>
                            {isAdmin && <p className="text-[10px] text-gray-500 truncate">{order.customerEmail || order.name}</p>}
                          </div>
                          <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded-lg flex items-center gap-1 shrink-0 ${
                            order.status === OrderStatus.PENDING ? 'bg-orange-100 text-orange-600' :
                            order.status === OrderStatus.VERIFIED ? 'bg-green-600 text-white shadow-sm shadow-green-100' :
                            'bg-blue-600 text-white'
                          }`}>
                            {order.status === OrderStatus.VERIFIED && <CheckCircle2 className="w-2.5 h-2.5" />}
                            {order.status}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-3 mb-3">
                          <div className="bg-white/50 p-2 rounded-lg">
                            <p className="text-[10px] text-gray-400 uppercase font-bold">Pesan</p>
                            <p className="text-sm font-bold text-gray-600">{order.quantity} pcs</p>
                          </div>
                          <div className="bg-white/50 p-2 rounded-lg">
                            <p className="text-[10px] text-gray-400 uppercase font-bold">Total</p>
                            <p className="text-sm font-bold text-gray-600">Rp {getOrderTotal(order).toLocaleString()}</p>
                          </div>
                          <div className="bg-white/50 p-2 rounded-lg">
                            <p className="text-[10px] text-gray-400 uppercase font-bold">Tanggal</p>
                            <p className="text-sm font-bold text-gray-600">
                              {order.createdAt ? (order.createdAt as any).toDate().toLocaleDateString() : '-'}
                            </p>
                          </div>
                        </div>
                        {isAdmin && (
                          <div className="flex items-center gap-2 text-[10px] text-blue-600 font-bold mb-2 truncate">
                            <UserIcon className="w-3 h-3" />
                            {order.name}
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-[10px] text-gray-400">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate">{order.address}</span>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              </div>
            </motion.section>
          </div>
        ) : null}
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
                {/* Download Invoice Button for Verified Orders */}
                {(selectedOrder.status === OrderStatus.VERIFIED || selectedOrder.status === OrderStatus.COMPLETED || isAdmin) && (
                  <button 
                    onClick={() => generateInvoice(selectedOrder)}
                    className="w-full flex items-center justify-center gap-2 bg-blue-50 text-blue-600 py-3 rounded-2xl font-bold text-sm hover:bg-blue-100 transition-colors border border-blue-100"
                  >
                    <Download className="w-4 h-4" />
                    Download Invoice PDF
                  </button>
                )}

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
                          onClick={() => handleSendOrderWhatsApp(selectedOrder)}
                          disabled={waSending || !selectedOrder.phone}
                          className="mb-3 w-full py-2 rounded-xl text-xs font-bold text-green-700 hover:bg-green-50 transition-colors border border-green-100 flex items-center justify-center gap-2 disabled:text-green-300"
                        >
                          {waSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          Kirim WA ke Pemesan
                        </button>
                        {waMessage && (
                          <div className="mb-3 rounded-xl border border-green-100 bg-green-50 p-3 text-xs font-medium text-green-700">
                            {waMessage}
                          </div>
                        )}
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
                      <p className="font-bold text-lg">{selectedOrder.productName || 'Kaos KOMITS 2025'}</p>
                      <p className="text-sm text-gray-500">{selectedOrder.size} • {selectedOrder.color} • {selectedOrder.quantity} pcs</p>
                      <p className="text-sm font-bold text-blue-600 mt-1">Total: Rp {getOrderTotal(selectedOrder).toLocaleString()}</p>
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
