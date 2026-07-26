/**
 * EXAMPLE: Equipment Assessment Module Integration
 *
 * This shows how to integrate the EquipmentAssessmentTemplate component
 * into your HR module. Follow these patterns to use the dynamic fillable PDF system.
 */

import React, { useState, useEffect } from 'react';
import EquipmentAssessmentTemplate from '@/renderer/components/EquipmentAssessmentTemplate';
import api from '@/renderer/lib/api';
import { EquipmentAssessment } from '@/shared/types/equipment-assessment';

// Example 1: Creating a new assessment from scratch
export const NewAssessmentExample = () => {
  const [assessment, setAssessment] = useState<EquipmentAssessment>({
    documentId: `EQ-ASSESS-${new Date().getFullYear()}-0001`,
    executedDate: new Date().toISOString(),
    governingLaw: 'Utah',
    penaltyScheduleVersion: '2026-03-01',
    employerName: 'Your Company LLC',
    employerAddress: '123 Main St, Salt Lake City, UT 84111',
    employeeName: 'John Doe',
    employeeAddress: '456 Oak Ave, Salt Lake City, UT 84111',
    equipment: [
      {
        id: '1',
        itemName: 'Laptop',
        model: 'MacBook Pro 14"',
        condition: 'new',
        issuedDate: '2026-01-15',
        value: 2499.99,
        history: [
          '2026-01-15 - Issued to Employee',
          '2026-03-10 - Reported damaged',
        ],
      },
    ],
    assessedCharges: [
      {
        id: '1',
        tier: '5.M.1 [M]',
        description: 'Loss of Equipment',
        amount: 2499.99,
        basis: 'Equipment value: $2,499.99',
      },
      {
        id: '2',
        tier: '5.L.1 [L]',
        description: 'Administrative Processing Fee',
        amount: 25.0,
        basis: 'Fixed fee per incident',
      },
    ],
    totalEquipmentValue: 2499.99,
    totalAssessed: 2524.99,
    notes: 'Assessment completed per company equipment policy.',
  });

  const handleSave = async (data: EquipmentAssessment) => {
    try {
      const result = await api.equipmentAssessmentSave(data);
      console.log('Assessment saved:', result);
      alert(`Assessment saved! ID: ${result.id}`);
    } catch (error) {
      console.error('Failed to save:', error);
      alert('Failed to save assessment');
    }
  };

  return (
    <div>
      <EquipmentAssessmentTemplate
        data={assessment}
        onSave={handleSave}
        readOnly={false}
      />
    </div>
  );
};

// Example 2: Loading an existing assessment
export const LoadAssessmentExample = () => {
  const [assessment, setAssessment] = useState<EquipmentAssessment | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAssessment = async () => {
      try {
        // Replace with actual assessment ID from your app state
        const assessmentId = 'some-assessment-id';
        const data = await api.equipmentAssessmentLoad(assessmentId);
        setAssessment(data);
      } catch (error) {
        console.error('Failed to load assessment:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAssessment();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (!assessment) return <div>Assessment not found</div>;

  const handleSave = async (data: EquipmentAssessment) => {
    await api.equipmentAssessmentSave(data);
  };

  return (
    <EquipmentAssessmentTemplate
      data={assessment}
      onSave={handleSave}
      readOnly={false}
    />
  );
};

// Example 3: Listing all assessments
export const AssessmentListExample = () => {
  const [assessments, setAssessments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAssessments = async () => {
      try {
        const data = await api.equipmentAssessmentList();
        setAssessments(data);
      } catch (error) {
        console.error('Failed to load assessments:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAssessments();
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="space-y-4">
      <h2>Equipment Assessments</h2>
      {assessments.length === 0 ? (
        <p>No assessments found</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-bg-secondary">
              <th className="text-left p-2">Document ID</th>
              <th className="text-left p-2">Employee</th>
              <th className="text-right p-2">Total Assessed</th>
              <th className="text-left p-2">Date</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {assessments.map((assessment) => (
              <tr key={assessment.id} className="border-b border-border-structure">
                <td className="p-2">{assessment.document_id}</td>
                <td className="p-2">{assessment.employee_name}</td>
                <td className="text-right p-2">${assessment.total_assessed.toFixed(2)}</td>
                <td className="p-2">{new Date(assessment.created_at).toLocaleDateString()}</td>
                <td className="p-2 text-center">
                  <button
                    onClick={() => {
                      // Navigate to view/edit page
                      console.log('View assessment:', assessment.id);
                    }}
                    className="text-color-accent-blue hover:underline"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// Example 4: Programmatically generating and exporting PDF
export const ExportPDFExample = async () => {
  const assessment: EquipmentAssessment = {
    documentId: 'EQ-ASSESS-2026-0001',
    executedDate: new Date().toISOString(),
    governingLaw: 'Utah',
    penaltyScheduleVersion: '2026-03-01',
    employerName: 'Your Company LLC',
    employerAddress: '123 Main St, Salt Lake City, UT 84111',
    employeeName: 'John Doe',
    employeeAddress: '456 Oak Ave, Salt Lake City, UT 84111',
    equipment: [],
    assessedCharges: [],
    totalEquipmentValue: 0,
    totalAssessed: 0,
  };

  try {
    // Export to user-selected location
    const filePath = await api.equipmentAssessmentExportPDF(assessment);
    console.log('PDF exported to:', filePath);
  } catch (error) {
    console.error('Failed to export PDF:', error);
  }
};

/**
 * INTEGRATION CHECKLIST:
 *
 * 1. Add EquipmentAssessmentTemplate to your HR module routes
 *    - Create a new module: src/renderer/modules/hr/
 *    - Add equipment assessment route to HR module
 *
 * 2. Create a page/view that uses the template:
 *    - New Assessment: Use NewAssessmentExample
 *    - View/Edit: Use LoadAssessmentExample
 *    - List: Use AssessmentListExample
 *
 * 3. Wire up database:
 *    - Run: npm run dev
 *    - App should auto-create equipment_assessments table
 *
 * 4. Features provided:
 *    ✓ Dynamic form with data binding
 *    ✓ Fillable PDF generation (with AcroForm fields)
 *    ✓ Save to database with audit trail (SHA256 content seal)
 *    ✓ Export PDF to disk
 *    ✓ Load/edit existing assessments
 *    ✓ Full audit trail (created_at, updated_at, content_seal)
 *
 * 5. To customize:
 *    - Update types in: src/shared/types/equipment-assessment.ts
 *    - Modify PDF layout in: src/renderer/lib/pdf-templates/equipment-assessment.ts
 *    - Adjust form UI in: src/renderer/components/EquipmentAssessmentTemplate.tsx
 */
