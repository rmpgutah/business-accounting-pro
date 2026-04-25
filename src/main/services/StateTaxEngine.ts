// src/main/services/StateTaxEngine.ts
// State income tax calculation engine — all 50 states + DC, 2024/2025 rates

interface StateBracket {
  min: number;
  max: number | null;
  rate: number;
}

// Zero-income-tax states (no state wage tax)
const ZERO_TAX_STATES = new Set(['FL', 'TX', 'NV', 'WA', 'WY', 'SD', 'AK', 'NH', 'TN']);

// Flat-rate states: state code → flat rate
const FLAT_RATE_STATES: Record<string, number> = {
  CO: 0.044,
  IL: 0.0495,
  IN: 0.0315,
  KY: 0.04,
  MI: 0.0425,
  NC: 0.045,
  PA: 0.0307,
  UT: 0.0455, // 2025 single flat rate per Utah HB 106 (reduced from 4.65%)
  AZ: 0.025,
  ID: 0.058,
  MA: 0.05,
};

// Progressive bracket states (2024/2025 approximate single-filer rates)
const PROGRESSIVE_BRACKETS: Record<string, StateBracket[]> = {
  CA: [
    { min: 0,        max: 10099,    rate: 0.01   },
    { min: 10099,    max: 23942,    rate: 0.02   },
    { min: 23942,    max: 37788,    rate: 0.04   },
    { min: 37788,    max: 52455,    rate: 0.06   },
    { min: 52455,    max: 66295,    rate: 0.08   },
    { min: 66295,    max: 338639,   rate: 0.093  },
    { min: 338639,   max: 406364,   rate: 0.103  },
    { min: 406364,   max: 677275,   rate: 0.113  },
    { min: 677275,   max: 1000000,  rate: 0.123  },
    { min: 1000000,  max: null,     rate: 0.133  },
  ],
  NY: [
    { min: 0,        max: 17150,    rate: 0.04   },
    { min: 17150,    max: 23600,    rate: 0.045  },
    { min: 23600,    max: 27900,    rate: 0.0525 },
    { min: 27900,    max: 161550,   rate: 0.055  },
    { min: 161550,   max: 323200,   rate: 0.06   },
    { min: 323200,   max: 2155350,  rate: 0.0685 },
    { min: 2155350,  max: 5000000,  rate: 0.0965 },
    { min: 5000000,  max: null,     rate: 0.109  },
  ],
  MN: [
    { min: 0,        max: 30070,    rate: 0.0535 },
    { min: 30070,    max: 98760,    rate: 0.068  },
    { min: 98760,    max: 183340,   rate: 0.0785 },
    { min: 183340,   max: null,     rate: 0.0985 },
  ],
  OR: [
    { min: 0,        max: 10000,    rate: 0.0475 },
    { min: 10000,    max: 250000,   rate: 0.0675 },
    { min: 250000,   max: null,     rate: 0.099  },
  ],
  NJ: [
    { min: 0,        max: 20000,    rate: 0.014  },
    { min: 20000,    max: 35000,    rate: 0.0175 },
    { min: 35000,    max: 40000,    rate: 0.035  },
    { min: 40000,    max: 75000,    rate: 0.05525 },
    { min: 75000,    max: 500000,   rate: 0.0637 },
    { min: 500000,   max: 1000000,  rate: 0.0897 },
    { min: 1000000,  max: null,     rate: 0.1075 },
  ],
  VT: [
    { min: 0,        max: 45400,    rate: 0.0335 },
    { min: 45400,    max: 110050,   rate: 0.066  },
    { min: 110050,   max: 229550,   rate: 0.076  },
    { min: 229550,   max: null,     rate: 0.0875 },
  ],
  HI: [
    { min: 0,        max: 2400,     rate: 0.014  },
    { min: 2400,     max: 4800,     rate: 0.032  },
    { min: 4800,     max: 9600,     rate: 0.055  },
    { min: 9600,     max: 14400,    rate: 0.064  },
    { min: 14400,    max: 19200,    rate: 0.068  },
    { min: 19200,    max: 24000,    rate: 0.072  },
    { min: 24000,    max: 48000,    rate: 0.076  },
    { min: 48000,    max: 150000,   rate: 0.079  },
    { min: 150000,   max: 175000,   rate: 0.0825 },
    { min: 175000,   max: 200000,   rate: 0.09   },
    { min: 200000,   max: null,     rate: 0.11   },
  ],
  CT: [
    { min: 0,        max: 10000,    rate: 0.03   },
    { min: 10000,    max: 50000,    rate: 0.05   },
    { min: 50000,    max: 100000,   rate: 0.055  },
    { min: 100000,   max: 200000,   rate: 0.06   },
    { min: 200000,   max: 250000,   rate: 0.065  },
    { min: 250000,   max: 500000,   rate: 0.069  },
    { min: 500000,   max: null,     rate: 0.0699 },
  ],
  ME: [
    { min: 0,        max: 26050,    rate: 0.058  },
    { min: 26050,    max: 61600,    rate: 0.0675 },
    { min: 61600,    max: null,     rate: 0.0715 },
  ],
  WI: [
    { min: 0,        max: 14320,    rate: 0.0354 },
    { min: 14320,    max: 28640,    rate: 0.0465 },
    { min: 28640,    max: 315310,   rate: 0.053  },
    { min: 315310,   max: null,     rate: 0.0765 },
  ],
  SC: [
    { min: 0,        max: 3460,     rate: 0      },
    { min: 3460,     max: 17330,    rate: 0.03   },
    { min: 17330,    max: null,     rate: 0.065  },
  ],
  GA: [
    { min: 0,        max: 750,      rate: 0.01   },
    { min: 750,      max: 2250,     rate: 0.02   },
    { min: 2250,     max: 3750,     rate: 0.03   },
    { min: 3750,     max: 5250,     rate: 0.04   },
    { min: 5250,     max: 7000,     rate: 0.05   },
    { min: 7000,     max: null,     rate: 0.0549 },
  ],
  MD: [
    { min: 0,        max: 1000,     rate: 0.02   },
    { min: 1000,     max: 2000,     rate: 0.03   },
    { min: 2000,     max: 3000,     rate: 0.04   },
    { min: 3000,     max: 100000,   rate: 0.0475 },
    { min: 100000,   max: 125000,   rate: 0.05   },
    { min: 125000,   max: 150000,   rate: 0.0525 },
    { min: 150000,   max: 250000,   rate: 0.055  },
    { min: 250000,   max: null,     rate: 0.0575 },
  ],
  VA: [
    { min: 0,        max: 3000,     rate: 0.02   },
    { min: 3000,     max: 5000,     rate: 0.03   },
    { min: 5000,     max: 17000,    rate: 0.05   },
    { min: 17000,    max: null,     rate: 0.0575 },
  ],
  OH: [
    { min: 0,        max: 26050,    rate: 0      },
    { min: 26050,    max: 46100,    rate: 0.02765 },
    { min: 46100,    max: 92150,    rate: 0.03226 },
    { min: 92150,    max: 115300,   rate: 0.03688 },
    { min: 115300,   max: null,     rate: 0.03990 },
  ],
  MO: [
    { min: 0,        max: 1207,     rate: 0      },
    { min: 1207,     max: 2414,     rate: 0.015  },
    { min: 2414,     max: 3621,     rate: 0.02   },
    { min: 3621,     max: 4828,     rate: 0.025  },
    { min: 4828,     max: 6035,     rate: 0.03   },
    { min: 6035,     max: 7242,     rate: 0.035  },
    { min: 7242,     max: 8449,     rate: 0.04   },
    { min: 8449,     max: 9701,     rate: 0.045  },
    { min: 9701,     max: null,     rate: 0.048  },
  ],
  LA: [
    { min: 0,        max: 12500,    rate: 0.0185 },
    { min: 12500,    max: 50000,    rate: 0.035  },
    { min: 50000,    max: null,     rate: 0.0425 },
  ],
  AL: [
    { min: 0,        max: 500,      rate: 0.02   },
    { min: 500,      max: 3000,     rate: 0.04   },
    { min: 3000,     max: null,     rate: 0.05   },
  ],
  MS: [
    { min: 0,        max: 10000,    rate: 0      },
    { min: 10000,    max: null,     rate: 0.05   },
  ],
  AR: [
    { min: 0,        max: 5099,     rate: 0.02   },
    { min: 5099,     max: 10299,    rate: 0.04   },
    { min: 10299,    max: null,     rate: 0.047  },
  ],
  NM: [
    { min: 0,        max: 5500,     rate: 0.017  },
    { min: 5500,     max: 11000,    rate: 0.032  },
    { min: 11000,    max: 16000,    rate: 0.047  },
    { min: 16000,    max: 210000,   rate: 0.049  },
    { min: 210000,   max: null,     rate: 0.059  },
  ],
  MT: [
    { min: 0,        max: 3600,     rate: 0.01   },
    { min: 3600,     max: 6300,     rate: 0.02   },
    { min: 6300,     max: 9700,     rate: 0.03   },
    { min: 9700,     max: 13000,    rate: 0.04   },
    { min: 13000,    max: 16800,    rate: 0.05   },
    { min: 16800,    max: 21600,    rate: 0.06   },
    { min: 21600,    max: null,     rate: 0.069  },
  ],
  ND: [
    { min: 0,        max: 44725,    rate: 0.011  },
    { min: 44725,    max: 225975,   rate: 0.0204 },
    { min: 225975,   max: null,     rate: 0.029  },
  ],
  NE: [
    { min: 0,        max: 3700,     rate: 0.0246 },
    { min: 3700,     max: 22170,    rate: 0.0351 },
    { min: 22170,    max: 35730,    rate: 0.0501 },
    { min: 35730,    max: null,     rate: 0.0664 },
  ],
  KS: [
    { min: 0,        max: 15000,    rate: 0.031  },
    { min: 15000,    max: 30000,    rate: 0.0525 },
    { min: 30000,    max: null,     rate: 0.057  },
  ],
  OK: [
    { min: 0,        max: 1000,     rate: 0.0025 },
    { min: 1000,     max: 2500,     rate: 0.0075 },
    { min: 2500,     max: 3750,     rate: 0.0175 },
    { min: 3750,     max: 4900,     rate: 0.0275 },
    { min: 4900,     max: 7200,     rate: 0.0375 },
    { min: 7200,     max: null,     rate: 0.0475 },
  ],
  IA: [
    { min: 0,        max: 6210,     rate: 0.044  },
    { min: 6210,     max: null,     rate: 0.057  },
  ],
  WV: [
    { min: 0,        max: 10000,    rate: 0.03   },
    { min: 10000,    max: 25000,    rate: 0.04   },
    { min: 25000,    max: 40000,    rate: 0.045  },
    { min: 40000,    max: 60000,    rate: 0.06   },
    { min: 60000,    max: null,     rate: 0.065  },
  ],
  DC: [
    { min: 0,        max: 10000,    rate: 0.04   },
    { min: 10000,    max: 40000,    rate: 0.06   },
    { min: 40000,    max: 60000,    rate: 0.065  },
    { min: 60000,    max: 250000,   rate: 0.085  },
    { min: 250000,   max: 500000,   rate: 0.0925 },
    { min: 500000,   max: 1000000,  rate: 0.0975 },
    { min: 1000000,  max: null,     rate: 0.1075 },
  ],
  RI: [
    { min: 0,        max: 68200,    rate: 0.0375 },
    { min: 68200,    max: 155050,   rate: 0.0475 },
    { min: 155050,   max: null,     rate: 0.0599 },
  ],
  DE: [
    { min: 0,        max: 2000,     rate: 0      },
    { min: 2000,     max: 5000,     rate: 0.022  },
    { min: 5000,     max: 10000,    rate: 0.039  },
    { min: 10000,    max: 20000,    rate: 0.048  },
    { min: 20000,    max: 25000,    rate: 0.052  },
    { min: 25000,    max: 60000,    rate: 0.0555 },
    { min: 60000,    max: null,     rate: 0.066  },
  ],
};

// SDI rates (State Disability Insurance — employee contribution %)
const SDI_RATES: Record<string, number> = {
  CA: 0.009,
  NJ: 0.0026,
  NY: 0.005,
  HI: 0.005,
  RI: 0.013,
};

// States with no individual income tax on wages (some have investment income taxes)
// Already covered by ZERO_TAX_STATES above

export class StateTaxEngine {
  /**
   * Calculate per-period state income tax withholding.
   * Annualizes gross pay, applies bracket calc or flat rate, de-annualizes.
   */
  getStateWithholding(
    state: string,
    grossPay: number,
    allowances = 0,
    payPeriodsPerYear = 26
  ): number {
    const stateCode = (state || '').toUpperCase().trim().slice(0, 2);
    if (!stateCode || ZERO_TAX_STATES.has(stateCode)) return 0;

    const annualGross = grossPay * payPeriodsPerYear;
    const allowanceDeduction = allowances * 4300;
    const taxableIncome = Math.max(0, annualGross - allowanceDeduction);

    let annualTax = 0;

    if (FLAT_RATE_STATES[stateCode] !== undefined) {
      annualTax = taxableIncome * FLAT_RATE_STATES[stateCode];
    } else if (PROGRESSIVE_BRACKETS[stateCode]) {
      annualTax = this._bracketTax(taxableIncome, PROGRESSIVE_BRACKETS[stateCode]);
    } else {
      console.warn(`[StateTaxEngine] No rate data for state: ${stateCode} — using 5% fallback`);
      annualTax = taxableIncome * 0.05;
    }

    return Math.max(0, annualTax / payPeriodsPerYear);
  }

  getSdiRate(state: string): number {
    const stateCode = (state || '').toUpperCase().trim().slice(0, 2);
    return SDI_RATES[stateCode] ?? 0;
  }

  getSdiWithholding(state: string, grossPay: number): number {
    return grossPay * this.getSdiRate(state);
  }

  private _bracketTax(income: number, brackets: StateBracket[]): number {
    let tax = 0;
    for (const b of brackets) {
      if (income <= b.min) break;
      const taxableInBracket = b.max !== null
        ? Math.min(income, b.max) - b.min
        : income - b.min;
      tax += taxableInBracket * b.rate;
    }
    return tax;
  }
}

export const stateTaxEngine = new StateTaxEngine();
