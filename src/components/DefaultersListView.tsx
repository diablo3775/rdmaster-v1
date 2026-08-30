import React, { useState, useEffect } from 'react';
import { RDAccount, DefaulterFilterParams } from '../types';
import { calculateAccountDueMonths, parseDate } from '../lib/utils';
import { X, Download, ArrowLeft, ZoomIn, Search, UserCheck, AlertCircle } from 'lucide-react';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';

interface DefaultersListViewProps {
  accounts: RDAccount[];
  params: DefaulterFilterParams;
  onClose: () => void;
  onSelectAccount?: (acc: RDAccount) => void;
}

// Format date as DD.MM.YY (e.g. 16.07.26)
function formatDotDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = parseDate(dateStr);
  if (!d) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  return `${day}.${month}.${year}`;
}

// Get short 4-digit or meaningful account identifier (e.g. 0277, 3060)
function getShortAcNo(accNo: string): string {
  if (!accNo) return '';
  const clean = accNo.replace(/\D/g, '');
  if (clean.length > 4) {
    return clean.slice(-4);
  }
  return clean || accNo;
}

// Format full account number (e.g. 02001 8420667 or 20150471866)
function formatGroupedAcNo(accNo: string): string {
  if (!accNo) return '';
  const clean = accNo.trim();
  if (clean.length === 11 || clean.length === 12) {
    return `${clean.slice(0, 5)} ${clean.slice(5)}`;
  }
  if (clean.length >= 8) {
    const splitPoint = Math.floor(clean.length / 2);
    return `${clean.slice(0, splitPoint)} ${clean.slice(splitPoint)}`;
  }
  return clean;
}

export const DefaultersListView: React.FC<DefaultersListViewProps> = ({
  accounts,
  params,
  onClose
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAccountNo, setSelectedAccountNo] = useState<string | null>(null);
  const [photoMap, setPhotoMap] = useState<Record<string, string>>({});
  const [previewPhoto, setPreviewPhoto] = useState<{ url: string; name: string; accNo: string } | null>(null);

  // Filter & sort defaulter accounts based on params
  const defaulterList = React.useMemo(() => {
    let filtered = accounts.filter(acc => {
      // Filter by Next_rd_in (nextDueDate) and target paidUptoDate
      const dueMonths = calculateAccountDueMonths(acc.nextDueDate, params.paidUptoDate);
      if (dueMonths === null) return false;

      if (params.monthsDue === 7) {
        return dueMonths >= 7;
      }
      return dueMonths === params.monthsDue;
    });

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(acc =>
        acc.accountNo.toLowerCase().includes(q) ||
        acc.name.toLowerCase().includes(q) ||
        (acc.mobile && acc.mobile.includes(q))
      );
    }

    // Sort by account number
    filtered.sort((a, b) => a.accountNo.localeCompare(b.accountNo));

    return filtered;
  }, [accounts, params, searchQuery]);

  // Keyboard navigation & escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (previewPhoto) {
          setPreviewPhoto(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, previewPhoto]);

  // Fetch photos for defaulters in batch (with caching)
  useEffect(() => {
    let isMounted = true;
    const fetchPhotos = async () => {
      const needed = defaulterList.slice(0, 300);
      const newMap: Record<string, string> = { ...photoMap };
      let updated = false;

      const toFetch = needed.filter(acc => !newMap[acc.accountNo]);
      if (toFetch.length > 0) {
        await Promise.all(
          toFetch.map(async (acc) => {
            try {
              const snap = await getDoc(doc(db, 'photos', acc.accountNo));
              if (snap.exists() && snap.data().photoURL) {
                newMap[acc.accountNo] = snap.data().photoURL;
                updated = true;
              }
            } catch (e) {
              console.warn("Failed fetching photo for defaulter", acc.accountNo, e);
            }
          })
        );
      }

      if (isMounted && updated) {
        setPhotoMap({ ...newMap });
      }
    };

    fetchPhotos();
    return () => { isMounted = false; };
  }, [defaulterList]);

  // Export formatted Text File
  const handleDownloadTextFile = () => {
    const headerTitle = `Paid Upto : ${params.paidUptoDate}\nDue Months : ${params.monthsDue}\n\n`;
    
    const colAccNo = (v: string) => v.padEnd(16, ' ');
    const colName = (v: string) => (v.length > 26 ? v.substring(0, 26) : v).padEnd(26, ' ');
    const colDenom = (v: string) => v.padStart(12, ' ');
    const colMonthPaid = (v: string) => v.padStart(10, ' ');
    const colNextRd = (v: string) => v.padStart(14, ' ');

    const tableHeader = `${colAccNo("ACNO")}  ${colName("CUSTOMER NAME")}  ${colDenom("DEN")}  ${colMonthPaid("PAID")}  ${colNextRd("NEX RD IN")}`;
    const divider = "-".repeat(tableHeader.length);

    let content = headerTitle + divider + "\n" + tableHeader + "\n" + divider + "\n";

    let totalDenom = 0;
    defaulterList.forEach((acc) => {
      totalDenom += acc.denomination;
      const accNoStr = acc.accountNo;
      const nameStr = acc.name;
      const denomStr = `Den ${acc.denomination}`;
      const monthPaidStr = String(acc.monthPaidUpto);
      const nextRdStr = `Nex RD in. ${formatDotDate(acc.nextDueDate)}`;

      content += `${colAccNo(accNoStr)}  ${colName(nameStr)}  ${colDenom(denomStr)}  ${colMonthPaid(monthPaidStr)}  ${colNextRd(nextRdStr)}\n`;
    });

    content += divider + "\n";
    content += `Total Accounts : ${defaulterList.length}       Total Amount : ₹${totalDenom.toLocaleString('en-IN')}\n`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Financial_Defaulters_${params.paidUptoDate.replace(/[^0-9]/g, '_')}_Due_${params.monthsDue}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalDenomination = defaulterList.reduce((sum, a) => sum + a.denomination, 0);

  return (
    <div className="fixed inset-0 bg-[#f0f4f8] z-50 overflow-y-auto flex flex-col font-sans select-none">
      
      {/* Top Header Bar */}
      <header className="bg-[#004a75] text-white px-3 sm:px-5 py-2.5 shadow-md flex flex-wrap items-center justify-between gap-2.5 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors"
            title="Back to Dashboard"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
              <span>Financial Defaulters</span>
              <span className="bg-yellow-400 text-black text-xs font-extrabold px-2 py-0.5 rounded-full">
                {defaulterList.length} Accounts
              </span>
            </h1>
            <div className="text-xs text-blue-200 flex items-center gap-2 font-mono mt-0.5">
              <span>Paid Upto: <strong className="text-white">{params.paidUptoDate}</strong></span>
              <span>•</span>
              <span>Due: <strong className="text-yellow-300">{params.monthsDue} Month(s)</strong></span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search account, name..."
              className="bg-white/10 border border-white/20 text-white placeholder-blue-200 text-xs rounded-lg pl-7 pr-3 py-1.5 focus:outline-hidden focus:bg-white/20 focus:border-white transition-all w-36 sm:w-52"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/70 hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Download File */}
          <button
            onClick={handleDownloadTextFile}
            className="flex items-center gap-1.5 bg-[#8ebce0] hover:bg-white text-[#002f52] px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-xs"
          >
            <Download size={13} />
            <span className="hidden sm:inline">Export</span> TXT
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            className="p-1.5 bg-red-600/80 hover:bg-red-600 text-white rounded-lg transition-colors"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-2xl w-full mx-auto p-2 sm:p-4 flex flex-col gap-2.5">
        
        {/* Status Bar Summary */}
        <div className="bg-white rounded-xl border border-gray-200 px-3.5 py-2 shadow-2xs flex flex-wrap items-center justify-between text-xs text-gray-600 gap-2">
          <div className="flex items-center gap-3 flex-wrap font-medium text-[11.5px]">
            <span>Total Matching: <strong className="text-gray-900 font-bold">{defaulterList.length}</strong></span>
            <span>•</span>
            <span>Total Due Denomination: <strong className="text-emerald-700 font-bold">₹{totalDenomination.toLocaleString('en-IN')}</strong></span>
            <span>•</span>
            <span>Computer: <strong className="text-gray-900">{params.computer}</strong></span>
          </div>
          <div className="text-gray-500 text-[10.5px]">
            Click photo to view full size
          </div>
        </div>

        {/* Single Column Vertical List */}
        {defaulterList.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center shadow-xs flex flex-col items-center justify-center my-4">
            <AlertCircle size={36} className="text-gray-400 mb-2" />
            <h3 className="text-sm font-bold text-gray-800 mb-1">No Defaulters Found</h3>
            <p className="text-xs text-gray-500 max-w-md">
              No accounts match {params.monthsDue} month(s) due for Paid-Upto date {params.paidUptoDate}.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {defaulterList.map((acc) => {
              const photoUrl = photoMap[acc.accountNo];
              const isSelected = selectedAccountNo === acc.accountNo;
              const shortNo = getShortAcNo(acc.accountNo);
              const formattedAcNo = formatGroupedAcNo(acc.accountNo);
              const formattedNextRD = formatDotDate(acc.nextDueDate);

              return (
                <div
                  key={acc.id || acc.accountNo}
                  onClick={() => setSelectedAccountNo(acc.accountNo)}
                  className={`bg-white rounded-2xl p-2.5 sm:p-3 transition-all border flex items-center gap-3 ${
                    isSelected
                      ? 'border-[#005a8c] ring-1.5 ring-[#005a8c]/40 shadow-xs bg-blue-50/20'
                      : 'border-gray-200 hover:border-gray-300 shadow-2xs hover:shadow-xs'
                  }`}
                >
                  {/* Customer Image */}
                  <div
                    onClick={(e) => {
                      if (photoUrl) {
                        e.stopPropagation();
                        setPreviewPhoto({ url: photoUrl, name: acc.name, accNo: acc.accountNo });
                      }
                    }}
                    className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center relative group shadow-2xs cursor-pointer"
                    title={photoUrl ? "Click to view full photo" : "No photo"}
                  >
                    {photoUrl ? (
                      <>
                        <img
                          src={photoUrl}
                          alt={acc.name}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                          <ZoomIn size={14} />
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-gray-400 p-0.5 text-center">
                        <UserCheck size={18} className="opacity-60" />
                        <span className="text-[8px] font-bold">NO IMG</span>
                      </div>
                    )}
                  </div>

                  {/* 4 Items Cell Layout with Paid on Top */}
                  <div className="flex-1 min-w-0">
                    
                    {/* Top Row: Customer Name on left, Paid on right */}
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="text-xs sm:text-[13px] font-bold text-[#004a75] truncate" title={acc.name}>
                        {acc.name}
                      </div>
                      <div className="text-[11px] text-gray-500 font-medium whitespace-nowrap shrink-0">
                        Paid: <strong className="text-gray-700">{acc.monthPaidUpto}m</strong>
                      </div>
                    </div>

                    {/* 2-Column Info Grid (2 on Left, 2 on Right) */}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 items-center">
                      
                      {/* Item 1: Top Left - Short Value ONLY */}
                      <div className="text-xs sm:text-sm font-extrabold text-gray-900 tracking-tight whitespace-nowrap">
                        {shortNo}
                      </div>

                      {/* Item 3: Top Right - Denomination */}
                      <div className="text-xs sm:text-sm font-semibold text-gray-800 text-right whitespace-nowrap">
                        Den {acc.denomination}
                      </div>

                      {/* Item 2: Bottom Left - Full Account Number */}
                      <div 
                        className="text-[11px] sm:text-xs text-gray-600 font-mono tracking-tight whitespace-nowrap" 
                        title={acc.accountNo}
                      >
                        AcNo. {formattedAcNo}
                      </div>

                      {/* Item 4: Bottom Right - Next RD In Date */}
                      <div className="text-[11px] sm:text-xs text-gray-600 text-right whitespace-nowrap font-sans">
                        Nex RD in. {formattedNextRD}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Enlarged Photo Preview Modal */}
      {previewPhoto && (
        <div
          className="fixed inset-0 bg-black/80 z-60 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setPreviewPhoto(null)}
        >
          <div
            className="bg-white rounded-2xl overflow-hidden p-4 max-w-xs w-full shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-2.5 mb-2 border-b border-gray-100">
              <div>
                <h4 className="font-bold text-xs text-gray-900 truncate max-w-[200px]">{previewPhoto.name}</h4>
                <p className="text-[10px] font-mono text-gray-500">A/C: {previewPhoto.accNo}</p>
              </div>
              <button
                onClick={() => setPreviewPhoto(null)}
                className="p-1 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="w-full aspect-[3/4] rounded-xl overflow-hidden bg-gray-100 border border-gray-200 mb-3 shadow-inner">
              <img
                src={previewPhoto.url}
                alt={previewPhoto.name}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>

            <button
              onClick={() => setPreviewPhoto(null)}
              className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl font-bold text-xs transition-colors"
            >
              Close Preview
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
