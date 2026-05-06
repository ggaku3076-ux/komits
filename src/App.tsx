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
  AlertTriangle,
  Moon,
  Sun,
  ShoppingCart,
  ArrowLeft,
  PackageOpen,
  Tag,
  CreditCard
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

const getAdminPermissionHelp = () => {
  const currentEmail = auth.currentUser?.email || '(belum terbaca)';
  const configuredAdmins = ADMIN_EMAILS.length ? ADMIN_EMAILS.join(', ') : '(belum diatur)';

  return [
    'akses admin ditolak oleh Firestore.',
    '',
    `Login sekarang: ${currentEmail}`,
    `Admin yang diizinkan app: ${configuredAdmins}`,
    '',
    'Pastikan email login sama persis dengan rules Firebase, lalu publish rules terbaru di Console Firebase.'
  ].join('\n');
};

const DEFAULT_SIZES = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const DEFAULT_COLORS = ['Hitam', 'Putih', 'Navy', 'Maroon'];
const PRODUCT_CATEGORIES = ['Kaos', 'Hoodie', 'Totebag', 'Aksesoris', 'Bundle', 'Digital', 'Lainnya'];
const MAX_PAYMENT_PROOF_STORED_CHARS = 850_000;
const MAX_PRODUCT_IMAGE_STORED_CHARS = 650_000;

const compressImageToDataUrl = (
  file: File,
  options: {
    maxStoredChars: number;
    initialMaxDimension: number;
    minMaxDimension: number;
    largeFileQuality: number;
    normalQuality: number;
    tooLargeMessage: string;
  }
) => {
  if (!file.type.startsWith('image/')) {
    return Promise.reject(new Error('File harus berupa gambar JPG, PNG, atau format gambar lain yang didukung browser.'));
  }

  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    let maxDimension = options.initialMaxDimension;
    let quality = file.size > 5 * 1024 * 1024 ? options.largeFileQuality : options.normalQuality;

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

      if (dataUrl.length <= options.maxStoredChars) {
        resolve(dataUrl);
        return;
      }

      if (quality > 0.45) {
        quality = Math.max(0.45, quality - 0.1);
        renderCompressedImage();
        return;
      }

      if (maxDimension > options.minMaxDimension) {
        maxDimension = Math.max(options.minMaxDimension, Math.floor(maxDimension * 0.75));
        quality = options.normalQuality;
        renderCompressedImage();
        return;
      }

      reject(new Error(options.tooLargeMessage));
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

const compressPaymentProofToDataUrl = (file: File) => compressImageToDataUrl(file, {
  maxStoredChars: MAX_PAYMENT_PROOF_STORED_CHARS,
  initialMaxDimension: 1600,
  minMaxDimension: 720,
  largeFileQuality: 0.72,
  normalQuality: 0.82,
  tooLargeMessage: 'Bukti pembayaran tetap terlalu besar setelah dikompres. Coba crop bagian bukti transfer saja.',
});

const compressProductImageToDataUrl = (file: File) => compressImageToDataUrl(file, {
  maxStoredChars: MAX_PRODUCT_IMAGE_STORED_CHARS,
  initialMaxDimension: 1200,
  minMaxDimension: 600,
  largeFileQuality: 0.7,
  normalQuality: 0.8,
  tooLargeMessage: 'Gambar produk tetap terlalu besar setelah dikompres. Coba pakai gambar yang lebih ringan.',
});

export default function App() {
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    const savedTheme = window.localStorage.getItem('komits-theme');
    return savedTheme === 'dark' ? 'dark' : 'light';
  });
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
  const [productMessage, setProductMessage] = useState('');
  const [productImageProcessing, setProductImageProcessing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [activeTab, setActiveTab] = useState<'preorder' | 'checkout' | 'history' | 'stats' | 'products'>('preorder');
  const [activeAdminTab, setActiveAdminTab] = useState<'orders' | 'stats' | 'products'>('orders');

  // Product Form State
  const [productFormData, setProductFormData] = useState({
    name: '',
    description: '',
    category: 'Lainnya',
    price: 0,
    imageUrl: '',
    availableSizes: 'Default',
    availableColors: 'Default',
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
  const productImageInputRef = useRef<HTMLInputElement>(null);
  const activeProducts = products.filter(p => p.isActive || isAdmin);
  const currentProduct = activeProducts.find(p => p.id === selectedProductId) || null;
  const isDarkMode = themeMode === 'dark';

  useEffect(() => {
    window.localStorage.setItem('komits-theme', themeMode);
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [themeMode, isDarkMode]);

  const toggleTheme = () => {
    setThemeMode(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const getProductStockSummary = (product: Product) => {
    const sizes = product.availableSizes?.length ? product.availableSizes : DEFAULT_SIZES;
    const totalRemaining = sizes.reduce((total, size) => {
      const stockKey = `${product.id}_${size}`;
      const used = stockUsed[stockKey] || 0;
      const limit = stockLimits[stockKey] || 50;
      return total + Math.max(0, limit - used);
    }, 0);

    return {
      totalRemaining,
      isSoldOut: totalRemaining <= 0
    };
  };

  const handleChooseProduct = (product: Product) => {
    if (!product.id) return;
    const sizes = product.availableSizes?.length ? product.availableSizes : DEFAULT_SIZES;
    const colors = product.availableColors?.length ? product.availableColors : DEFAULT_COLORS;

    setSelectedProductId(product.id);
    setFormData(prev => ({
      ...prev,
      size: sizes[0] as Order['size'],
      color: colors[0],
      quantity: 1
    }));
    setSuccess(false);
    setSubmitMessage('');
    setActiveTab('checkout');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenCart = () => {
    if (currentProduct) {
      setActiveTab('checkout');
    } else {
      setActiveTab('preorder');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    if (!currentProduct) return;
    const sizes = currentProduct.availableSizes?.length ? currentProduct.availableSizes : DEFAULT_SIZES;
    const colors = currentProduct.availableColors?.length ? currentProduct.availableColors : DEFAULT_COLORS;
    setFormData(prev => {
      const nextSize = sizes.includes(prev.size) ? prev.size : sizes[0];
      const nextColor = colors.includes(prev.color) ? prev.color : colors[0];
      if (nextSize === prev.size && nextColor === prev.color) return prev;
      return { ...prev, size: nextSize, color: nextColor };
    });
  }, [
    currentProduct?.id,
    currentProduct?.availableSizes?.join('|'),
    currentProduct?.availableColors?.join('|')
  ]);

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
      setSelectedProductId(prev => {
        if (!prev) return prev;
        return productsData.some(product => product.id === prev) ? prev : '';
      });
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

  const handleProductImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert("Gambar produk harus berupa JPG atau PNG.");
      e.target.value = '';
      return;
    }

    setProductImageProcessing(true);
    try {
      const imageUrl = await compressProductImageToDataUrl(file);
      setProductFormData(prev => ({ ...prev, imageUrl }));
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      e.target.value = '';
    } finally {
      setProductImageProcessing(false);
    }
  };

  const resetProductForm = () => {
    setEditingProduct(null);
    setProductMessage('');
    setProductFormData({
      name: '',
      description: '',
      category: 'Lainnya',
      price: 0,
      imageUrl: '',
      availableSizes: 'Default',
      availableColors: 'Default',
      isActive: true
    });
    if (productImageInputRef.current) {
      productImageInputRef.current.value = '';
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
      if (!selectedProduct?.id) {
        alert("Belum ada produk aktif. Admin perlu menambahkan produk terlebih dahulu.");
        setSubmitting(false);
        return;
      }

      // Re-verify stock before submission
      const productId = selectedProduct.id;
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
        unitPrice: selectedProduct.price,
        totalPrice: selectedProduct.price * formData.quantity,
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
        size: selectedProduct.availableSizes?.[0] || DEFAULT_SIZES[0],
        color: selectedProduct.availableColors?.[0] || DEFAULT_COLORS[0],
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
    if (!isAdmin) {
      alert(`Produk belum bisa disimpan: ${getAdminPermissionHelp()}`);
      return;
    }
    setProductMessage('');
    const productName = productFormData.name.trim();
    const productDescription = productFormData.description.trim();
    const productCategory = productFormData.category.trim() || 'Lainnya';
    const productPrice = Number(productFormData.price);

    if (!productName) {
      alert("Nama produk wajib diisi.");
      return;
    }
    if (!productDescription) {
      alert("Deskripsi produk wajib diisi.");
      return;
    }
    if (!Number.isFinite(productPrice) || productPrice <= 0) {
      alert("Harga produk wajib lebih dari 0.");
      return;
    }
    if (!productFormData.imageUrl) {
      alert("Silakan pilih gambar produk terlebih dahulu.");
      return;
    }
    setSubmitting(true);
    try {
      const availableSizes = productFormData.availableSizes.split(',').map(s => s.trim()).filter(Boolean);
      const availableColors = productFormData.availableColors.split(',').map(c => c.trim()).filter(Boolean);
      if (!availableSizes.length || !availableColors.length) {
        alert("Varian dan opsi produk wajib diisi.");
        setSubmitting(false);
        return;
      }

      const data = {
        ...productFormData,
        name: productName,
        description: productDescription,
        category: productCategory,
        availableSizes,
        availableColors,
        price: productPrice,
        updatedAt: serverTimestamp()
      };

      if (editingProduct) {
        await updateDoc(doc(db, 'products', editingProduct.id!), data);
      } else {
        await addDoc(collection(db, 'products'), {
          ...data,
          createdAt: serverTimestamp()
        });
      }
      setIsAddingProduct(false);
      resetProductForm();
      setProductMessage(editingProduct ? 'Produk berhasil diperbarui.' : 'Produk berhasil disimpan dan akan muncul di pilihan user jika statusnya aktif.');
    } catch (error) {
      const message = handleFirestoreError(error, OperationType.WRITE, 'products');
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : '';
      const isPermissionError = code === 'permission-denied' || message.toLowerCase().includes('missing or insufficient permissions');
      alert(`Produk belum bisa disimpan: ${isPermissionError ? getAdminPermissionHelp() : message}`);
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
    return products.find(p => p.id === order.productId) || null;
  };

  const getOrderUnitPrice = (order: Order) => {
    return order.unitPrice || getOrderProduct(order)?.price || 0;
  };

  const getOrderTotal = (order: Order) => {
    return order.totalPrice || getOrderUnitPrice(order) * order.quantity;
  };

  const exportToExcel = () => {
    if (!isAdmin) return;
    const worksheet = XLSX.utils.json_to_sheet(orders.map(o => ({
      ID: o.id,
      Produk: o.productName || getOrderProduct(o)?.name || 'Produk',
      Nama: o.name,
      Telepon: o.phone,
      Alamat: o.address,
      Varian: o.size,
      Opsi: o.color,
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
  const chartTooltipStyle = {
    backgroundColor: isDarkMode ? '#1f1f1f' : '#ffffff',
    color: isDarkMode ? '#f5f1e8' : '#111827',
    borderRadius: '16px',
    border: isDarkMode ? '1px solid rgba(255,255,255,0.08)' : 'none',
    boxShadow: isDarkMode ? '0 20px 25px -5px rgba(0,0,0,0.45)' : '0 20px 25px -5px rgba(0,0,0,0.1)',
    padding: '12px'
  };
  const showProductCatalog = Boolean(user && !isAdmin && activeTab === 'preorder');
  const showCheckoutForm = Boolean(user && !isAdmin && activeTab === 'checkout');
  const showOrdersDashboard = Boolean(user && (activeTab === 'history' || (isAdmin && activeTab === 'preorder')));
  const showHeroBanner = !user || showProductCatalog;

  if (loading) {
    return (
      <div className={`theme-${themeMode} flex items-center justify-center min-h-screen bg-[#F5F7FA] transition-colors duration-300`}>
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className={`theme-${themeMode} min-h-screen bg-[#F5F7FA] font-sans text-gray-900 pb-12 transition-colors duration-300`}>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <ShoppingBag className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-bold text-lg tracking-tight">KOMITS Store</h1>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3">
            <button 
              onClick={toggleTheme}
              className="theme-toggle h-10 w-10 rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors flex items-center justify-center"
              title={isDarkMode ? 'Mode terang' : 'Mode gelap'}
              aria-label={isDarkMode ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {user ? (
              <div className="flex items-center gap-3">
                {!isAdmin && (
                  <button
                    onClick={handleOpenCart}
                    className={`relative h-10 w-10 rounded-full border transition-colors flex items-center justify-center ${
                      activeTab === 'checkout'
                        ? 'border-blue-200 bg-blue-50 text-blue-600'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                    title="Keranjang"
                    aria-label="Buka keranjang"
                  >
                    <ShoppingCart className="w-4 h-4" />
                    {currentProduct && (
                      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-black text-white">
                        1
                      </span>
                    )}
                  </button>
                )}
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
                    <ShoppingBag className="w-4 h-4" />
                    PILIH PRODUK
                  </button>
                  <button 
                    onClick={handleOpenCart}
                    className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[13px] font-black transition-all active:scale-95 ${activeTab === 'checkout' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <ShoppingCart className="w-4 h-4" />
                    CHECKOUT
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
            className="bg-gradient-to-br from-blue-600 to-indigo-800 rounded-[2.5rem] p-8 sm:p-10 mb-10 text-white relative overflow-hidden shadow-xl shadow-blue-900/10"
          >
            <div className="relative z-10 sm:max-w-md">
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-white/10 backdrop-blur-md border border-white/20 w-fit px-3 py-1 rounded-full mb-6"
              >
                <p className="text-white font-mono text-[10px] uppercase tracking-[0.2em] font-bold">Limited Anniversary Edition</p>
              </motion.div>
              <h2 className="text-3xl sm:text-5xl font-black mb-4 leading-tight tracking-tight">
                KOMITS 2025<br />
                <span className="text-blue-300">Official Store</span>
              </h2>
              <p className="text-blue-100 text-sm sm:text-lg opacity-90 leading-relaxed font-medium mb-8">
                Selamat Datang di Official Komits 2025 Merchandise. Koleksi eksklusif untuk mendukung pergerakan sosial.
              </p>
              
              {!user && (
                <button 
                  onClick={handleLogin}
                  className="bg-white text-blue-700 font-black px-8 py-4 rounded-2xl flex items-center gap-2 hover:bg-blue-50 transition-all active:scale-95 shadow-lg"
                >
                  <ShoppingBag className="w-5 h-5" />
                  BELANJA SEKARANG
                </button>
              )}
            </div>

            {/* Merchandise Image Stack */}
            <div className="absolute top-0 right-0 h-full w-full pointer-events-none overflow-hidden sm:block">
              {/* Product 1: Black T-Shirt */}
              <motion.div 
                initial={{ opacity: 0, scale: 0.8, rotate: 10, x: 100 }}
                animate={{ opacity: 0.6, scale: 1, rotate: -15, x: 0 }}
                transition={{ duration: 1.2, ease: "easeOut" }}
                className="absolute -right-12 top-1/2 -translate-y-1/2 w-64 h-64 sm:w-96 sm:h-96"
              >
                <img 
                  src="https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&q=80&w=600" 
                  alt="Merchandise Mockup 1" 
                  className="w-full h-full object-contain filter drop-shadow-2xl"
                  referrerPolicy="no-referrer"
                />
              </motion.div>

              {/* Product 2: White Hoodie / Sweatshirt */}
              <motion.div 
                initial={{ opacity: 0, scale: 0.8, rotate: -20, x: 100 }}
                animate={{ opacity: 0.4, scale: 0.9, rotate: 10, x: 40 }}
                transition={{ duration: 1.5, ease: "easeOut", delay: 0.3 }}
                className="absolute right-12 bottom-0 w-48 h-48 sm:w-80 sm:h-80"
              >
                <img 
                  src="https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&q=80&w=600" 
                  alt="Merchandise Mockup 2" 
                  className="w-full h-full object-contain filter drop-shadow-2xl"
                  referrerPolicy="no-referrer"
                />
              </motion.div>
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
                    POPULARITAS OPSI
                  </h4>
                  <div className="h-[250px] sm:h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={colorChartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#343434' : '#F3F4F6'} />
                        <XAxis dataKey="name" fontSize={10} stroke={isDarkMode ? '#9b9386' : '#9CA3AF'} axisLine={false} tickLine={false} />
                        <YAxis hide />
                        <Tooltip 
                          cursor={{ fill: isDarkMode ? '#242424' : '#F9FAFB', radius: 8 }}
                          contentStyle={chartTooltipStyle}
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
                          contentStyle={chartTooltipStyle}
                        />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '11px', fontWeight: 'bold', color: isDarkMode ? '#d8d0c1' : '#374151' }} />
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
                    resetProductForm();
                  }}
                  className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors"
                >
                  Tambah Produk Baru
                </button>
              </div>

              {productMessage && (
                <div className="mb-4 rounded-2xl border border-green-100 bg-green-50 px-4 py-3 text-sm font-bold text-green-700">
                  {productMessage}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {products.length === 0 ? (
                  <div className="col-span-full rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
                    <ShoppingBag className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm font-bold text-gray-500">Belum ada produk.</p>
                    <p className="text-xs text-gray-400 mt-1">Tambahkan produk agar muncul di pilihan preorder user.</p>
                  </div>
                ) : products.map(product => (
                  <div key={product.id} className="p-4 rounded-2xl border border-gray-100 bg-gray-50 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white border border-gray-100 flex items-center justify-center">
                        {product.imageUrl ? (
                          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                        ) : (
                          <ShoppingBag className="w-5 h-5 text-gray-300" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-sm truncate">{product.name}</h4>
                        <p className="text-xs text-gray-500">Rp {product.price.toLocaleString()}</p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          {product.category || 'Lainnya'} • {product.isActive ? 'Aktif' : 'Nonaktif'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          setEditingProduct(product);
                          setIsAddingProduct(true);
                          if (productImageInputRef.current) productImageInputRef.current.value = '';
                          setProductFormData({
                            name: product.name,
                            description: product.description,
                            category: product.category || 'Lainnya',
                            price: product.price,
                            imageUrl: product.imageUrl,
                            availableSizes: (product.availableSizes || ['Default']).join(','),
                            availableColors: (product.availableColors || ['Default']).join(','),
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
                  <div className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-4">
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
                      className="relative bg-white w-full max-w-lg max-h-[88vh] rounded-3xl overflow-hidden shadow-2xl flex flex-col"
                    >
                      <div className="shrink-0 border-b border-gray-100 px-6 py-5">
                        <h3 className="font-bold text-xl">{editingProduct ? 'Edit Produk' : 'Tambah Produk'}</h3>
                        <p className="text-xs font-medium text-gray-400 mt-1">Lengkapi data produk, scroll untuk melihat semua field.</p>
                      </div>
                      <form onSubmit={handleSubmitProduct} className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-4 custom-scrollbar">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                              min="1"
                              inputMode="numeric"
                              className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-base sm:py-2 sm:text-sm"
                              placeholder="Contoh: 100000"
                              value={productFormData.price || ''}
                              onFocus={e => e.currentTarget.select()}
                              onChange={e => setProductFormData({...productFormData, price: e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0})}
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Kategori Produk</label>
                          <select
                            className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 text-sm"
                            value={productFormData.category}
                            onChange={e => setProductFormData({...productFormData, category: e.target.value})}
                          >
                            {PRODUCT_CATEGORIES.map(category => (
                              <option key={category} value={category}>{category}</option>
                            ))}
                          </select>
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
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Gambar Produk</label>
                          <div
                            onClick={() => productImageInputRef.current?.click()}
                            className={`min-h-[140px] cursor-pointer rounded-2xl border-2 border-dashed p-4 transition-all flex items-center justify-center overflow-hidden ${
                              productFormData.imageUrl ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                            }`}
                          >
                            {productImageProcessing ? (
                              <div className="flex flex-col items-center gap-2 text-blue-600">
                                <Loader2 className="w-7 h-7 animate-spin" />
                                <span className="text-xs font-bold">Mengompres gambar...</span>
                              </div>
                            ) : productFormData.imageUrl ? (
                              <div className="w-full">
                                <img
                                  src={productFormData.imageUrl}
                                  alt="Preview produk"
                                  className="mx-auto h-36 w-full max-w-xs rounded-xl object-cover"
                                />
                                <p className="mt-2 text-center text-[10px] font-bold text-green-600">Klik untuk ganti gambar</p>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-2 text-gray-400">
                                <Upload className="w-8 h-8" />
                                <span className="text-xs font-bold">Pilih file gambar produk</span>
                              </div>
                            )}
                          </div>
                          <input
                            ref={productImageInputRef}
                            type="file"
                            hidden
                            accept="image/*"
                            onChange={handleProductImageUpload}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase">Varian / Ukuran (Pisahkan ,)</label>
                            <input 
                              className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 text-sm"
                              value={productFormData.availableSizes}
                              onChange={e => setProductFormData({...productFormData, availableSizes: e.target.value})}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-400 uppercase">Opsi / Warna (Pisahkan ,)</label>
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
                        <div className="sticky bottom-0 -mx-6 mt-2 flex gap-3 border-t border-gray-100 bg-white/95 px-6 py-4 backdrop-blur">
                          <button 
                            type="button"
                            onClick={() => {
                              setIsAddingProduct(false);
                              if (productImageInputRef.current) productImageInputRef.current.value = '';
                            }}
                            className="flex-1 px-4 py-3 border border-gray-200 rounded-2xl text-sm font-bold text-gray-500 hover:bg-gray-50 transition-colors"
                          >
                            Batal
                          </button>
                          <button 
                            type="submit"
                            disabled={submitting || productImageProcessing}
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
                        {(product.availableSizes?.length ? product.availableSizes : DEFAULT_SIZES).map(size => {
                          const stockKey = `${product.id}_${size}`;
                          const used = stockUsed[stockKey] || 0;
                          const limit = stockLimits[stockKey] || 50;
                          return (
                            <div key={size} className={`p-3 rounded-xl border transition-all ${used >= limit ? 'bg-red-50 border-red-100' : 'bg-white border-gray-100'}`}>
                              <p className="text-[10px] font-bold text-gray-400 mb-1">VARIAN {size}</p>
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
        ) : showProductCatalog ? (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="overflow-hidden rounded-[2rem] border border-blue-100 bg-white shadow-sm">
              <div className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-slate-950 px-6 py-7 text-white sm:px-8 sm:py-8">
                <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full bg-white/10" />
                <div className="absolute bottom-0 right-8 hidden h-24 w-24 rounded-full border border-white/15 sm:block" />
                <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-blue-50">
                      <ShoppingBag className="h-3.5 w-3.5" />
                      KOMITS Store
                    </p>
                    <h2 className="max-w-xl text-3xl font-black leading-tight tracking-tight sm:text-4xl">Pilih produk favoritmu</h2>
                    <p className="mt-3 max-w-lg text-sm font-medium leading-relaxed text-blue-100">Katalog ini langsung mengikuti produk yang ditambahkan admin. Pilih barang, cek varian, lalu lanjut ke checkout.</p>
                  </div>
                  <button
                    onClick={handleOpenCart}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-blue-700 shadow-lg shadow-blue-950/20 transition-all hover:bg-blue-50 active:scale-95"
                  >
                    <ShoppingCart className="w-4 h-4" />
                    Keranjang {currentProduct ? '(1)' : ''}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 divide-x divide-gray-100 px-3 py-3 text-center">
                <div className="px-2 py-2">
                  <p className="text-lg font-black text-gray-900">{activeProducts.length}</p>
                  <p className="text-[10px] font-bold uppercase text-gray-400">Produk</p>
                </div>
                <div className="px-2 py-2">
                  <p className="text-lg font-black text-gray-900">{activeProducts.filter(product => !getProductStockSummary(product).isSoldOut).length}</p>
                  <p className="text-[10px] font-bold uppercase text-gray-400">Ready</p>
                </div>
                <div className="px-2 py-2">
                  <p className="text-lg font-black text-gray-900">{currentProduct ? '1' : '0'}</p>
                  <p className="text-[10px] font-bold uppercase text-gray-400">Keranjang</p>
                </div>
              </div>
            </div>

            {activeProducts.length === 0 ? (
              <div className="rounded-[2rem] border border-dashed border-gray-200 bg-white p-10 text-center shadow-sm">
                <PackageOpen className="mx-auto mb-4 h-10 w-10 text-gray-300" />
                <h3 className="text-lg font-black text-gray-900">Belum ada produk aktif</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm font-medium text-gray-500">Produk akan muncul di sini setelah admin menambahkan dan mengaktifkannya.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {activeProducts.map(product => {
                  const stockSummary = getProductStockSummary(product);
                  const isSelected = currentProduct?.id === product.id;

                  return (
                    <motion.article
                      key={product.id}
                      layout
                      whileHover={{ y: -3 }}
                      className={`group flex min-h-full flex-col overflow-hidden rounded-[1.75rem] border bg-white shadow-sm transition-all ${
                        isSelected ? 'border-blue-300 ring-4 ring-blue-100' : 'border-gray-200 hover:border-blue-100 hover:shadow-xl hover:shadow-blue-100/50'
                      }`}
                    >
                      <div className="relative aspect-square overflow-hidden bg-gray-50">
                        {product.imageUrl ? (
                          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <ShoppingBag className="h-12 w-12 text-gray-300" />
                          </div>
                        )}
                        <div className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[10px] font-black uppercase text-gray-700 shadow-sm backdrop-blur">
                          {product.category || 'Lainnya'}
                        </div>
                        {isSelected && (
                          <div className="absolute right-3 top-3 rounded-full bg-blue-600 px-3 py-1 text-[10px] font-black uppercase text-white shadow-sm">
                            Dipilih
                          </div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col p-4">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="line-clamp-2 text-base font-black leading-tight text-gray-900">{product.name}</h3>
                          </div>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${
                            stockSummary.isSoldOut ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'
                          }`}>
                            {stockSummary.isSoldOut ? 'Habis' : 'Ready'}
                          </span>
                        </div>
                        <p className="line-clamp-2 min-h-[2.5rem] text-xs font-medium leading-relaxed text-gray-500">{product.description}</p>
                        <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50 p-3">
                          <div className="flex items-end justify-between gap-3">
                            <div>
                              <p className="flex items-center gap-1 text-[10px] font-bold uppercase text-gray-400">
                                <Tag className="h-3 w-3" />
                                Harga
                              </p>
                              <p className="text-lg font-black text-blue-600">Rp {product.price.toLocaleString()}</p>
                            </div>
                            <p className="rounded-full bg-white px-2.5 py-1 text-right text-[10px] font-bold text-gray-500">{stockSummary.totalRemaining} stok</p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleChooseProduct(product)}
                          disabled={stockSummary.isSoldOut}
                          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-blue-100 transition-all hover:bg-blue-700 active:scale-95 disabled:bg-gray-300 disabled:shadow-none"
                        >
                          <ShoppingCart className="w-4 h-4" />
                          {isSelected ? 'Lanjut Checkout' : 'Pilih Produk'}
                        </button>
                      </div>
                    </motion.article>
                  );
                })}
              </div>
            )}
          </motion.section>
        ) : showCheckoutForm ? (
            <div className="max-w-xl mx-auto">
              {/* Form Section */}
              <motion.section 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-sm">
                  <div className="mb-6 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold flex items-center gap-2">
                        <ShoppingCart className="w-5 h-5 text-blue-600" />
                        Checkout Preorder
                      </h3>
                      <p className="mt-1 text-xs font-medium text-gray-400">Lengkapi data diri dan bukti pembayaran untuk produk pilihan.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('preorder')}
                      className="shrink-0 rounded-xl border border-gray-200 bg-white p-2 text-gray-500 transition-colors hover:text-blue-600"
                      title="Kembali pilih produk"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mb-5 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
                    Setelah dikirim, data tersimpan di database dan langsung tampil di dashboard admin.
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    {currentProduct ? (
                      <div className="overflow-hidden rounded-[1.75rem] border border-gray-100 bg-gray-50">
                        <div className="bg-white px-4 py-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-xs font-black uppercase tracking-wider text-gray-400">Produk di Keranjang</p>
                          <button
                            type="button"
                            onClick={() => setActiveTab('preorder')}
                            className="text-xs font-black text-blue-600 hover:underline"
                          >
                            Ganti Produk
                          </button>
                        </div>
                        <div className="flex gap-4">
                        {currentProduct.imageUrl ? (
                          <img src={currentProduct.imageUrl} alt={currentProduct.name} className="h-24 w-24 rounded-2xl object-cover bg-white" />
                        ) : (
                          <div className="h-24 w-24 rounded-2xl bg-white flex items-center justify-center">
                            <ShoppingBag className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <h4 className="font-black text-gray-900 leading-tight">{currentProduct.name}</h4>
                          <p className="text-sm font-bold text-blue-600 mt-1">Rp {currentProduct.price.toLocaleString()}</p>
                          <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 mt-1">{currentProduct.category || 'Lainnya'}</p>
                          <p className="text-xs text-gray-500 mt-2 line-clamp-3">{currentProduct.description}</p>
                        </div>
                        </div>
                        </div>
                        <div className="grid grid-cols-3 divide-x divide-gray-100 px-4 py-3">
                          <div className="pr-3">
                            <p className="text-[10px] font-bold uppercase text-gray-400">Harga</p>
                            <p className="text-sm font-black text-gray-900">Rp {currentProduct.price.toLocaleString()}</p>
                          </div>
                          <div className="px-3">
                            <p className="text-[10px] font-bold uppercase text-gray-400">Jumlah</p>
                            <p className="text-sm font-black text-gray-900">{formData.quantity} pcs</p>
                          </div>
                          <div className="pl-3">
                            <p className="text-[10px] font-bold uppercase text-gray-400">Total</p>
                            <p className="text-sm font-black text-blue-600">Rp {(currentProduct.price * formData.quantity).toLocaleString()}</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-medium text-amber-800">
                        Belum ada produk di keranjang. Pilih produk dulu dari katalog.
                        <button type="button" onClick={() => setActiveTab('preorder')} className="ml-1 font-black underline">Pilih produk</button>
                      </div>
                    )}

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
                          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Varian / Ukuran</label>
                          <select 
                            className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-3 focus:ring-2 focus:ring-blue-600 focus:bg-white outline-none transition-all appearance-none"
                            value={formData.size}
                            onChange={e => setFormData({ ...formData, size: e.target.value })}
                          >
                            {(currentProduct?.availableSizes || DEFAULT_SIZES).map(s => {
                              const stockKey = `${currentProduct?.id || 'no-product'}_${s}`;
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
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Opsi / Warna</label>
                        <select 
                          className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-3 focus:ring-2 focus:ring-blue-600 focus:bg-white outline-none transition-all appearance-none"
                          value={formData.color}
                          onChange={e => setFormData({ ...formData, color: e.target.value })}
                        >
                          {(currentProduct?.availableColors || DEFAULT_COLORS).map(c => (
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
                        className={`min-h-[120px] border-2 border-dashed rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all hover:bg-gray-50 ${paymentProofFile || formData.paymentProofUrl ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'}`}
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

                    {currentProduct && (
                      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                        <div className="mb-3 flex items-center gap-2 text-sm font-black text-gray-900">
                          <CreditCard className="h-4 w-4 text-blue-600" />
                          Ringkasan Pembayaran
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center justify-between text-gray-500">
                            <span>{currentProduct.name}</span>
                            <span>Rp {currentProduct.price.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center justify-between text-gray-500">
                            <span>Jumlah</span>
                            <span>{formData.quantity} pcs</span>
                          </div>
                          <div className="border-t border-gray-200 pt-3 flex items-center justify-between">
                            <span className="font-black text-gray-900">Total bayar</span>
                            <span className="text-lg font-black text-blue-600">Rp {(currentProduct.price * formData.quantity).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <button 
                      disabled={submitting || !currentProduct}
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
                      <p className="font-bold text-lg">{selectedOrder.productName || getOrderProduct(selectedOrder)?.name || 'Produk'}</p>
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
