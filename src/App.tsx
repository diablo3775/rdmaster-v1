import * as React from 'react';
import { useState, useEffect, ErrorInfo, ReactNode, useRef } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  doc, 
  setDoc, 
  getDoc,
  getDocs,
  orderBy,
  writeBatch,
  deleteDoc
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { db, auth } from './firebase';
import { RDAccount, AppMode, DefaulterFilterParams } from './types';
import { cn, formatCurrency, calculateRD, calculateMaturityDate, formatDueDate, checkDueAlert, handleFirestoreError, OperationType, sleep } from './lib/utils';
import { Search, User as UserIcon, LogIn, LogOut, ArrowLeft, FileText, Package, X, AlertCircle, Upload, Loader2, Calendar, ImageOff, Image as ImageIcon, GripHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { seedAccounts } from './seed';
import Papa from 'papaparse';
import { DefaultersPaidDateModal } from './components/DefaultersPaidDateModal';
import { DefaultersListView } from './components/DefaultersListView';
import { NoPhotosListModal } from './components/NoPhotosListModal';

const provider = new GoogleAuthProvider();

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    const state = (this as any).state;
    if (state.hasError) {
      let message = "Something went wrong.";
      try {
        const parsed = JSON.parse(state.error?.message || "");
        if (parsed.error) message = `System Error: ${parsed.error}`;
      } catch {
        message = state.error?.message || message;
      }

      return (
        <div className="min-h-screen bg-[#005a8c] flex items-center justify-center p-4 text-white font-mono">
          <div className="bg-red-900/50 border-2 border-red-500 p-8 max-w-2xl w-full shadow-[8px_8px_0px_#000]">
            <div className="flex items-center gap-4 mb-4 text-red-400">
              <AlertCircle size={48} />
              <h1 className="text-2xl font-bold">SYSTEM HALTED</h1>
            </div>
            <p className="mb-6 text-red-200">{message}</p>
            <button 
              onClick={() => window.location.reload()}
              className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 font-bold shadow-[2px_2px_0px_#000]"
            >
              REBOOT SYSTEM
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

interface ReportInputCellProps {
  acc: RDAccount;
  idx: number;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, col: string, rowIdx: number) => void;
  checkReportLimit: (reportNum: number, amount: number, currentAccountId: string) => boolean;
  updateAccount: (acc: RDAccount) => Promise<void>;
  handleReportBlur: () => void;
  setAlertModal: (modal: { title: string; message: string } | null) => void;
}

const ReportInputCell: React.FC<ReportInputCellProps> = ({
  acc,
  idx,
  handleKeyDown,
  checkReportLimit,
  updateAccount,
  handleReportBlur,
  setAlertModal,
}) => {
  const currentAssigned = acc.manualReport || 0;
  const [val, setVal] = useState<string>(String(currentAssigned));
  const [isFocused, setIsFocused] = useState(false);
  const isCommittingRef = useRef(false);

  // Sync external changes (e.g. from Auto-Pack or Reset) when not actively editing
  useEffect(() => {
    if (!isFocused) {
      setVal(String(acc.manualReport || 0));
    }
  }, [acc.manualReport, isFocused]);

  const commitValue = async (candidateValue: string) => {
    if (isCommittingRef.current) return;
    isCommittingRef.current = true;
    try {
      const trimmed = candidateValue.trim();
      if (trimmed === '') {
        if ((acc.manualReport || 0) !== 0) {
          await updateAccount({ ...acc, manualReport: 0 });
          handleReportBlur();
        }
        setVal('0');
        return;
      }

      const reportNum = parseInt(trimmed, 10);
      if (isNaN(reportNum) || reportNum < 0 || reportNum > 99) {
        setAlertModal({ 
          title: "INVALID REPORT", 
          message: "Report number must be between 1 and 99." 
        });
        setVal(String(acc.manualReport || 0));
        return;
      }

      const existingReport = acc.manualReport || 0;
      if (reportNum === existingReport) {
        setVal(String(reportNum));
        handleReportBlur();
        return;
      }

      if (reportNum > 0) {
        const amount = acc.denomination * (acc.rd_ni || 1);
        if (!checkReportLimit(reportNum, amount, acc.id)) {
          setAlertModal({ 
            title: "LIMIT EXCEEDED", 
            message: `Report RT-${reportNum} has reached its 20,000.00 limit. Please assign to the next available report (RT-${reportNum + 1}).` 
          });
          setVal(String(existingReport));
          return;
        }
      }

      setVal(String(reportNum));
      await updateAccount({ ...acc, manualReport: reportNum });
      handleReportBlur();
    } finally {
      isCommittingRef.current = false;
    }
  };

  return (
    <input 
      type="number"
      min={0}
      max={99}
      className="w-10 text-center border-none bg-transparent outline-none font-bold"
      value={val}
      data-col="report"
      data-row={idx}
      onFocus={() => {
        setIsFocused(true);
      }}
      onBlur={async (e) => {
        setIsFocused(false);
        await commitValue(e.target.value);
      }}
      onKeyDown={async (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
          return;
        }
        handleKeyDown(e, 'report', idx);
      }}
      onClick={(e) => {
        e.stopPropagation();
        (e.target as HTMLInputElement).select();
      }}
      onChange={(e) => {
        setVal(e.target.value);
      }}
    />
  );
};

function RDApp() {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<AppMode>('START');
  const [accounts, setAccounts] = useState<RDAccount[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [persistentIds, setPersistentIds] = useState<string[]>([]);
  const [isViewListLoaded, setIsViewListLoaded] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<RDAccount | null>(null);
  const [lastActiveId, setLastActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [selectedPhotoURL, setSelectedPhotoURL] = useState<string | null>(null);
  const [searchMatches, setSearchMatches] = useState<RDAccount[] | null>(null);
  const [alertModal, setAlertModal] = useState<{ title: string; message: string } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [photoAccountNos, setPhotoAccountNos] = useState<Set<string>>(new Set());
  const [isDefaulterModalOpen, setIsDefaulterModalOpen] = useState(false);
  const [defaulterParams, setDefaulterParams] = useState<DefaulterFilterParams | null>(null);
  const [isNoPhotosModalOpen, setIsNoPhotosModalOpen] = useState(false);
  const [tablePhotoMap, setTablePhotoMap] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const bulkPhotoInputRef = useRef<HTMLInputElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const prevAccountCountRef = useRef(0);
  const [tableHeight, setTableHeight] = useState<number>(215); // Default ~5 rows visible
  const [isDraggingTable, setIsDraggingTable] = useState(false);
  const [summaryListCount, setSummaryListCount] = useState<number>(5); // Default 5 lists (rt-1 to rt-5)
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(215);

  const handleStartResize = (e: React.MouseEvent | React.TouchEvent) => {
    if ('touches' in e && e.cancelable) {
      e.preventDefault();
    }
    setIsDraggingTable(true);
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragStartYRef.current = clientY;
    dragStartHeightRef.current = tableHeight;

    const onMove = (moveEv: MouseEvent | TouchEvent) => {
      if ('touches' in moveEv && moveEv.cancelable) {
        moveEv.preventDefault();
      }
      const currentY = 'touches' in moveEv 
        ? (moveEv.touches[0]?.clientY ?? dragStartYRef.current) 
        : moveEv.clientY;
      const delta = currentY - dragStartYRef.current;
      const targetHeight = Math.max(160, Math.min(850, dragStartHeightRef.current + delta));
      setTableHeight(targetHeight);
    };

    const onEnd = () => {
      setIsDraggingTable(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
  };

  // Auto-scroll table to latest added account
  useEffect(() => {
    if (persistentIds.length > prevAccountCountRef.current) {
      setTimeout(() => {
        if (tableContainerRef.current) {
          tableContainerRef.current.scrollTo({
            top: tableContainerRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      }, 50);
    }
    prevAccountCountRef.current = persistentIds.length;
  }, [persistentIds]);

  // Fetch Photo for Selected Account
  useEffect(() => {
    if (!selectedAccount) {
      setSelectedPhotoURL(null);
      return;
    }

    const fetchPhoto = async () => {
      try {
        const photoDoc = await getDoc(doc(db, 'photos', selectedAccount.accountNo));
        if (photoDoc.exists()) {
          setSelectedPhotoURL(photoDoc.data().photoURL);
        } else {
          setSelectedPhotoURL(null);
        }
      } catch (error) {
        console.error("Error fetching photo:", error);
        setSelectedPhotoURL(null);
      }
    };

    fetchPhoto();
    setImgError(false);
  }, [selectedAccount]);

  // Fetch Photo Index Set
  const fetchPhotoIndex = async () => {
    try {
      const snap = await getDocs(collection(db, 'photos'));
      const set = new Set<string>();
      snap.docs.forEach((d) => {
        if (d.data()?.photoURL) set.add(d.id);
      });
      setPhotoAccountNos(set);
    } catch (e) {
      console.warn("Error fetching photo index:", e);
    }
  };

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        seedAccounts(); // Seed only after auth
        fetchPhotoIndex();
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch Accounts with Caching
  useEffect(() => {
    if (!user) return;
    
    const fetchAccounts = async () => {
      // 1. Try to load from cache first
      const cached = localStorage.getItem(`rd_accounts_${user.uid}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          setAccounts(parsed);
          setLoading(false);
          // We still check if we should refresh in the background or just trust the cache
          return;
        } catch (e) {
          console.error("Cache parse error", e);
        }
      }

      // 2. If no cache, fetch from Firestore (One-time getDocs)
      try {
        const path = 'accounts';
        const q = query(collection(db, path), orderBy('accountNo'));
        const snapshot = await getDocs(q);
        const accs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as RDAccount));
        
        setAccounts(accs);
        localStorage.setItem(`rd_accounts_${user.uid}`, JSON.stringify(accs));
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'accounts', auth);
      } finally {
        setLoading(false);
      }
    };

    fetchAccounts();
  }, [user]);

  // Fetch Last Active State
  useEffect(() => {
    if (!user) return;
    const fetchLastState = async () => {
      const path = 'settings/appState';
      try {
        const docRef = doc(db, 'settings', 'appState');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setLastActiveId(docSnap.data().lastActiveAccountId);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, path, auth);
      }
    };
    fetchLastState();
  }, [user]);

  // Persist View List (persistentIds)
  useEffect(() => {
    if (!user) return;
    const cached = localStorage.getItem(`rd_view_list_${user.uid}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setPersistentIds(parsed);
        }
      } catch (e) {
        console.error("View list parse error", e);
      }
    }
    setIsViewListLoaded(true);
  }, [user]);

  useEffect(() => {
    if (!user || !isViewListLoaded) return;
    localStorage.setItem(`rd_view_list_${user.uid}`, JSON.stringify(persistentIds));
  }, [persistentIds, user, isViewListLoaded]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = () => auth.signOut();

  const handleContinue = () => {
    if (lastActiveId) {
      const acc = accounts.find(a => a.id === lastActiveId);
      if (acc) {
        setSelectedAccount(acc);
        setMode('MAIN');
      } else {
        setMode('MAIN');
      }
    } else {
      setMode('MAIN');
    }
  };

  const handleNew = () => {
    setSelectedAccount(null);
    setMode('MAIN');
  };

  const handleResetDatabase = async () => {
    setConfirmModal({
      title: "DELETE ALL ACCOUNTS",
      message: "WARNING: This will permanently delete ALL accounts. Your photo library is stored separately and will NOT be deleted. Proceed?",
      onConfirm: async () => {
        setConfirmModal(null);
        setImporting(true);
        try {
          const path = 'accounts';
          const snapshot = await getDocs(collection(db, path));
          const docs = snapshot.docs;
          
          if (docs.length === 0) {
            setAlertModal({ title: "INFO", message: "Database is already empty." });
            return;
          }

          const chunkSize = 400;
          for (let i = 0; i < docs.length; i += chunkSize) {
            const chunk = docs.slice(i, i + chunkSize);
            const batch = writeBatch(db);
            chunk.forEach((doc) => {
              batch.delete(doc.ref);
            });
            await batch.commit();
            await sleep(200);
          }

          // Clear cache
          if (user) localStorage.removeItem(`rd_accounts_${user.uid}`);
          setAccounts([]);
          
          setAlertModal({ title: "SUCCESS", message: `Database has been cleared successfully. Deleted ${docs.length} records.` });
          setPersistentIds([]);
          setSelectedAccount(null);
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'accounts', auth);
        } finally {
          setImporting(false);
        }
      }
    });
  };

  const handleSelectAccount = async (acc: RDAccount) => {
    setSelectedAccount(acc);
    setLastActiveId(acc.id);
    const path = 'settings/appState';
    try {
      await setDoc(doc(db, 'settings', 'appState'), {
        lastActiveAccountId: acc.id,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path, auth);
    }
  };

  const [isDragging, setIsDragging] = useState(false);

  const resizeImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Max dimensions for profile photo
          const MAX_WIDTH = 300;
          const MAX_HEIGHT = 400;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          // Convert to low-quality JPEG to save space
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = async (file: File, account: RDAccount) => {
    setUploading(true);
    try {
      const base64 = await resizeImage(file);
      // Save to separate photos collection
      await setDoc(doc(db, 'photos', account.accountNo), {
        photoURL: base64,
        updatedAt: new Date().toISOString()
      });
      setSelectedPhotoURL(base64);
      setPhotoAccountNos(prev => new Set(prev).add(account.accountNo));
      setTablePhotoMap(prev => ({ ...prev, [account.accountNo]: base64 }));
      setImgError(false);
    } catch (error) {
      console.error("Error uploading image:", error);
      setAlertModal({ title: "ERROR", message: "Failed to process image." });
    } finally {
      setUploading(false);
    }
  };

  const handleMultipleImagesUpload = async (files: FileList) => {
    setUploading(true);
    let successCount = 0;
    try {
      const filesArray = Array.from(files);
      const chunkSize = 50; // Smaller chunks for large base64 strings
      const uploadedNos: string[] = [];
      
      for (let i = 0; i < filesArray.length; i += chunkSize) {
        const chunk = filesArray.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        let batchHasOperations = false;

        for (const file of chunk) {
          const accountNo = file.name.split('.')[0];
          // We don't necessarily need the account to exist in Firestore yet
          // because photos are now independent and linked by accountNo
          const base64 = await resizeImage(file);
          batch.set(doc(db, 'photos', accountNo), { 
            photoURL: base64,
            updatedAt: new Date().toISOString()
          });
          uploadedNos.push(accountNo);
          successCount++;
          batchHasOperations = true;
        }

        if (batchHasOperations) {
          await batch.commit();
          // Longer delay for large image batches
          await sleep(500);
        }
      }

      if (uploadedNos.length > 0) {
        setPhotoAccountNos(prev => {
          const next = new Set(prev);
          uploadedNos.forEach(no => next.add(no));
          return next;
        });
      }

      if (successCount > 0) {
        setAlertModal({ title: "SUCCESS", message: `Successfully processed ${successCount} images to the photo library.` });
      } else {
        setAlertModal({ title: "INFO", message: "No images were processed." });
      }
    } catch (error) {
      console.error("Error uploading multiple images:", error);
      setAlertModal({ title: "ERROR", message: "Error during multiple image processing. Some images may have failed." });
    } finally {
      setUploading(false);
      if (bulkPhotoInputRef.current) bulkPhotoInputRef.current.value = '';
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      try {
        const lines = text.split(/\r?\n/);
        const accountsToImport: any[] = [];
        let isDataSection = false;

        for (let line of lines) {
          line = line.trim();
          
          // Detect start of data section
          if (line.includes('Account No') && line.includes('Account Name')) {
            isDataSection = true;
            continue;
          }

          // Detect end of data section
          if (line.includes('Additional Information') || line === '') {
            if (isDataSection && accountsToImport.length > 0) {
               // If we were in data section and hit an empty line, we might be done or just a gap
               // But usually "Additional Information" is the hard stop
            }
            if (line.includes('Additional Information')) isDataSection = false;
            continue;
          }

          if (isDataSection) {
            // Split by tabs or multiple spaces
            const parts = line.split(/\t| {2,}/).map(p => p.trim()).filter(p => p !== '');
            
            // Expected parts: [Index, AccountNo, Name, Denom, MonthPaid, DueDate]
            // Sometimes Index might be missing if line starts with AccountNo
            // Based on the example: "1	020001559958	G TATARAONAIDU	1,000.00 Cr.	63	20-Apr-2026"
            if (parts.length >= 5) {
              let accNo, name, denomStr, monthPaid, dueDate;
              
              if (/^\d+$/.test(parts[0]) && parts[1].length >= 10) {
                // Standard format with index
                accNo = parts[1];
                name = parts[2];
                denomStr = parts[3];
                monthPaid = parts[4];
                dueDate = parts[5] || null;
              } else if (parts[0].length >= 10) {
                // Format without index
                accNo = parts[0];
                name = parts[1];
                denomStr = parts[2];
                monthPaid = parts[3];
                dueDate = parts[4] || null;
              }

              if (accNo) {
                accountsToImport.push({
                  accountNo: accNo,
                  name: name,
                  denomination: parseFloat(denomStr.replace(/[^0-9.]/g, '')),
                  monthPaidUpto: parseInt(monthPaid),
                  nextDueDate: dueDate === ' ' ? null : dueDate,
                  rd_ni: 1,
                  manualReport: 0
                });
              }
            }
          }
        }

        if (accountsToImport.length > 0) {
          // Firestore batch limit is 500 operations. Split into chunks.
          const chunkSize = 400;
          for (let i = 0; i < accountsToImport.length; i += chunkSize) {
            const chunk = accountsToImport.slice(i, i + chunkSize);
            const batch = writeBatch(db);
            chunk.forEach((acc) => {
              const newDocRef = doc(collection(db, 'accounts'));
              batch.set(newDocRef, acc);
            });
            await batch.commit();
            await sleep(200);
          }
          
          // Refresh local cache
          if (user) {
            const q = query(collection(db, 'accounts'), orderBy('accountNo'));
            const snapshot = await getDocs(q);
            const allAccs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as RDAccount));
            setAccounts(allAccs);
            localStorage.setItem(`rd_accounts_${user.uid}`, JSON.stringify(allAccs));
          }

          setAlertModal({ title: "SUCCESS", message: `Successfully imported ${accountsToImport.length} accounts. Photos will be automatically linked.` });
        } else {
          setAlertModal({ title: "INFO", message: "No valid account data found in the file. Please ensure it matches the report format." });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'accounts', auth);
      } finally {
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleRefreshData = async () => {
    if (!user) return;
    setImporting(true);
    try {
      const q = query(collection(db, 'accounts'), orderBy('accountNo'));
      const snapshot = await getDocs(q);
      const accs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as RDAccount));
      setAccounts(accs);
      localStorage.setItem(`rd_accounts_${user.uid}`, JSON.stringify(accs));
      setAlertModal({ title: "SUCCESS", message: "Account list synchronized with server." });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'accounts', auth);
    } finally {
      setImporting(false);
    }
  };

  const updateAccount = async (updatedAcc: RDAccount) => {
    if (!user) return;
    try {
      // 1. Update local state
      const newAccounts = accounts.map(a => a.id === updatedAcc.id ? updatedAcc : a);
      setAccounts(newAccounts);
      
      // 2. Update cache
      localStorage.setItem(`rd_accounts_${user.uid}`, JSON.stringify(newAccounts));
      
      // 3. Update Firestore
      await setDoc(doc(db, 'accounts', updatedAcc.id), updatedAcc);
      
      // 4. Update selected account if it's the same one
      if (selectedAccount?.id === updatedAcc.id) {
        setSelectedAccount(updatedAcc);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `accounts/${updatedAcc.id}`, auth);
    }
  };

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    const query = val.trim();
    if (query.length === 4) {
      // Try exact end match first (standard shortcut)
      let matches = accounts.filter(acc => acc.accountNo.endsWith(query));
      
      // If no end match, try general includes
      if (matches.length === 0) {
        matches = accounts.filter(acc => acc.accountNo.includes(query));
      }

      if (matches.length === 1) {
        const acc = matches[0];
        setPersistentIds(prev => {
          const otherIds = prev.filter(id => id !== acc.id);
          return [...otherIds, acc.id];
        });
        handleSelectAccount(acc);
        setSearchQuery('');
        setTimeout(() => {
          if (tableContainerRef.current) {
            tableContainerRef.current.scrollTo({
              top: tableContainerRef.current.scrollHeight,
              behavior: 'smooth'
            });
          }
        }, 50);
      } else if (matches.length > 1) {
        setSearchMatches(matches);
      } else {
        // Optional: feedback for no match
        console.log("No account found matching:", query);
      }
    }
  };

  const handlePickAccount = (acc: RDAccount) => {
    setPersistentIds(prev => {
      const otherIds = prev.filter(id => id !== acc.id);
      return [...otherIds, acc.id];
    });
    handleSelectAccount(acc);
    setSearchMatches(null);
    setSearchQuery('');
    setTimeout(() => {
      if (tableContainerRef.current) {
        tableContainerRef.current.scrollTo({
          top: tableContainerRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }
    }, 50);
  };

  const sortIdsByReport = (ids: string[], accList: RDAccount[] = accounts): string[] => {
    const list = ids
      .map(id => accList.find(a => a.id === id))
      .filter((a): a is RDAccount => !!a);
    
    list.sort((a, b) => {
      const repA = Math.floor(a.manualReport || 0);
      const repB = Math.floor(b.manualReport || 0);
      // Both assigned to reports: sort ascending by numeric report order (1, 2, 3...)
      if (repA > 0 && repB > 0) return repA - repB;
      // Assigned reports come first in serial order
      if (repA > 0) return -1;
      if (repB > 0) return 1;
      return 0;
    });
    return list.map(a => a.id);
  };

  const handleSortByReport = () => {
    setPersistentIds(prev => sortIdsByReport(prev));
  };

  const handleReportBlur = () => {
    setPersistentIds(prev => sortIdsByReport(prev));
  };

  const handlePack = async () => {
    if (!user || filteredAccounts.length === 0) {
      setAlertModal({ title: "INFO", message: "No accounts in the list to pack." });
      return;
    }

    try {
      let currentReport = 1;
      let currentTotal = 0;
      const updatedAccountsList: RDAccount[] = [];

      for (const acc of filteredAccounts) {
        const amount = acc.denomination * (acc.rd_ni || 1);
        
        // If adding this account exceeds the 20,000 limit, move to the next report
        if (currentTotal > 0 && (currentTotal + amount) > 20000) {
          currentReport += 1;
          currentTotal = 0;
        }

        const updated = { ...acc, manualReport: currentReport };
        updatedAccountsList.push(updated);
        currentTotal += amount;
      }

      // Batch write to Firestore
      const batch = writeBatch(db);
      updatedAccountsList.forEach(acc => {
        batch.set(doc(db, 'accounts', acc.id), acc);
      });
      await batch.commit();

      // Update state and cache
      const updatedMap = new Map(updatedAccountsList.map(a => [a.id, a]));
      const newAccounts = accounts.map(a => updatedMap.get(a.id) || a);
      setAccounts(newAccounts);
      localStorage.setItem(`rd_accounts_${user.uid}`, JSON.stringify(newAccounts));

      // Reorder persistentIds strictly in serial numeric order
      const newIds = updatedAccountsList.map(a => a.id);
      setPersistentIds(newIds);

      setAlertModal({ 
        title: "PACK COMPLETE", 
        message: `Successfully packed ${updatedAccountsList.length} accounts into ${currentReport} reports (RT-1 to RT-${currentReport}) in serial numeric order.` 
      });
    } catch (error) {
      console.error("Pack error:", error);
      setAlertModal({ title: "ERROR", message: "Failed to pack accounts." });
    }
  };

  const filteredAccounts = persistentIds
    .map(id => accounts.find(a => a.id === id))
    .filter((a): a is RDAccount => !!a);

  // Keep persistentIds in serial numeric report order when accounts change
  useEffect(() => {
    if (accounts.length > 0 && persistentIds.length > 0) {
      const hasAssignedReports = persistentIds.some(id => {
        const acc = accounts.find(a => a.id === id);
        return acc && (acc.manualReport || 0) > 0;
      });
      if (hasAssignedReports) {
        setPersistentIds(prev => {
          const sorted = sortIdsByReport(prev, accounts);
          const isIdentical = prev.length === sorted.length && prev.every((id, i) => id === sorted[i]);
          return isIdentical ? prev : sorted;
        });
      }
    }
  }, [accounts]);

  // Fetch Photos for Accounts displayed in the Table
  useEffect(() => {
    let isMounted = true;
    const fetchTablePhotos = async () => {
      const needed = filteredAccounts.filter(acc => !tablePhotoMap[acc.accountNo]);
      if (needed.length === 0) return;

      const newEntries: Record<string, string> = {};
      await Promise.all(
        needed.map(async (acc) => {
          try {
            const snap = await getDoc(doc(db, 'photos', acc.accountNo));
            if (snap.exists() && snap.data().photoURL) {
              newEntries[acc.accountNo] = snap.data().photoURL;
            }
          } catch (e) {
            // ignore
          }
        })
      );

      if (isMounted && Object.keys(newEntries).length > 0) {
        setTablePhotoMap(prev => ({ ...prev, ...newEntries }));
      }
    };

    fetchTablePhotos();
    return () => { isMounted = false; };
  }, [filteredAccounts, tablePhotoMap]);

  const getReportSummary = (accs: RDAccount[]) => {
    const highestAssigned = accs.reduce((max, acc) => Math.max(max, Math.floor(acc.manualReport || 0)), 0);
    const totalReports = Math.max(summaryListCount, highestAssigned);
    const reports: { total: number; count: number }[] = Array(totalReports).fill(null).map(() => ({ total: 0, count: 0 }));
    let unallocatedTotal = 0;
    let unallocatedCount = 0;
    
    accs.forEach(acc => {
      const reportNum = Math.floor(acc.manualReport || 0);
      const amount = acc.denomination * (acc.rd_ni || 1);
      
      if (reportNum >= 1 && reportNum <= totalReports) {
        reports[reportNum - 1].total += amount;
        reports[reportNum - 1].count++;
      } else if (reportNum > totalReports) {
        while (reports.length < reportNum) {
          reports.push({ total: 0, count: 0 });
        }
        reports[reportNum - 1].total += amount;
        reports[reportNum - 1].count++;
      } else {
        unallocatedTotal += amount;
        unallocatedCount++;
      }
    });
    
    return { reports, unallocatedTotal, unallocatedCount };
  };

  const handleDownloadReports = () => {
    if (filteredAccounts.length === 0) {
      setAlertModal({ title: "INFO", message: "No accounts in the list to generate reports." });
      return;
    }

    const today = new Date();
    const dateStr = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
    
    // Group accounts by report number in ascending order
    const grouped: { [key: number]: RDAccount[] } = {};
    filteredAccounts.forEach(acc => {
      const rNum = Math.floor(acc.manualReport || 0);
      if (rNum > 0) {
        if (!grouped[rNum]) grouped[rNum] = [];
        grouped[rNum].push(acc);
      }
    });

    const reportNumbers = Object.keys(grouped).map(Number).sort((a, b) => a - b);
    
    if (reportNumbers.length === 0) {
      setAlertModal({ title: "INFO", message: "No accounts assigned to any report (RT-1, RT-2, etc.)." });
      return;
    }

    let fullContent = "";

    reportNumbers.forEach((rNum, index) => {
      const accs = grouped[rNum];
      
      // Column width formatters: NI column right after A/c No, Rd_disc and Rd_pf removed
      const col = {
        sno: (val: string) => val.padStart(3, ' '),
        acNo: (val: string) => val.padEnd(14, ' '),
        ni: (val: string) => val.padStart(3, ' '),
        name: (val: string) => (val.length > 18 ? val.substring(0, 18) : val).padEnd(18, ' '),
        deno: (val: string) => val.padStart(9, ' '),
      };

      const headerLine = `${col.sno("SNo")}  ${col.acNo("A/c No")}  ${col.ni("NI")}  ${col.name("Name")}  ${col.deno("Deno")}`;
      const separator = "-".repeat(headerLine.length);

      let reportContent = `RD Transactions Report    Dated ${dateStr} (RT-${rNum})\n`;
      reportContent += `${separator}\n`;
      reportContent += `${headerLine}\n`;
      reportContent += `${separator}\n`;

      let totalAmount = 0;
      accs.forEach((acc, i) => {
        const amount = acc.denomination * (acc.rd_ni || 1);
        totalAmount += amount;
        
        const sno = col.sno(String(i + 1));
        const acNo = col.acNo(acc.accountNo);
        const ni = col.ni(String(acc.rd_ni || 1));
        const name = col.name(acc.name);
        const deno = col.deno(amount.toFixed(2));

        reportContent += `${sno}  ${acNo}  ${ni}  ${name}  ${deno}\n\n`;
      });

      // Align 'T o t a l' with the Deno column
      // Length before Deno column: 3 + 2 + 14 + 2 + 3 + 2 + 18 + 2 = 44 characters
      const totalPrefix = " ".repeat(33) + "T o t a l  ";
      reportContent += `${totalPrefix}${col.deno(totalAmount.toFixed(2))}\n`;
      reportContent += `${separator}\n`;
      
      // Bottom account numbers: 2 accounts per line
      const formattedAccountNos = accs.map(acc => acc.accountNo.trim());
      const accountLines: string[] = [];
      for (let i = 0; i < formattedAccountNos.length; i += 2) {
        if (i + 1 < formattedAccountNos.length) {
          const isLast = (i + 2 >= formattedAccountNos.length);
          accountLines.push(`${formattedAccountNos[i]},${formattedAccountNos[i + 1]}${isLast ? '' : ','}`);
        } else {
          accountLines.push(formattedAccountNos[i]);
        }
      }
      
      reportContent += `${accountLines.join('\n')}\n\n`;
      
      if (index < reportNumbers.length - 1) {
        reportContent += "\n" + "=".repeat(headerLine.length) + "\n\n";
      }
      
      fullContent += reportContent;
    });

    const blob = new Blob([fullContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `RD_Reports_${dateStr}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const checkReportLimit = (reportNum: number, amount: number, currentAccountId: string) => {
    if (reportNum <= 0) return true;
    const currentTotal = filteredAccounts
      .filter(acc => acc.id !== currentAccountId && Math.floor(acc.manualReport || 0) === reportNum)
      .reduce((sum, acc) => sum + (acc.denomination * (acc.rd_ni || 1)), 0);
    
    return (currentTotal + amount) <= 20000;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, col: string, rowIdx: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      const nextIdx = rowIdx + 1;
      if (nextIdx < filteredAccounts.length) {
        const nextAcc = filteredAccounts[nextIdx];
        handleSelectAccount(nextAcc);
        const next = document.querySelector(`input[data-col="${col}"][data-row="${nextIdx}"]`) as HTMLInputElement;
        if (next) {
          next.focus();
          next.select();
        }
        const rowEl = document.getElementById(`account-row-${nextAcc.id}`);
        if (rowEl) {
          rowEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const prevIdx = rowIdx - 1;
      if (prevIdx >= 0) {
        const prevAcc = filteredAccounts[prevIdx];
        handleSelectAccount(prevAcc);
        const prev = document.querySelector(`input[data-col="${col}"][data-row="${prevIdx}"]`) as HTMLInputElement;
        if (prev) {
          prev.focus();
          prev.select();
        }
        const rowEl = document.getElementById(`account-row-${prevAcc.id}`);
        if (rowEl) {
          rowEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    } else if (e.key === 'ArrowRight' && col === 'rd_ni') {
      e.preventDefault();
      e.stopPropagation();
      const nextCell = document.querySelector(`input[data-col="report"][data-row="${rowIdx}"]`) as HTMLInputElement;
      if (nextCell) {
        nextCell.focus();
        nextCell.select();
      }
    } else if (e.key === 'ArrowLeft' && col === 'report') {
      e.preventDefault();
      e.stopPropagation();
      const prevCell = document.querySelector(`input[data-col="rd_ni"][data-row="${rowIdx}"]`) as HTMLInputElement;
      if (prevCell) {
        prevCell.focus();
        prevCell.select();
      }
    }
  };

  // Global Up/Down Arrow row navigation when a row is selected or focused
  useEffect(() => {
    if (mode !== 'MAIN') return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Skip if user is inside an input/textarea/select or inside a table row (handled by component events)
      if (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.tagName === 'SELECT' ||
        target.tagName === 'TR' ||
        target.closest('tr')
      ) {
        return;
      }

      if (alertModal || confirmModal || isDefaulterModalOpen || isNoPhotosModalOpen || searchMatches) {
        return;
      }

      if (filteredAccounts.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const currentIdx = filteredAccounts.findIndex(a => a.id === selectedAccount?.id);
        const nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, filteredAccounts.length - 1);
        const targetAcc = filteredAccounts[nextIdx];
        if (targetAcc) {
          handleSelectAccount(targetAcc);
          const rowEl = document.getElementById(`account-row-${targetAcc.id}`);
          if (rowEl) {
            rowEl.focus();
            rowEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const currentIdx = filteredAccounts.findIndex(a => a.id === selectedAccount?.id);
        const prevIdx = currentIdx < 0 ? filteredAccounts.length - 1 : Math.max(currentIdx - 1, 0);
        const targetAcc = filteredAccounts[prevIdx];
        if (targetAcc) {
          handleSelectAccount(targetAcc);
          const rowEl = document.getElementById(`account-row-${targetAcc.id}`);
          if (rowEl) {
            rowEl.focus();
            rowEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [mode, filteredAccounts, selectedAccount, alertModal, confirmModal, isDefaulterModalOpen, isNoPhotosModalOpen, searchMatches]);

  const summary = getReportSummary(filteredAccounts);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#005a8c] flex items-center justify-center text-white font-mono">
        <div className="text-xl animate-pulse">LOADING SYSTEM...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#005a8c] flex items-center justify-center p-4">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-[#c0d9e9] border-2 border-white shadow-[4px_4px_0px_#000] p-8 max-w-md w-full text-center"
        >
          <h1 className="text-2xl font-bold text-[#005a8c] mb-6 border-b-2 border-[#005a8c] pb-2">RD TRANSACTIONS</h1>
          <p className="text-[#005a8c] mb-8 font-medium">PLEASE LOGIN TO ACCESS THE BANKING SYSTEM</p>
          <button 
            onClick={handleLogin}
            className="flex items-center justify-center gap-2 w-full bg-[#005a8c] text-white py-3 px-6 font-bold hover:bg-[#004a75] transition-colors shadow-[2px_2px_0px_#000]"
          >
            <LogIn size={20} />
            GOOGLE LOGIN
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#005a8c] font-sans text-[#141414]">
      <AnimatePresence mode="wait">
        {mode === 'START' && (
          <motion.div 
            key="start"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center z-50 p-4"
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files) handleMultipleImagesUpload(e.dataTransfer.files);
            }}
          >
            <div className={cn(
              "bg-[#c0d9e9] border-2 border-white shadow-[8px_8px_0px_#000] p-6 sm:p-10 w-full max-w-lg transition-all",
              isDragging ? "scale-105 border-blue-500 bg-blue-100" : ""
            )}>
              {isDragging && (
                <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center pointer-events-none">
                  <div className="bg-white p-4 border-2 border-dashed border-blue-500 font-bold text-blue-600 animate-bounce">
                    DROP PHOTOS HERE TO UPLOAD
                  </div>
                </div>
              )}
              <div className="bg-[#004a75] text-white p-3 mb-8 text-sm font-bold border-b border-white flex justify-between items-center">
                <span>RD TRANSACTIONS SYSTEM</span>
                <span className="text-[10px] opacity-70">v2.0.0</span>
              </div>
              
              <div className="grid grid-cols-1 gap-3.5">
                <button 
                  onClick={() => setMode('MAIN')}
                  className="bg-white border-2 border-black p-3.5 font-bold shadow-[4px_4px_0px_#000] hover:bg-gray-100 flex items-center justify-center gap-3 group transition-all"
                >
                  <ArrowLeft className="rotate-180 group-hover:translate-x-1 transition-transform" />
                  OPEN DASHBOARD
                </button>

                <button 
                  onClick={() => setIsDefaulterModalOpen(true)}
                  className="bg-[#ffe79a] border-2 border-black p-3.5 font-bold shadow-[4px_4px_0px_#000] hover:bg-[#ffde7a] text-[#002f52] flex items-center justify-center gap-3 transition-all"
                >
                  <Calendar className="text-[#004a75]" size={19} />
                  FINANCIAL DEFAULTERS PAID DATE
                </button>

                <button 
                  onClick={() => {
                    fetchPhotoIndex();
                    setIsNoPhotosModalOpen(true);
                  }}
                  className="bg-[#fed7d7] border-2 border-black p-3.5 font-bold shadow-[4px_4px_0px_#000] hover:bg-[#fca5a5] text-[#742a2a] flex items-center justify-center gap-3 transition-all"
                >
                  <ImageOff size={19} />
                  NO PHOTOS LIST ACCOUNTS
                </button>

                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  className="bg-[#8ebce0] border-2 border-black p-3.5 font-bold shadow-[4px_4px_0px_#000] hover:bg-[#7daed4] flex items-center justify-center gap-3 disabled:opacity-50"
                >
                  {importing ? <Loader2 className="animate-spin" /> : <Upload />}
                  IMPORT ACCOUNT DATA (.TXT)
                </button>

                <button 
                  onClick={() => bulkPhotoInputRef.current?.click()}
                  disabled={uploading}
                  className="bg-[#8ebce0] border-2 border-black p-3.5 font-bold shadow-[4px_4px_0px_#000] hover:bg-[#7daed4] flex items-center justify-center gap-3 disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="animate-spin" /> : <Package />}
                  BULK UPLOAD PHOTOS (DROP/SELECT)
                </button>

                <div className="mt-4 pt-4 border-t border-black/10 flex justify-between items-center">
                  <div className="flex flex-col gap-1">
                    <button 
                      onClick={handleNew}
                      className="text-xs font-bold hover:underline text-left"
                    >
                      + CREATE NEW ACCOUNT
                    </button>
                    <button 
                      onClick={handleResetDatabase}
                      className="text-xs font-bold text-orange-700 hover:underline text-left"
                    >
                      ⚠ DELETE ALL ACCOUNTS
                    </button>
                    <button 
                      onClick={handleRefreshData}
                      className="text-xs font-bold text-green-700 hover:underline text-left"
                    >
                      🔄 SYNC DATA FROM SERVER
                    </button>
                  </div>
                  <button 
                    onClick={() => window.close()}
                    className="text-xs font-bold text-red-700 hover:underline"
                  >
                    EXIT SYSTEM
                  </button>
                </div>
              </div>

              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept=".txt" 
                onChange={handleFileUpload}
              />
              <input 
                type="file" 
                ref={bulkPhotoInputRef} 
                className="hidden" 
                multiple
                accept="image/*" 
                onChange={(e) => e.target.files && handleMultipleImagesUpload(e.target.files)}
              />
              <input 
                type="file" 
                ref={photoInputRef} 
                className="hidden" 
                accept="image/*" 
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && selectedAccount) handleImageUpload(file, selectedAccount);
                }}
              />
            </div>
          </motion.div>
        )}

        {mode === 'MAIN' && (
          <motion.div 
            key="main"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-2 sm:p-4 max-w-[1400px] mx-auto"
          >
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mb-4 sm:mb-6 text-white border-b border-white/20 pb-3 sm:pb-4">
              <div className="flex items-center gap-3 sm:gap-4">
                <button onClick={() => setMode('START')} className="hover:text-blue-200"><ArrowLeft size={20} /></button>
                <h1 className="text-lg sm:text-2xl font-bold tracking-tighter whitespace-nowrap">R D Transactions</h1>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 text-xs sm:text-sm w-full sm:w-auto justify-between sm:justify-end">
                <button
                  onClick={() => setIsDefaulterModalOpen(true)}
                  className="bg-[#ffe79a] text-[#002f52] px-2 py-1 rounded font-bold hover:bg-[#ffde7a] flex items-center gap-1 shadow-sm transition-colors text-[11px] sm:text-xs"
                >
                  <Calendar size={12} />
                  Defaulters Paid-Date
                </button>
                <button
                  onClick={() => {
                    fetchPhotoIndex();
                    setIsNoPhotosModalOpen(true);
                  }}
                  className="bg-[#fed7d7] text-[#742a2a] px-2 py-1 rounded font-bold hover:bg-[#fca5a5] flex items-center gap-1 shadow-sm transition-colors text-[11px] sm:text-xs"
                >
                  <ImageOff size={12} />
                  No Photos ({accounts.filter(a => !photoAccountNos.has(a.accountNo)).length})
                </button>
                <span className="opacity-80 hidden md:inline text-xs">{new Date().toLocaleString()}</span>
                <div className="flex items-center gap-1.5 bg-white/10 px-2 py-1 rounded text-xs">
                  <UserIcon size={12} />
                  <span className="truncate max-w-[100px] sm:max-w-[150px]">{user.email}</span>
                </div>
                <button onClick={handleLogout} title="Logout" className="hover:text-red-300 p-1"><LogOut size={16} /></button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
              {/* Left Panel: Account List */}
              <div className={cn("space-y-4 sm:space-y-6 transition-all duration-300", showSummary ? "lg:col-span-10" : "lg:col-span-12")}>
                <div className="bg-white/95 backdrop-blur shadow-[4px_4px_0px_#000] overflow-hidden">
                  <div className="bg-[#004a75] text-white p-2.5 sm:p-3 flex justify-between items-center">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <span className="font-bold text-xs sm:text-sm">Deposit Accounts List</span>
                      <button 
                        onClick={() => {
                          setConfirmModal({
                            title: "CLEAR LIST",
                            message: "Clear all accounts from the current view?",
                            onConfirm: () => {
                              setPersistentIds([]);
                              setSelectedAccount(null);
                              setConfirmModal(null);
                            }
                          });
                        }}
                        className="text-[10px] bg-red-600 hover:bg-red-700 px-2 py-0.5 rounded uppercase font-bold"
                      >
                        Clear List
                      </button>
                    </div>
                  </div>
                  
                  <div 
                    ref={tableContainerRef} 
                    style={{ height: `${tableHeight}px` }} 
                    className="overflow-auto border-b border-gray-200"
                  >
                    <table className="w-full text-sm text-left border-collapse">
                      <thead className="bg-gray-100 sticky top-0 z-10 whitespace-nowrap shadow-xs">
                        <tr className="h-8">
                          <th className="p-1 border text-[14px] text-center w-8">Slno</th>
                          <th className="p-1 border text-[14px] text-center w-9">Photo</th>
                          <th className="p-1 border text-[14px]">Account_no</th>
                          <th className="p-1 border text-[14px]">Rd_ni</th>
                          <th className="p-1 border text-[14px]">Rd_name</th>
                          <th className="p-1 border text-[14px]">Denom</th>
                          <th className="p-1 border text-[14px] whitespace-nowrap">-Due-Date-</th>
                          <th 
                            className="p-1 border text-[14px] cursor-pointer hover:bg-gray-200 select-none transition-colors text-center whitespace-nowrap"
                            onClick={handleSortByReport}
                            title="Click to sort by rt in serial numeric order"
                          >
                            rt ⇅
                          </th>
                          <th className="p-1 border text-[14px]">Del</th>
                          <th className="p-1 border text-[14px] whitespace-nowrap text-red-600 font-bold">Alert</th>
                          <th className="p-1 border text-[14px]">Rd_bbt</th>
                          <th className="p-1 border text-[14px]">Rd_tdpf</th>
                          <th className="p-1 border text-[14px]">Rd_mp</th>
                          <th className="p-1 border text-[14px]">Rd_bat</th>
                          <th className="p-1 border text-[14px]">C58</th>
                          <th className="p-1 border text-[14px] whitespace-nowrap">Dt_of_mat</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAccounts.map((acc, idx) => {
                          const calc = calculateRD(acc.denomination, acc.rd_ni || 1, acc.monthPaidUpto);
                          const matDate = calculateMaturityDate(acc.nextDueDate, acc.monthPaidUpto);
                          const alertInfo = checkDueAlert(acc.nextDueDate);
                          const photo = tablePhotoMap[acc.accountNo];
                          return (
                            <tr 
                              key={acc.id}
                              id={`account-row-${acc.id}`}
                              tabIndex={0}
                              onClick={() => handleSelectAccount(acc)}
                              onKeyDown={(e) => {
                                if (e.target !== e.currentTarget) return;
                                if (e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const nextIdx = idx + 1;
                                  if (nextIdx < filteredAccounts.length) {
                                    const nextAcc = filteredAccounts[nextIdx];
                                    handleSelectAccount(nextAcc);
                                    const nextEl = document.getElementById(`account-row-${nextAcc.id}`);
                                    if (nextEl) {
                                      nextEl.focus();
                                      nextEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                                    }
                                  }
                                } else if (e.key === 'ArrowUp') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const prevIdx = idx - 1;
                                  if (prevIdx >= 0) {
                                    const prevAcc = filteredAccounts[prevIdx];
                                    handleSelectAccount(prevAcc);
                                    const prevEl = document.getElementById(`account-row-${prevAcc.id}`);
                                    if (prevEl) {
                                      prevEl.focus();
                                      prevEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                                    }
                                  }
                                }
                              }}
                              className={cn(
                                "h-8 hover:bg-blue-50 cursor-pointer transition-colors text-[14px] outline-none focus:bg-blue-100",
                                selectedAccount?.id === acc.id ? "bg-blue-100 ring-1 ring-blue-400" : idx % 2 === 0 ? "bg-white" : "bg-gray-50"
                              )}
                            >
                              <td className="p-1 border text-center">{idx + 1}</td>
                              <td className="p-0.5 border text-center align-middle w-9">
                                <div className="w-6 h-6 mx-auto rounded overflow-hidden bg-gray-100 border border-gray-200 flex items-center justify-center">
                                  {photo ? (
                                    <img 
                                      src={photo} 
                                      alt={acc.name} 
                                      className="w-full h-full object-cover" 
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : (
                                    <UserIcon size={12} className="text-gray-400" />
                                  )}
                                </div>
                              </td>
                              <td className="p-1 border font-mono">{acc.accountNo}</td>
                              <td className="p-1 border text-center">
                                <input 
                                  type="number"
                                  className="w-8 text-center border-none bg-transparent outline-none font-bold"
                                  value={acc.rd_ni || 1}
                                  data-col="rd_ni"
                                  data-row={idx}
                                  onKeyDown={(e) => handleKeyDown(e, 'rd_ni', idx)}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    (e.target as HTMLInputElement).select();
                                  }}
                                  onChange={async (e) => {
                                    const val = parseInt(e.target.value) || 0;
                                    if (val > 6) {
                                      setAlertModal({ title: "INVALID VALUE", message: "Installments (rd_ni) cannot exceed 6." });
                                      return;
                                    }
                                    const amount = acc.denomination * val;
                                    const reportNum = Math.floor(acc.manualReport || 0);
                                    
                                    if (reportNum > 0 && !checkReportLimit(reportNum, amount, acc.id)) {
                                      setAlertModal({ 
                                        title: "LIMIT EXCEEDED", 
                                        message: `Cannot update installments. Report RT-${reportNum} would exceed 20,000.00 limit.` 
                                      });
                                      return;
                                    }

                                    const updated = { ...acc, rd_ni: val };
                                    await updateAccount(updated);
                                  }}
                                />
                              </td>
                              <td className="p-1 border truncate max-w-[120px]">{acc.name}</td>
                              <td className="p-1 border text-right">{acc.denomination.toFixed(2)}</td>
                              <td className="p-1 border text-center whitespace-nowrap">{formatDueDate(acc.nextDueDate)}</td>
                              <td className="p-1 border text-center">
                                <ReportInputCell
                                  acc={acc}
                                  idx={idx}
                                  handleKeyDown={handleKeyDown}
                                  checkReportLimit={checkReportLimit}
                                  updateAccount={updateAccount}
                                  handleReportBlur={handleReportBlur}
                                  setAlertModal={setAlertModal}
                                />
                              </td>
                              <td className="p-1 border text-center">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPersistentIds(prev => prev.filter(id => id !== acc.id));
                                    if (selectedAccount?.id === acc.id) setSelectedAccount(null);
                                  }}
                                  className="text-red-600 hover:text-red-800 p-0.5"
                                  title="Delete account directly"
                                >
                                  <X size={13} />
                                </button>
                              </td>
                              <td className="p-1 border text-center whitespace-nowrap">
                                {alertInfo.isAlert ? (
                                  <span className="font-extrabold text-red-600 bg-red-100 border border-red-400 px-1.5 py-0.5 rounded text-[11px] uppercase tracking-wide inline-block shadow-sm">
                                    Alert
                                  </span>
                                ) : (
                                  <span className="text-gray-300 text-xs">-</span>
                                )}
                              </td>
                              <td className="p-1 border text-right">{calc.rd_bbt.toFixed(2)}</td>
                              <td className="p-1 border text-right">{calc.rd_tdpf.toFixed(2)}</td>
                              <td className="p-1 border text-center">{calc.rd_mp}</td>
                              <td className="p-1 border text-right">{calc.rd_bat.toFixed(2)}</td>
                              <td className="p-1 border text-center">
                                <input type="checkbox" checked={calc.rd_mp >= 58} readOnly />
                              </td>
                              <td className="p-1 border text-center whitespace-nowrap">{matDate}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Drag Handle to Extend / Collapse List */}
                  <div 
                    onMouseDown={handleStartResize}
                    onTouchStart={handleStartResize}
                    onDoubleClick={() => setTableHeight(prev => prev > 240 ? 215 : 430)}
                    style={{ touchAction: 'none' }}
                    className={cn(
                      "w-full py-1.5 px-2.5 sm:px-3 bg-gray-100 hover:bg-gray-200 active:bg-blue-100 border-b border-gray-300 flex items-center justify-between cursor-row-resize select-none touch-none transition-colors",
                      isDraggingTable && "bg-blue-100 border-blue-400"
                    )}
                    title="Click and drag down to extend accounts list, or tap buttons"
                  >
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600">
                      <GripHorizontal size={14} className="text-gray-400 shrink-0" />
                      <span>{tableHeight > 240 ? `Extended (${Math.max(5, Math.round((tableHeight - 32) / 32))} rows)` : '5 Rows View'}</span>
                    </div>

                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <div className="flex items-center gap-1 text-[11px] text-gray-500 font-medium">
                        <span className="text-[10px] sm:text-[11px] hidden xs:inline">↕ Drag to extend</span>
                        <GripHorizontal size={15} className="text-gray-400 shrink-0" />
                      </div>
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTableHeight(prev => Math.min(850, prev + 155));
                        }}
                        className="text-[10px] bg-white border border-gray-300 hover:border-gray-500 active:bg-gray-200 text-gray-700 px-1.5 py-0.5 font-bold shadow-xs transition-colors cursor-pointer"
                        title="Add 5 more rows to view"
                      >
                        +5 Rows
                      </button>
                      {tableHeight > 240 && (
                        <button 
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTableHeight(215);
                          }}
                          className="text-[10px] bg-white border border-gray-300 hover:border-gray-500 active:bg-gray-200 text-gray-700 px-1.5 py-0.5 font-bold shadow-xs transition-colors cursor-pointer"
                          title="Reset to 5 rows"
                        >
                          Reset (5)
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Bottom Controls */}
                <div className="flex flex-wrap items-center justify-start gap-2 sm:gap-3">
                  <div className="flex items-center gap-1.5 sm:gap-2 bg-white px-2.5 py-1.5 border-2 border-black shadow-[2px_2px_0px_#000]">
                    <span className="text-xs font-bold whitespace-nowrap">RD A/c (Last 4 digits):</span>
                    <input 
                      type="text" 
                      className="w-14 sm:w-16 border border-gray-300 px-1 py-0.5 text-center font-mono font-bold text-xs sm:text-sm"
                      value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                    />
                  </div>
                  <button 
                    onClick={() => setShowSummary(!showSummary)}
                    className="bg-white border-2 border-black px-3 sm:px-5 py-1.5 sm:py-2 font-bold shadow-[2px_2px_0px_#000] hover:bg-gray-100 flex items-center gap-1.5 text-xs sm:text-sm transition-all"
                  >
                    <FileText size={16} /> <span className="whitespace-nowrap">Summary</span>
                  </button>
                  <button 
                    onClick={handlePack}
                    className="bg-white border-2 border-black px-3 sm:px-5 py-1.5 sm:py-2 font-bold shadow-[2px_2px_0px_#000] hover:bg-gray-100 flex items-center gap-1.5 text-xs sm:text-sm transition-all"
                    title="Pack accounts into reports serially up to 20,000 limit"
                  >
                    <Package size={16} /> <span className="whitespace-nowrap">Pack</span>
                  </button>
                  <button 
                    onClick={handleDownloadReports}
                    className="bg-white border-2 border-black px-3 sm:px-5 py-1.5 sm:py-2 font-bold shadow-[2px_2px_0px_#000] hover:bg-gray-100 flex items-center gap-1.5 text-xs sm:text-sm transition-all"
                  >
                    <FileText size={16} /> <span className="whitespace-nowrap">Reports</span>
                  </button>
                  <button onClick={() => setMode('START')} className="bg-white border-2 border-black px-3 sm:px-5 py-1.5 sm:py-2 font-bold shadow-[2px_2px_0px_#000] hover:bg-gray-100 flex items-center gap-1.5 text-xs sm:text-sm transition-all">
                    <X size={16} /> <span className="whitespace-nowrap">Exit</span>
                  </button>
                </div>

                {/* Lower Section: Customer Photo (Left) and Mobile Summary (Right) */}
                <div className="flex flex-row items-start justify-between gap-3 pt-1">
                  {/* Big Customer Photo (Aligned to the left) */}
                  <div className="relative group w-[115px] h-[130px] sm:w-[129px] sm:h-[143px] bg-gray-300 flex items-center justify-center overflow-hidden shadow-[3px_3px_0px_#000] shrink-0">
                    {selectedAccount ? (
                      <>
                        <img 
                          src={selectedPhotoURL || (imgError 
                            ? `https://picsum.photos/seed/${selectedAccount.accountNo}/200/300` 
                            : `/images/${selectedAccount.accountNo}.jpg`
                          )} 
                          alt="Profile" 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                          onError={() => setImgError(true)}
                        />
                        <button 
                          onClick={() => photoInputRef.current?.click()}
                          className="absolute inset-0 bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 text-[10px] font-bold"
                        >
                          <Upload size={16} />
                          CHANGE
                        </button>
                      </>
                    ) : (
                      <UserIcon size={36} className="text-gray-500" />
                    )}
                    {uploading && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 className="animate-spin text-white size-4" />
                      </div>
                    )}
                  </div>

                  {/* Summary on Mobile (< lg screens) */}
                  {showSummary && (
                    <div className="block lg:hidden flex-1 min-w-0">
                      <div className="bg-[#004a75] text-white p-2 sm:p-2.5 shadow-[3px_3px_0px_#000] font-mono text-[11px] sm:text-xs space-y-0.5 max-h-[140px] sm:max-h-[160px] overflow-y-auto custom-scrollbar">
                        <div className="flex items-center gap-1.5 border-b border-white/20 pb-0.5 text-yellow-300 font-bold">
                          <span className="whitespace-nowrap">rt- :</span>
                          <span className="whitespace-nowrap">{summary.unallocatedTotal.toFixed(2)} / {summary.unallocatedCount}</span>
                        </div>
                        {summary.reports.map((rep, i) => (
                          <div key={i} className="flex items-center gap-1.5 border-b border-white/20 pb-0.5">
                            <span className="whitespace-nowrap">rt-{i + 1} :</span>
                            <span className="whitespace-nowrap">{rep.total.toFixed(2)} / {rep.count}</span>
                          </div>
                        ))}
                        <div className="pt-1 flex items-center justify-between text-[10px]">
                          <button
                            type="button"
                            onClick={() => setSummaryListCount(prev => prev + 1)}
                            className="text-yellow-300 hover:text-white underline font-semibold cursor-pointer"
                            title="Add next report list"
                          >
                            + Extend list (rt-{summary.reports.length + 1})
                          </button>
                          {summaryListCount > 5 && (
                            <button
                              type="button"
                              onClick={() => setSummaryListCount(5)}
                              className="text-gray-300 hover:text-white text-[9px] cursor-pointer"
                              title="Reset to 5 lists"
                            >
                              Reset (5)
                            </button>
                          )}
                        </div>
                        {summary.unallocatedCount > 0 && (
                          <p className="text-[9px] text-yellow-200/70 mt-1 leading-tight italic">
                            * {summary.unallocatedCount} accounts with 0 report cost not allocated
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Panel: Summary (Desktop lg screens) */}
              {showSummary && (
                <div className="hidden lg:block lg:col-span-2 transition-all duration-300">
                  <div className="bg-[#004a75] text-white p-2.5 sm:p-3 shadow-[4px_4px_0px_#000] font-mono text-[13px] sm:text-[14px] lg:text-[15px] space-y-0.5 sm:space-y-1 max-h-[350px] lg:max-h-[450px] overflow-y-auto custom-scrollbar w-fit min-w-[210px]">
                    <div className="flex items-center gap-1.5 border-b border-white/20 pb-0.5 text-yellow-300 font-bold">
                      <span className="whitespace-nowrap">rt- :</span>
                      <span className="whitespace-nowrap">{summary.unallocatedTotal.toFixed(2)} / {summary.unallocatedCount}</span>
                    </div>
                    {summary.reports.map((rep, i) => (
                      <div key={i} className="flex items-center gap-1.5 border-b border-white/20 pb-0.5">
                        <span className="whitespace-nowrap">rt-{i + 1} :</span>
                        <span className="whitespace-nowrap">{rep.total.toFixed(2)} / {rep.count}</span>
                      </div>
                    ))}
                    <div className="pt-1.5 flex items-center justify-between text-[11px]">
                      <button
                        type="button"
                        onClick={() => setSummaryListCount(prev => prev + 1)}
                        className="text-yellow-300 hover:text-white underline font-semibold cursor-pointer"
                        title="Add next report list"
                      >
                        + Extend list (rt-{summary.reports.length + 1})
                      </button>
                      {summaryListCount > 5 && (
                        <button
                          type="button"
                          onClick={() => setSummaryListCount(5)}
                          className="text-gray-300 hover:text-white text-[10px] cursor-pointer"
                          title="Reset to 5 lists"
                        >
                          Reset (5)
                        </button>
                      )}
                    </div>
                    {summary.unallocatedCount > 0 && (
                      <p className="text-[10px] sm:text-[11px] text-yellow-200/70 mt-2 leading-tight italic">
                        * {summary.unallocatedCount} accounts with 0 report cost not allocated
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
  </AnimatePresence>

  {/* Defaulters Paid-Date Filter Dialog */}
  <DefaultersPaidDateModal
    isOpen={isDefaulterModalOpen}
    onClose={() => setIsDefaulterModalOpen(false)}
    onSubmit={(params) => {
      setIsDefaulterModalOpen(false);
      setDefaulterParams(params);
    }}
  />

  {/* Defaulters List Screen */}
  {defaulterParams && (
    <DefaultersListView
      accounts={accounts}
      params={defaulterParams}
      onClose={() => setDefaulterParams(null)}
      onSelectAccount={(acc) => {
        setSelectedAccount(acc);
        setMode('MAIN');
        setDefaulterParams(null);
      }}
    />
  )}

  {/* Accounts without Photos Modal */}
  <NoPhotosListModal
    isOpen={isNoPhotosModalOpen}
    onClose={() => setIsNoPhotosModalOpen(false)}
    accounts={accounts}
    photoAccountNos={photoAccountNos}
    onUploadPhotoForAccount={async (file, account) => {
      await handleImageUpload(file, account);
    }}
  />

  {/* Search Matches Selection Modal */}
  <AnimatePresence>
    {searchMatches && (
      <div className="fixed inset-0 flex items-center justify-center z-[100] p-4 bg-black/50 backdrop-blur-sm">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-[#c0d9e9] border-2 border-white shadow-[8px_8px_0px_#000] p-6 max-w-md w-full"
        >
          <div className="bg-[#004a75] text-white p-2 mb-4 text-xs font-bold uppercase tracking-widest flex justify-between items-center">
            <span>MULTIPLE ACCOUNTS FOUND</span>
            <button onClick={() => setSearchMatches(null)}><X size={14} /></button>
          </div>
          <p className="text-[#004a75] font-bold mb-4 text-sm">Select the account to add:</p>
          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-2 custom-scrollbar">
            {searchMatches.map((acc) => {
              const matchAlert = checkDueAlert(acc.nextDueDate);
              return (
                <button
                  key={acc.id}
                  onClick={() => handlePickAccount(acc)}
                  className="w-full bg-white border border-gray-300 p-3 text-left hover:bg-blue-50 transition-colors flex justify-between items-center group gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-[#004a75] group-hover:text-blue-700 truncate">{acc.name}</div>
                    <div className="text-xs font-mono text-gray-500">{acc.accountNo}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <span className="text-[10px] text-gray-400 font-semibold block uppercase tracking-wider">Due Date</span>
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-xs font-mono font-bold text-gray-700 whitespace-nowrap bg-gray-50 px-1.5 py-0.5 border border-gray-200 rounded">
                          {formatDueDate(acc.nextDueDate)}
                        </span>
                        {matchAlert.isAlert && (
                          <span className="text-[10px] font-extrabold text-red-600 bg-red-100 border border-red-400 px-1 py-0.5 rounded uppercase">
                            Alert
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs font-bold bg-gray-100 group-hover:bg-[#004a75] group-hover:text-white px-2.5 py-1.5 rounded transition-colors">
                      SELECT
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <button 
            onClick={() => setSearchMatches(null)}
            className="w-full mt-6 bg-gray-400 text-white py-2 font-bold shadow-[2px_2px_0px_#000] hover:bg-gray-500"
          >
            CANCEL
          </button>
        </motion.div>
      </div>
    )}
  </AnimatePresence>

  {/* Custom Alert Modal */}
  <AnimatePresence>
    {alertModal && (
      <div className="fixed inset-0 flex items-center justify-center z-[100] p-4 bg-black/50 backdrop-blur-sm">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-[#c0d9e9] border-2 border-white shadow-[8px_8px_0px_#000] p-6 max-w-sm w-full"
        >
          <div className="bg-[#004a75] text-white p-2 mb-4 text-xs font-bold uppercase tracking-widest">{alertModal.title}</div>
          <p className="text-[#004a75] font-medium mb-6">{alertModal.message}</p>
          <button 
            onClick={() => setAlertModal(null)}
            className="w-full bg-[#004a75] text-white py-2 font-bold shadow-[2px_2px_0px_#000] hover:bg-[#003a5c]"
          >
            OK
          </button>
        </motion.div>
      </div>
    )}
  </AnimatePresence>

  {/* Custom Confirm Modal */}
  <AnimatePresence>
    {confirmModal && (
      <div className="fixed inset-0 flex items-center justify-center z-[100] p-4 bg-black/50 backdrop-blur-sm">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-[#c0d9e9] border-2 border-white shadow-[8px_8px_0px_#000] p-6 max-w-sm w-full"
        >
          <div className="bg-orange-600 text-white p-2 mb-4 text-xs font-bold uppercase tracking-widest">{confirmModal.title}</div>
          <p className="text-[#004a75] font-medium mb-6">{confirmModal.message}</p>
          <div className="flex gap-4">
            <button 
              onClick={() => setConfirmModal(null)}
              className="flex-1 bg-gray-400 text-white py-2 font-bold shadow-[2px_2px_0px_#000] hover:bg-gray-500"
            >
              CANCEL
            </button>
            <button 
              onClick={confirmModal.onConfirm}
              className="flex-1 bg-orange-600 text-white py-2 font-bold shadow-[2px_2px_0px_#000] hover:bg-orange-700"
            >
              CONFIRM
            </button>
          </div>
        </motion.div>
      </div>
    )}
  </AnimatePresence>
</div>
);
}

export default function App() {
  return (
    <ErrorBoundary>
      <RDApp />
    </ErrorBoundary>
  );
}
