import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
}

export function calculateRD(denom: number, rd_ni: number, monthPaid: number) {
  const rd_mp = monthPaid;
  const rd_bbt = denom * rd_mp;
  const rd_tdpf = denom * rd_ni;
  const rd_bat = (denom * rd_ni) + rd_bbt;
  const report1 = denom * rd_ni; // Based on user: report - calculation denomination amount * rd_number of installments
  const finalReport = rd_tdpf + report1;
  
  const isMatured = monthPaid >= 58;
  
  return {
    rd_mp,
    rd_bbt,
    rd_tdpf,
    rd_bat,
    report1,
    finalReport,
    isMatured
  };
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (!trimmed || trimmed === '-' || trimmed.toLowerCase() === 'null') return null;

  // Handle formats like DD-MMM-YYYY, DD-MMM-YY, DD-MM-YYYY, DD-MM-YY, DD/MM/YYYY, YYYY-MM-DD
  const clean = trimmed.replace(/\//g, '-').replace(/\./g, '-');
  const parts = clean.split('-');

  if (parts.length === 3) {
    // Check if YYYY-MM-DD
    if (parts[0].length === 4 && !isNaN(parseInt(parts[0]))) {
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1;
      const day = parseInt(parts[2]);
      if (!isNaN(day) && !isNaN(month) && month >= 0 && month <= 11) {
        return new Date(year, month, day);
      }
    }

    const day = parseInt(parts[0]);
    const monthPart = parts[1];
    let year = parseInt(parts[2]);

    if (isNaN(day)) return null;

    // Convert 2-digit year (e.g. 26 -> 2026)
    if (year < 100) {
      year = 2000 + year;
    }

    let monthIndex = -1;
    if (isNaN(parseInt(monthPart))) {
      monthIndex = MONTH_NAMES.findIndex(m => m === monthPart.toLowerCase().slice(0, 3));
    } else {
      monthIndex = parseInt(monthPart) - 1;
    }

    if (monthIndex >= 0 && monthIndex <= 11 && !isNaN(year)) {
      return new Date(year, monthIndex, day);
    }
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

export function checkDueAlert(nextDueDate: string | null): { isAlert: boolean; monthsOverdue: number } {
  const dObj = parseDate(nextDueDate);
  if (!dObj) return { isAlert: false, monthsOverdue: 0 };
  
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  
  const dueYear = dObj.getFullYear();
  const dueMonth = dObj.getMonth();
  
  const monthsDiff = (currentYear - dueYear) * 12 + (currentMonth - dueMonth);
  return {
    isAlert: monthsDiff >= 5,
    monthsOverdue: Math.max(0, monthsDiff)
  };
}

export function formatDueDate(dateStr: string | null): string {
  const dObj = parseDate(dateStr);
  if (!dObj) return '-';
  const day = dObj.getDate().toString().padStart(2, '0');
  const month = (dObj.getMonth() + 1).toString().padStart(2, '0');
  const year = dObj.getFullYear().toString().slice(-2);
  return `${day}-${month}-${year}`;
}

export function formatCrCurrency(val: number): string {
  return `${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr.`;
}

export function calculateAccountDueMonths(nextDueDate: string | null, targetPaidUptoStr: string): number | null {
  const targetDate = parseDate(targetPaidUptoStr);
  if (!targetDate) return null;

  const dueDate = parseDate(nextDueDate);
  if (!dueDate) return null;

  const targetY = targetDate.getFullYear();
  const targetM = targetDate.getMonth(); // 0-indexed month
  const dueY = dueDate.getFullYear();
  const dueM = dueDate.getMonth(); // 0-indexed month

  const diff = (targetY - dueY) * 12 + (targetM - dueM) + 1;
  return diff;
}

export function calculateMaturityDate(nextDueDate: string | null, monthPaid: number) {
  const dObj = parseDate(nextDueDate);
  if (!dObj) return '-';
  
  const date = new Date(dObj.getTime());
  const monthsRemaining = 60 - monthPaid;
  
  date.setMonth(date.getMonth() + monthsRemaining);
  
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear().toString().slice(-2);
  
  // Return in DD-MM-YY format (e.g., 17-05-26)
  return `${d}-${m}-${y}`;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, auth: any) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map((provider: any) => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
