import React, { useState, useRef } from 'react';
import { RDAccount } from '../types';
import { formatCurrency } from '../lib/utils';
import { X, Upload, Copy, Check, Search, AlertCircle, Loader2 } from 'lucide-react';

interface NoPhotosListModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: RDAccount[];
  photoAccountNos: Set<string>;
  onUploadPhotoForAccount: (file: File, account: RDAccount) => Promise<void>;
}

export const NoPhotosListModal: React.FC<NoPhotosListModalProps> = ({
  isOpen,
  onClose,
  accounts,
  photoAccountNos,
  onUploadPhotoForAccount,
}) => {
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [uploadingAccNo, setUploadingAccNo] = useState<string | null>(null);
  const singleFileInputRef = useRef<HTMLInputElement>(null);
  const [targetAccount, setTargetAccount] = useState<RDAccount | null>(null);

  if (!isOpen) return null;

  // Filter accounts that do not have a photo in photoAccountNos
  const missingPhotoAccounts = accounts.filter(
    (acc) => !photoAccountNos.has(acc.accountNo)
  );

  const filtered = missingPhotoAccounts.filter(
    (acc) =>
      acc.accountNo.includes(search) ||
      acc.name.toLowerCase().includes(search.toLowerCase()) ||
      (acc.area && acc.area.toLowerCase().includes(search.toLowerCase()))
  );

  const handleCopyNumbers = () => {
    const list = filtered.map((a) => a.accountNo.trim()).join(', ');
    navigator.clipboard.writeText(list);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSelectUpload = (acc: RDAccount) => {
    setTargetAccount(acc);
    if (singleFileInputRef.current) {
      singleFileInputRef.current.value = '';
      singleFileInputRef.current.click();
    }
  };

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && targetAccount) {
      setUploadingAccNo(targetAccount.accountNo);
      try {
        await onUploadPhotoForAccount(file, targetAccount);
      } finally {
        setUploadingAccNo(null);
        setTargetAccount(null);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 font-mono animate-in fade-in duration-150">
      <div 
        id="no-photos-list-modal"
        className="bg-[#c0d9e9] border-2 border-white shadow-[8px_8px_0px_#000] w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden"
      >
        {/* Header Title */}
        <div className="bg-[#004a75] text-white p-3 text-sm font-bold border-b border-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-yellow-400" />
            <span>NO PHOTOS LIST - ACCOUNTS WITHOUT PHOTOS</span>
            <span className="bg-yellow-400 text-black px-2 py-0.2 rounded text-xs font-extrabold ml-2">
              {missingPhotoAccounts.length} Missing
            </span>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="hover:bg-red-600 px-1 py-0.5 text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Toolbar Controls */}
        <div className="p-3 bg-[#d4e4f0] border-b border-black/20 flex flex-wrap gap-2 justify-between items-center text-xs">
          <div className="flex items-center gap-2 bg-white border border-black px-2 py-1 flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="text-gray-500" />
            <input
              type="text"
              placeholder="Search by A/c No, Name or Area..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent outline-none text-xs font-mono text-black font-semibold"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-gray-400 hover:text-black">
                <X size={12} />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleCopyNumbers}
            className="bg-white hover:bg-gray-100 text-[#002f52] px-3 py-1 font-bold border border-black shadow-[2px_2px_0px_#000] flex items-center gap-1.5 transition-all"
          >
            {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
            {copied ? 'COPIED!' : 'COPY A/C NUMBERS'}
          </button>
        </div>

        {/* Table list */}
        <div className="flex-1 overflow-auto bg-white custom-scrollbar">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-[#e4eff6] text-[#002f52] sticky top-0 z-10 border-b border-black font-bold">
              <tr>
                <th className="p-2 border-r border-gray-300 w-12 text-center">#</th>
                <th className="p-2 border-r border-gray-300 whitespace-nowrap">A/c Number</th>
                <th className="p-2 border-r border-gray-300 whitespace-nowrap">Customer Name</th>
                <th className="p-2 border-r border-gray-300 text-right whitespace-nowrap">Denomination</th>
                <th className="p-2 border-r border-gray-300 whitespace-nowrap">Area</th>
                <th className="p-2 border-r border-gray-300 whitespace-nowrap">Mobile</th>
                <th className="p-2 text-center whitespace-nowrap w-28">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500 font-bold">
                    {missingPhotoAccounts.length === 0
                      ? '🎉 All customer accounts have photos uploaded!'
                      : 'No matching accounts found for search filter.'}
                  </td>
                </tr>
              ) : (
                filtered.map((acc, idx) => (
                  <tr key={acc.id || acc.accountNo} className="hover:bg-blue-50/70 transition-colors">
                    <td className="p-2 border-r border-gray-200 text-center text-gray-500 font-mono">
                      {idx + 1}
                    </td>
                    <td className="p-2 border-r border-gray-200 font-mono font-bold text-[#004a75] whitespace-nowrap">
                      {acc.accountNo}
                    </td>
                    <td className="p-2 border-r border-gray-200 font-bold truncate max-w-[200px]">
                      {acc.name}
                    </td>
                    <td className="p-2 border-r border-gray-200 text-right font-mono font-bold text-gray-700">
                      {formatCurrency(acc.denomination)}
                    </td>
                    <td className="p-2 border-r border-gray-200 font-semibold whitespace-nowrap">
                      {acc.area || 'GPT'}
                    </td>
                    <td className="p-2 border-r border-gray-200 font-mono text-gray-600 whitespace-nowrap">
                      {acc.mobile || '-'}
                    </td>
                    <td className="p-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => handleSelectUpload(acc)}
                        disabled={uploadingAccNo === acc.accountNo}
                        className="bg-[#8ebce0] hover:bg-[#7baed6] text-black px-2 py-0.5 text-[11px] font-bold border border-black shadow-[1px_1px_0px_#000] flex items-center gap-1 mx-auto disabled:opacity-50"
                      >
                        {uploadingAccNo === acc.accountNo ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <Upload size={11} />
                        )}
                        Upload
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Hidden file input for single account photo upload */}
        <input
          type="file"
          ref={singleFileInputRef}
          className="hidden"
          accept="image/*"
          onChange={handleFileChosen}
        />

        {/* Footer */}
        <div className="p-3 bg-[#c0d9e9] border-t border-black/20 flex justify-between items-center text-xs">
          <span className="text-gray-700 font-bold">
            Showing {filtered.length} of {missingPhotoAccounts.length} accounts missing photos
          </span>
          <button
            type="button"
            onClick={onClose}
            className="bg-white hover:bg-gray-100 text-[#002f52] px-4 py-1 font-bold border border-black shadow-[2px_2px_0px_#000]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
