import React, { useState, useCallback } from 'react';
import type { EquipmentAssessment, EquipmentItem, AssessedCharge } from '../../shared/types/equipment-assessment';
import api from '../lib/api';

interface EquipmentAssessmentTemplateProps {
  data: EquipmentAssessment;
  onSave?: (data: EquipmentAssessment) => Promise<void>;
  readOnly?: boolean;
}

export const EquipmentAssessmentTemplate: React.FC<EquipmentAssessmentTemplateProps> = ({
  data: initialData,
  onSave,
  readOnly = false,
}) => {
  const [data, setData] = useState<EquipmentAssessment>(initialData);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  const updateData = useCallback((updates: Partial<EquipmentAssessment>) => {
    setData((prev) => ({ ...prev, ...updates }));
  }, []);

  const updateEquipmentItem = useCallback((index: number, updates: Partial<EquipmentItem>) => {
    setData((prev) => ({
      ...prev,
      equipment: prev.equipment.map((item, i) => (i === index ? { ...item, ...updates } : item)),
    }));
  }, []);

  const updateCharge = useCallback((index: number, updates: Partial<AssessedCharge>) => {
    setData((prev) => ({
      ...prev,
      assessedCharges: prev.assessedCharges.map((charge, i) =>
        i === index ? { ...charge, ...updates } : charge
      ),
    }));
  }, []);

  const handleSave = async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      await onSave(data);
    } finally {
      setIsSaving(false);
    }
  };

  const handleGeneratePDF = async () => {
    setIsGeneratingPDF(true);
    try {
      const pdfBytes = await api.equipmentAssessmentGeneratePDF(data);

      // Download PDF
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${data.documentId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const FormInput: React.FC<{
    label: string;
    value: string | number;
    onChange: (value: string | number) => void;
    type?: 'text' | 'number' | 'date' | 'textarea';
    disabled?: boolean;
  }> = ({ label, value, onChange, type = 'text', disabled = readOnly }) => (
    <div className="mb-4">
      <label className="block text-sm font-medium text-text-secondary mb-1">{label}</label>
      {type === 'textarea' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full px-3 py-2 bg-bg-secondary border border-border-structure rounded-[var(--app-radius)] text-text-primary disabled:opacity-50"
          rows={3}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
          disabled={disabled}
          className="w-full px-3 py-2 bg-bg-secondary border border-border-structure rounded-[var(--app-radius)] text-text-primary disabled:opacity-50"
        />
      )}
    </div>
  );

  return (
    <div className="space-y-6 p-6 bg-bg-primary">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{data.employerName}</h1>
          <p className="text-sm text-text-secondary">{data.employerAddress}</p>
        </div>
        <div className="flex gap-2">
          {!readOnly && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-accent-primary text-white rounded-[var(--app-radius)] disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          )}
          <button
            onClick={handleGeneratePDF}
            disabled={isGeneratingPDF}
            className="px-4 py-2 bg-color-accent-blue text-white rounded-[var(--app-radius)] disabled:opacity-50"
          >
            {isGeneratingPDF ? 'Generating...' : 'Download PDF'}
          </button>
        </div>
      </div>

      <hr className="border-border-structure" />

      {/* Document Metadata */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Document Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <FormInput
            label="Document ID"
            value={data.documentId}
            onChange={(v) => updateData({ documentId: String(v) })}
            disabled
          />
          <FormInput
            label="Executed Date"
            value={data.executedDate}
            onChange={(v) => updateData({ executedDate: String(v) })}
            type="date"
          />
          <FormInput
            label="Governing Law"
            value={data.governingLaw}
            onChange={(v) => updateData({ governingLaw: String(v) })}
          />
          <FormInput
            label="Penalty Schedule Version"
            value={data.penaltyScheduleVersion}
            onChange={(v) => updateData({ penaltyScheduleVersion: String(v) })}
          />
        </div>
      </section>

      <hr className="border-border-structure" />

      {/* Employer Section */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Employer</h2>
        <div className="grid grid-cols-1 gap-4">
          <FormInput
            label="Employer Name"
            value={data.employerName}
            onChange={(v) => updateData({ employerName: String(v) })}
          />
          <FormInput
            label="Employer Address"
            value={data.employerAddress}
            onChange={(v) => updateData({ employerAddress: String(v) })}
          />
        </div>
      </section>

      {/* Employee Section */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Employee</h2>
        <div className="grid grid-cols-1 gap-4">
          <FormInput
            label="Employee Name"
            value={data.employeeName}
            onChange={(v) => updateData({ employeeName: String(v) })}
          />
          <FormInput
            label="Employee Address"
            value={data.employeeAddress}
            onChange={(v) => updateData({ employeeAddress: String(v) })}
          />
        </div>
      </section>

      <hr className="border-border-structure" />

      {/* Equipment Schedule */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Equipment Schedule</h2>
        <div className="space-y-4">
          {data.equipment.map((item, idx) => (
            <div key={idx} className="p-4 bg-bg-secondary border border-border-structure rounded-[var(--app-radius)]">
              <div className="grid grid-cols-2 gap-4 mb-2">
                <FormInput
                  label="Item Name"
                  value={item.itemName}
                  onChange={(v) => updateEquipmentItem(idx, { itemName: String(v) })}
                />
                <FormInput
                  label="Model"
                  value={item.model}
                  onChange={(v) => updateEquipmentItem(idx, { model: String(v) })}
                />
                <FormInput
                  label="Condition"
                  value={item.condition}
                  onChange={(v) => updateEquipmentItem(idx, { condition: String(v) as any })}
                />
                <FormInput
                  label="Issued Date"
                  value={item.issuedDate}
                  onChange={(v) => updateEquipmentItem(idx, { issuedDate: String(v) })}
                  type="date"
                />
                <FormInput
                  label="Value"
                  value={item.value}
                  onChange={(v) => updateEquipmentItem(idx, { value: Number(v) })}
                  type="number"
                />
              </div>
              {item.history && item.history.length > 0 && (
                <div className="text-sm text-text-secondary">
                  <p className="font-medium">History:</p>
                  <ul className="ml-4">
                    {item.history.map((event, i) => (
                      <li key={i}>• {event}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 p-3 bg-bg-secondary rounded-[var(--app-radius)]">
          <p className="text-sm font-semibold text-text-primary">
            Total Equipment Value: ${data.totalEquipmentValue.toFixed(2)}
          </p>
        </div>
      </section>

      <hr className="border-border-structure" />

      {/* Assessed Charges */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Assessed Charges</h2>
        <div className="space-y-4">
          {data.assessedCharges.map((charge, idx) => (
            <div key={idx} className="p-4 bg-bg-secondary border border-border-structure rounded-[var(--app-radius)]">
              <div className="grid grid-cols-2 gap-4 mb-2">
                <FormInput
                  label="Tier"
                  value={charge.tier}
                  onChange={(v) => updateCharge(idx, { tier: String(v) })}
                />
                <FormInput
                  label="Description"
                  value={charge.description}
                  onChange={(v) => updateCharge(idx, { description: String(v) })}
                />
                <FormInput
                  label="Basis"
                  value={charge.basis}
                  onChange={(v) => updateCharge(idx, { basis: String(v) })}
                  type="textarea"
                />
                <FormInput
                  label="Amount"
                  value={charge.amount}
                  onChange={(v) => updateCharge(idx, { amount: Number(v) })}
                  type="number"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 p-3 bg-bg-secondary rounded-[var(--app-radius)]">
          <p className="text-sm font-semibold text-text-primary">
            Total Assessed: ${data.totalAssessed.toFixed(2)}
          </p>
        </div>
      </section>

      <hr className="border-border-structure" />

      {/* Notes */}
      <section>
        <FormInput
          label="Notes"
          value={data.notes || ''}
          onChange={(v) => updateData({ notes: String(v) })}
          type="textarea"
        />
      </section>

      {/* Footer with actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-border-structure">
        {!readOnly && (
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 bg-accent-primary text-white rounded-[var(--app-radius)] disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
        <button
          onClick={handleGeneratePDF}
          disabled={isGeneratingPDF}
          className="px-6 py-2 bg-color-accent-blue text-white rounded-[var(--app-radius)] disabled:opacity-50"
        >
          {isGeneratingPDF ? 'Generating...' : 'Export as PDF'}
        </button>
      </div>
    </div>
  );
};

export default EquipmentAssessmentTemplate;
