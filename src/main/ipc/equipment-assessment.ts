import { ipcMain, dialog } from 'electron';
import * as db from '../database';
import { generateEquipmentAssessmentPDF, loadAndFillPDF } from '../services/equipment-assessment-pdf';
import type { EquipmentAssessment } from '../../shared/types/equipment-assessment';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';

export function registerEquipmentAssessmentIpc() {
  // Generate fillable PDF from assessment data
  ipcMain.handle('equipment-assessment:generate-pdf', async (_event, data: EquipmentAssessment) => {
    try {
      const pdfBytes = await generateEquipmentAssessmentPDF(data, {
        fillableFields: true,
        editable: true,
      });
      return pdfBytes; // Uint8Array serializable as ArrayBuffer
    } catch (error) {
      throw new Error(`Failed to generate equipment assessment PDF: ${error}`);
    }
  });

  // Save equipment assessment to database
  ipcMain.handle('equipment-assessment:save', async (_event, data: EquipmentAssessment) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) throw new Error('No active company selected');

      // Calculate content seal (SHA256 hash for audit trail)
      const contentString = JSON.stringify({
        documentId: data.documentId,
        executedDate: data.executedDate,
        employerName: data.employerName,
        employeeName: data.employeeName,
        equipment: data.equipment,
        assessedCharges: data.assessedCharges,
        totalEquipmentValue: data.totalEquipmentValue,
        totalAssessed: data.totalAssessed,
      });
      const contentSeal = crypto.createHash('sha256').update(contentString).digest('hex');

      // Check if record exists
      const existing = db
        .getDb()
        .prepare('SELECT id FROM equipment_assessments WHERE document_id = ? AND company_id = ?')
        .get(data.documentId, companyId) as { id: string } | undefined;

      const now = new Date().toISOString();

      if (existing) {
        // Update
        db.getDb()
          .prepare(
            `
          UPDATE equipment_assessments
          SET
            executed_date = ?,
            governing_law = ?,
            penalty_schedule_version = ?,
            employer_name = ?,
            employer_address = ?,
            employee_name = ?,
            employee_address = ?,
            equipment_json = ?,
            charges_json = ?,
            total_equipment_value = ?,
            total_assessed = ?,
            notes = ?,
            content_seal = ?,
            updated_at = ?
          WHERE id = ?
          `
          )
          .run(
            data.executedDate,
            data.governingLaw,
            data.penaltyScheduleVersion,
            data.employerName,
            data.employerAddress,
            data.employeeName,
            data.employeeAddress,
            JSON.stringify(data.equipment),
            JSON.stringify(data.assessedCharges),
            data.totalEquipmentValue,
            data.totalAssessed,
            data.notes || null,
            contentSeal,
            now,
            existing.id
          );

        return { id: existing.id, created: false };
      } else {
        // Create
        const id = uuid();
        db.getDb()
          .prepare(
            `
          INSERT INTO equipment_assessments (
            id, company_id, document_id, executed_date, governing_law,
            penalty_schedule_version, employer_name, employer_address,
            employee_name, employee_address, equipment_json, charges_json,
            total_equipment_value, total_assessed, notes, content_seal, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
          )
          .run(
            id,
            companyId,
            data.documentId,
            data.executedDate,
            data.governingLaw,
            data.penaltyScheduleVersion,
            data.employerName,
            data.employerAddress,
            data.employeeName,
            data.employeeAddress,
            JSON.stringify(data.equipment),
            JSON.stringify(data.assessedCharges),
            data.totalEquipmentValue,
            data.totalAssessed,
            data.notes || null,
            contentSeal,
            now,
            now
          );

        return { id, created: true };
      }
    } catch (error) {
      throw new Error(`Failed to save equipment assessment: ${error}`);
    }
  });

  // Load equipment assessment by ID
  ipcMain.handle('equipment-assessment:load', async (_event, assessmentId: string) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) throw new Error('No active company selected');

      const row = db
        .getDb()
        .prepare(
          `
        SELECT * FROM equipment_assessments
        WHERE id = ? AND company_id = ?
        `
        )
        .get(assessmentId, companyId) as any;

      if (!row) throw new Error('Assessment not found');

      return {
        documentId: row.document_id,
        executedDate: row.executed_date,
        governingLaw: row.governing_law,
        penaltyScheduleVersion: row.penalty_schedule_version,
        employerName: row.employer_name,
        employerAddress: row.employer_address,
        employeeName: row.employee_name,
        employeeAddress: row.employee_address,
        equipment: JSON.parse(row.equipment_json),
        assessedCharges: JSON.parse(row.charges_json),
        totalEquipmentValue: row.total_equipment_value,
        totalAssessed: row.total_assessed,
        notes: row.notes,
        contentSeal: row.content_seal,
      } as EquipmentAssessment;
    } catch (error) {
      throw new Error(`Failed to load equipment assessment: ${error}`);
    }
  });

  // List equipment assessments for current company
  ipcMain.handle('equipment-assessment:list', async () => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) throw new Error('No active company selected');

      const rows = db
        .getDb()
        .prepare(
          `
        SELECT id, document_id, executed_date, employee_name, total_assessed, created_at
        FROM equipment_assessments
        WHERE company_id = ?
        ORDER BY executed_date DESC
        `
        )
        .all(companyId);

      return rows;
    } catch (error) {
      throw new Error(`Failed to list equipment assessments: ${error}`);
    }
  });

  // Delete equipment assessment
  ipcMain.handle('equipment-assessment:delete', async (_event, assessmentId: string) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) throw new Error('No active company selected');

      db.getDb()
        .prepare('DELETE FROM equipment_assessments WHERE id = ? AND company_id = ?')
        .run(assessmentId, companyId);

      return true;
    } catch (error) {
      throw new Error(`Failed to delete equipment assessment: ${error}`);
    }
  });

  // Export PDF to disk
  ipcMain.handle('equipment-assessment:export-pdf', async (_event, data: EquipmentAssessment) => {
    try {
      const { filePath } = await dialog.showSaveDialog({
        title: 'Save Equipment Assessment PDF',
        defaultPath: `${data.documentId}.pdf`,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      });

      if (!filePath) return null;

      const pdfBytes = await generateEquipmentAssessmentPDF(data, {
        fillableFields: true,
        editable: true,
      });

      fs.writeFileSync(filePath, pdfBytes);
      return filePath;
    } catch (error) {
      throw new Error(`Failed to export PDF: ${error}`);
    }
  });
}
