import { db, auth } from './firebase';
import { collection, addDoc, getDocs, query, limit } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from './lib/utils';

const sampleAccounts = [
  { accountNo: "20150471866", name: "CHILLA KRUPA LAKSHMI HARSHA", denomination: 5000, monthPaidUpto: 15, nextDueDate: "06-06-2026", mobile: "9876543210", area: "GPT", rd_ni: 1, manualReport: 0 },
  { accountNo: "20150475627", name: "DARAPU VAMSI KRISHNA", denomination: 10000, monthPaidUpto: 15, nextDueDate: "06-06-2026", mobile: "9876543211", area: "GPT-SATY", rd_ni: 1, manualReport: 0 },
  { accountNo: "20016378115", name: "S SATYAVATHI", denomination: 1000, monthPaidUpto: 59, nextDueDate: "30-06-2026", mobile: "9876543212", area: "PCG", rd_ni: 1, manualReport: 0 },
  { accountNo: "020001559958", name: "G TATARAONAIDU", denomination: 1000, monthPaidUpto: 63, nextDueDate: "20-04-2026", mobile: "9876543213", area: "GPT", rd_ni: 1, manualReport: 0 },
  { accountNo: "020004458842", name: "B VENKATTA LAKSHMI", denomination: 500, monthPaidUpto: 60, nextDueDate: "18-02-2026", mobile: "9876543214", area: "GPT-SATY", rd_ni: 1, manualReport: 0 },
  { accountNo: "020005235457", name: "AMBATI ISSAC ANDREWS", denomination: 1000, monthPaidUpto: 61, nextDueDate: "24-03-2026", mobile: "9876543215", area: "HNG", rd_ni: 1, manualReport: 0 },
  { accountNo: "020007441338", name: "TUMALAPPALLI SATHIRAJU", denomination: 5000, monthPaidUpto: 60, nextDueDate: "17-03-2026", mobile: "9876543216", area: "INP", rd_ni: 1, manualReport: 0 },
  { accountNo: "020008107326", name: "PEETHA BAPANAMM", denomination: 500, monthPaidUpto: 60, nextDueDate: "22-03-2026", mobile: "9876543217", area: "PCG", rd_ni: 1, manualReport: 0 },
  { accountNo: "020008164354", name: "LALAM NOOKARATNAM", denomination: 1000, monthPaidUpto: 60, nextDueDate: "22-03-2026", mobile: "9876543218", area: "PCG", rd_ni: 1, manualReport: 0 },
  { accountNo: "020008374607", name: "D V V KUMAR SWAMMY", denomination: 1000, monthPaidUpto: 60, nextDueDate: "23-03-2026", mobile: "9876543219", area: "RCHP", rd_ni: 1, manualReport: 0 },
  { accountNo: "020010521303", name: "MALLIPUDI RAMBABU", denomination: 2000, monthPaidUpto: 58, nextDueDate: "15-07-2026", mobile: "9876543220", area: "GPT", rd_ni: 1, manualReport: 0 },
  { accountNo: "020010601246", name: "CH VARAPRASAD", denomination: 800, monthPaidUpto: 57, nextDueDate: "10-08-2026", mobile: "9876543221", area: "RJN", rd_ni: 1, manualReport: 0 },
  { accountNo: "020010601728", name: "CH GOLLAMMA", denomination: 500, monthPaidUpto: 54, nextDueDate: "12-05-2026", mobile: "9876543222", area: "RJN", rd_ni: 1, manualReport: 0 }
];

export async function seedAccounts() {
  const path = 'accounts';
  try {
    const q = query(collection(db, path), limit(1));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      console.log("Seeding sample accounts...");
      for (const acc of sampleAccounts) {
        await addDoc(collection(db, path), acc);
      }
      console.log("Seeding complete.");
    }
  } catch (error) {
    // Only report if it's not a permission error during initial check
    // or if we really want to know why seeding failed.
    console.warn("Seeding check failed (likely permissions):", error);
  }
}
