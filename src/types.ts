export interface RDAccount {
  id: string;
  accountNo: string;
  name: string;
  denomination: number;
  monthPaidUpto: number;
  nextDueDate: string | null;
  mobile?: string;
  area?: string;
  rd_ni?: number;
  rd_disc?: number;
  rd_pf?: number;
  manualReport?: number;
}

export type AppMode = 'START' | 'MAIN' | 'NEW';

export interface DefaulterFilterParams {
  computer: string;
  areaName: string;
  monthsDue: number; // 1 to 7
  orderOn: 'Area' | 'AccountNo';
  paidUptoDate: string; // DD-MM-YYYY
  reportOn: 'Screen' | 'File' | 'Photos';
}

export interface AppState {
  lastActiveAccountId: string | null;
  updatedAt: string;
}
