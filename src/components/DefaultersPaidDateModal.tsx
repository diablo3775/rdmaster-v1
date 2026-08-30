import React, { useState } from 'react';
import { DefaulterFilterParams } from '../types';
import { X } from 'lucide-react';

interface DefaultersPaidDateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (params: DefaulterFilterParams) => void;
  currentDate?: string;
}

export const DefaultersPaidDateModal: React.FC<DefaultersPaidDateModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  currentDate
}) => {
  const getInitialDate = () => {
    if (currentDate) return currentDate;
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `01-${mm}-${yyyy}`;
  };

  const [computer, setComputer] = useState('Computer');
  const [areaName, setAreaName] = useState('ALL');
  const [monthsDue, setMonthsDue] = useState<number>(1);
  const [orderOn, setOrderOn] = useState<'Area' | 'AccountNo'>('Area');
  const [paidUptoDate, setPaidUptoDate] = useState(getInitialDate());
  const [reportOn, setReportOn] = useState<'Screen' | 'File' | 'Photos'>('Screen');
  const [dateError, setDateError] = useState('');

  if (!isOpen) return null;

  const handleDateChange = (val: string) => {
    setPaidUptoDate(val);
    if (val.trim() && !val.trim().startsWith('01-') && !val.trim().startsWith('01/')) {
      setDateError("Day must be '01' (e.g. 01-08-2026)");
    } else {
      setDateError('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedDate = paidUptoDate.trim();
    if (!trimmedDate.startsWith('01-') && !trimmedDate.startsWith('01/')) {
      setDateError("Day must be '01' (e.g. 01-08-2026)");
      return;
    }

    onSubmit({
      computer: computer.trim() || 'Computer',
      areaName: areaName.trim().toUpperCase() || 'ALL',
      monthsDue,
      orderOn,
      paidUptoDate: trimmedDate,
      reportOn,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 animate-in fade-in duration-150">
      <div 
        id="defaulters-paid-date-modal"
        className="w-full max-w-xl bg-[#a5c8e4] border-2 border-white shadow-[6px_6px_0px_#000] font-mono text-[#002f52] overflow-hidden"
      >
        {/* Title Bar */}
        <div className="bg-gradient-to-r from-[#004a75] to-[#006ca8] text-white px-3 py-1.5 flex justify-between items-center text-xs font-bold select-none border-b border-white/40">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 bg-yellow-400 border border-black/40"></span>
            <span>Defaulters Paid-Date</span>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="hover:bg-red-600 px-1 py-0.5 text-white transition-colors"
          >
            <X size={13} />
          </button>
        </div>

        {/* Modal Form Body */}
        <form onSubmit={handleSubmit} className="p-5 sm:p-7 space-y-4 text-xs sm:text-sm font-semibold">
          
          {/* Select Computer */}
          <div className="flex items-center justify-between gap-3">
            <label className="text-[#003366] font-bold whitespace-nowrap min-w-[150px] text-right sm:min-w-[190px]">
              Select Computer :
            </label>
            <input
              type="text"
              value={computer}
              onChange={(e) => setComputer(e.target.value)}
              className="flex-1 max-w-[200px] bg-white border border-black px-2 py-0.5 font-mono text-black shadow-inner outline-none focus:border-blue-600 focus:bg-yellow-50"
            />
          </div>

          {/* Area Name */}
          <div className="flex items-center justify-between gap-3">
            <label className="text-[#003366] font-bold whitespace-nowrap min-w-[150px] text-right sm:min-w-[190px]">
              Area Name (ALL for all) :
            </label>
            <input
              type="text"
              value={areaName}
              onChange={(e) => setAreaName(e.target.value.toUpperCase())}
              className="flex-1 max-w-[200px] bg-white border border-black px-2 py-0.5 font-mono text-black font-bold shadow-inner outline-none focus:border-blue-600 focus:bg-yellow-50"
            />
          </div>

          {/* Months Due */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <label className="text-[#003366] font-bold whitespace-nowrap min-w-[150px] text-right sm:min-w-[190px]">
              Months Due :
            </label>
            <div className="flex-1 flex items-center flex-wrap gap-2.5 sm:gap-3 text-black">
              {[1, 2, 3, 4, 5, 6, 7].map((num) => (
                <label key={num} className="flex items-center gap-1 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="monthsDue"
                    checked={monthsDue === num}
                    onChange={() => setMonthsDue(num)}
                    className="accent-[#003366] cursor-pointer"
                  />
                  <span className="underline font-bold text-xs">{num}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Order On */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <label className="text-[#003366] font-bold whitespace-nowrap min-w-[150px] text-right sm:min-w-[190px]">
              Order on :
            </label>
            <div className="flex-1 flex items-center gap-6 text-black">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="radio"
                  name="orderOn"
                  checked={orderOn === 'Area'}
                  onChange={() => setOrderOn('Area')}
                  className="accent-[#003366] cursor-pointer"
                />
                <span className="font-bold">
                  <span className="underline">A</span>rea
                </span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="radio"
                  name="orderOn"
                  checked={orderOn === 'AccountNo'}
                  onChange={() => setOrderOn('AccountNo')}
                  className="accent-[#003366] cursor-pointer"
                />
                <span className="font-bold">
                  <span className="underline">A</span>/c No.
                </span>
              </label>
            </div>
          </div>

          {/* Enter paid-upto date */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
            <label className="text-[#003366] font-bold whitespace-nowrap min-w-[150px] sm:text-right sm:min-w-[190px]">
              Enter paid-upto date :
            </label>
            <div className="flex-1 flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={paidUptoDate}
                onChange={(e) => handleDateChange(e.target.value)}
                placeholder="01-08-2026"
                className="w-[120px] bg-white border border-black px-2 py-0.5 font-mono text-black font-bold shadow-inner outline-none focus:border-blue-600 focus:bg-yellow-50"
              />
              <span className="text-[#003366] font-semibold text-[11px] sm:text-xs">
                Day must be &apos;01&apos;
              </span>
            </div>
          </div>
          {dateError && (
            <p className="text-red-700 font-bold text-xs text-right">{dateError}</p>
          )}

          {/* Report On */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <label className="text-[#003366] font-bold whitespace-nowrap min-w-[150px] text-right sm:min-w-[190px]">
              Report on :
            </label>
            <div className="flex-1 flex items-center gap-5 sm:gap-6 text-black flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="radio"
                  name="reportOn"
                  checked={reportOn === 'Screen'}
                  onChange={() => setReportOn('Screen')}
                  className="accent-[#003366] cursor-pointer"
                />
                <span className="font-bold">
                  <span className="underline">S</span>creen
                </span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="radio"
                  name="reportOn"
                  checked={reportOn === 'File'}
                  onChange={() => setReportOn('File')}
                  className="accent-[#003366] cursor-pointer"
                />
                <span className="font-bold">
                  <span className="underline">F</span>ile
                </span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="radio"
                  name="reportOn"
                  checked={reportOn === 'Photos'}
                  onChange={() => setReportOn('Photos')}
                  className="accent-[#003366] cursor-pointer"
                />
                <span className="font-bold">
                  <span className="underline">P</span>hotos
                </span>
              </label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-5 border-t border-[#003366]/20 flex justify-center gap-6">
            <button
              type="submit"
              className="bg-[#d4e4f0] hover:bg-white text-[#002f52] px-7 py-1 font-bold border border-black shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
            >
              <span className="underline">O</span>K
            </button>
            <button
              type="button"
              onClick={onClose}
              className="bg-[#d4e4f0] hover:bg-white text-[#002f52] px-7 py-1 font-bold border border-black shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
