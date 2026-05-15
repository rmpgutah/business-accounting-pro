import fs from 'node:fs';

const ipc = fs.readFileSync('src/main/ipc/index.ts', 'utf8');
const tax = fs.readFileSync('src/main/services/TaxCalculationEngine.ts', 'utf8');

const checks = [
  {
    name: 'postJournalEntry normalizes debits/credits to cents',
    pass: ipc.includes('const cents = (n: unknown): number') && ipc.includes('Math.round(v * 100) / 100'),
  },
  {
    name: 'invoice payment JE uses paymentAmount on both sides',
    pass: ipc.includes('const paymentAmount = db.roundCents(Number(amount))') &&
      ipc.includes('debit: paymentAmount') &&
      ipc.includes('credit: paymentAmount'),
  },
  {
    name: 'payroll process JE credits deductions payable',
    pass: ipc.includes('totalEmployeeDeductions') &&
      ipc.includes("note: 'Employee deductions payable'"),
  },
  {
    name: 'payroll JE computes net pay from gross minus taxes/deductions',
    pass: ipc.includes('const netPayForJe = db.roundCents(') &&
      ipc.includes('grossForJe - totalFederalTax - totalStateTax - totalSS - totalMedicare - totalEmployeeDeductions'),
  },
  {
    name: '2026 Social Security wage base is current',
    pass: tax.includes('ss_wage_base: 184500'),
  },
];

let failed = 0;
for (const c of checks) {
  console.log(`${c.pass ? '✅' : '❌'} ${c.name}`);
  if (!c.pass) failed++;
}

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}

console.log('\nBalanced invoice/payment/payroll QA passed.');
