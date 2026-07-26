export interface EquipmentItem {
  id?: string;
  itemName: string;
  model: string;
  condition: 'new' | 'used' | 'refurbished' | 'damaged';
  issuedDate: string; // ISO date
  value: number;
  history?: string[]; // Timeline of events
}

export interface AssessedCharge {
  id?: string;
  tier: string; // e.g., "5.M.1 [M]"
  description: string;
  amount: number;
  basis: string; // Explanation of how amount was calculated
}

export interface EquipmentAssessment {
  documentId: string;
  executedDate: string; // ISO datetime
  governingLaw: string; // e.g., "Montana (worksite) / Utah (employer principal place of business)"
  penaltyScheduleVersion: string; // e.g., "2026-03-01"

  // Employer details
  employerName: string;
  employerAddress: string;

  // Employee details
  employeeName: string;
  employeeAddress: string;

  // Equipment & charges
  equipment: EquipmentItem[];
  assessedCharges: AssessedCharge[];
  totalEquipmentValue: number;
  totalAssessed: number;

  // Notes & metadata
  notes?: string;
  contentSeal?: string; // SHA256 hash for audit trail
}

export interface EquipmentAssessmentFormData extends EquipmentAssessment {
  // Additional UI/form state
  isDirty?: boolean;
  lastModified?: string;
}
