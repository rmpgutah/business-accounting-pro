import { PDFDocument, PDFPage, rgb, PDFFont } from 'pdf-lib';
import { EquipmentAssessment } from '@/shared/types/equipment-assessment';

const MARGIN = 40;
const LINE_HEIGHT = 20;
const FIELD_HEIGHT = 18;
const FIELD_BOX_COLOR = rgb(0.95, 0.95, 0.98);
const BORDER_COLOR = rgb(0.5, 0.5, 0.5);

interface PDFTemplateOptions {
  fillableFields?: boolean; // If true, creates AcroForm fields; if false, just renders static text
  editable?: boolean;
}

export async function generateEquipmentAssessmentPDF(
  data: EquipmentAssessment,
  options: PDFTemplateOptions = { fillableFields: true, editable: true }
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const { width, height } = page.getSize();

  const font = await pdfDoc.embedFont('Helvetica');
  const boldFont = await pdfDoc.embedFont('Helvetica-Bold');

  let yPos = height - MARGIN;

  // Helper to draw text field (static or fillable)
  const drawField = (
    label: string,
    value: string,
    x: number,
    y: number,
    fieldWidth: number = 300,
    fieldName?: string
  ) => {
    page.drawText(label, {
      x,
      y,
      size: 9,
      font: boldFont,
      color: rgb(0.2, 0.2, 0.2),
    });

    const fieldY = y - FIELD_HEIGHT - 4;

    if (options.fillableFields && fieldName) {
      // Create fillable form field
      const field = pdfDoc.getForm().createTextField(fieldName);
      field.setText(value || '');
      field.addToPage(page, { x, y: fieldY, width: fieldWidth, height: FIELD_HEIGHT });
      field.setFontSize(10);
    } else {
      // Draw static text box
      page.drawRectangle({
        x,
        y: fieldY,
        width: fieldWidth,
        height: FIELD_HEIGHT,
        borderColor: BORDER_COLOR,
        borderWidth: 0.5,
        color: FIELD_BOX_COLOR,
      });
      page.drawText(value || '', {
        x: x + 4,
        y: fieldY + 3,
        size: 10,
        font,
        color: rgb(0, 0, 0),
      });
    }

    return fieldY - FIELD_HEIGHT;
  };

  const drawHeading = (text: string, y: number) => {
    page.drawText(text, {
      x: MARGIN,
      y,
      size: 14,
      font: boldFont,
      color: rgb(0.1, 0.1, 0.1),
    });
    return y - LINE_HEIGHT * 1.5;
  };

  const drawLabel = (text: string, y: number, size = 11) => {
    page.drawText(text, {
      x: MARGIN,
      y,
      size,
      font: boldFont,
      color: rgb(0.3, 0.3, 0.3),
    });
    return y - LINE_HEIGHT;
  };

  // HEADER
  yPos = drawHeading('EQUIPMENT ASSESSMENT STATEMENT', yPos);

  page.drawText(data.employerName, {
    x: MARGIN,
    y: yPos,
    size: 12,
    font: boldFont,
  });
  yPos -= LINE_HEIGHT;
  page.drawText(data.employerAddress, { x: MARGIN, y: yPos, size: 9, font });
  yPos -= LINE_HEIGHT * 1.5;

  // DOCUMENT METADATA
  yPos = drawLabel('Document ID', yPos, 10);
  yPos = drawField('', data.documentId, MARGIN, yPos, 200, 'documentId');

  yPos = drawLabel('Executed', yPos - 10, 10);
  yPos = drawField('', data.executedDate, MARGIN, yPos, 200, 'executedDate');

  yPos = drawLabel('Governing Law', yPos - 10, 10);
  yPos = drawField('', data.governingLaw, MARGIN, yPos, 350, 'governingLaw');

  yPos -= LINE_HEIGHT * 1.5;

  // PARTIES SECTION
  yPos = drawHeading('PARTIES', yPos);

  yPos = drawLabel('Employer', yPos, 11);
  yPos = drawField('Name', data.employerName, MARGIN + 20, yPos, 300, 'employerName');
  yPos -= LINE_HEIGHT;
  yPos = drawField('Address', data.employerAddress, MARGIN + 20, yPos, 300, 'employerAddress');

  yPos -= LINE_HEIGHT * 1.5;

  yPos = drawLabel('Employee', yPos, 11);
  yPos = drawField('Name', data.employeeName, MARGIN + 20, yPos, 300, 'employeeName');
  yPos -= LINE_HEIGHT;
  yPos = drawField('Address', data.employeeAddress, MARGIN + 20, yPos, 300, 'employeeAddress');

  yPos -= LINE_HEIGHT * 2;

  // EQUIPMENT SCHEDULE
  yPos = drawHeading('EQUIPMENT SCHEDULE', yPos);

  // Table headers
  const colX = [MARGIN, MARGIN + 120, MARGIN + 200, MARGIN + 280, MARGIN + 380];
  const colLabels = ['ITEM', 'MODEL', 'CONDITION', 'ISSUED', 'VALUE'];

  colLabels.forEach((label, i) => {
    page.drawText(label, {
      x: colX[i],
      y: yPos,
      size: 9,
      font: boldFont,
      color: rgb(0.1, 0.1, 0.1),
    });
  });

  yPos -= LINE_HEIGHT;
  page.drawLine({
    start: { x: MARGIN, y: yPos + 2 },
    end: { x: width - MARGIN, y: yPos + 2 },
    thickness: 0.5,
    color: BORDER_COLOR,
  });
  yPos -= 8;

  // Equipment items
  data.equipment.forEach((item, idx) => {
    const itemNum = idx + 1;
    page.drawText(`${itemNum}.`, { x: MARGIN, y: yPos, size: 9, font });
    page.drawText(item.itemName, { x: MARGIN + 20, y: yPos, size: 9, font });
    page.drawText(item.model, { x: colX[1], y: yPos, size: 9, font });
    page.drawText(item.condition, { x: colX[2], y: yPos, size: 9, font });
    page.drawText(item.issuedDate, { x: colX[3], y: yPos, size: 9, font });
    page.drawText(`$${item.value.toFixed(2)}`, { x: colX[4], y: yPos, size: 9, font });

    yPos -= LINE_HEIGHT;

    // History (if present)
    if (item.history && item.history.length > 0) {
      item.history.forEach((event) => {
        page.drawText(`  ${event}`, {
          x: MARGIN + 30,
          y: yPos,
          size: 8,
          font,
          color: rgb(0.5, 0.5, 0.5),
        });
        yPos -= LINE_HEIGHT * 0.7;
      });
    }

    yPos -= 4;
  });

  yPos -= LINE_HEIGHT * 0.5;
  page.drawText('Total equipment value', {
    x: MARGIN,
    y: yPos,
    size: 10,
    font: boldFont,
  });
  page.drawText(`$${data.totalEquipmentValue.toFixed(2)}`, {
    x: colX[4],
    y: yPos,
    size: 10,
    font: boldFont,
  });

  yPos -= LINE_HEIGHT * 2;

  // ASSESSED CHARGES
  yPos = drawHeading('ASSESSED CHARGES', yPos);

  const chargeColX = [MARGIN, MARGIN + 100, MARGIN + 200, MARGIN + 500];
  const chargeLabels = ['TIER', 'DESCRIPTION', 'BASIS', 'AMOUNT'];

  chargeLabels.forEach((label, i) => {
    page.drawText(label, {
      x: chargeColX[i],
      y: yPos,
      size: 9,
      font: boldFont,
      color: rgb(0.1, 0.1, 0.1),
    });
  });

  yPos -= LINE_HEIGHT;
  page.drawLine({
    start: { x: MARGIN, y: yPos + 2 },
    end: { x: width - MARGIN, y: yPos + 2 },
    thickness: 0.5,
    color: BORDER_COLOR,
  });
  yPos -= 8;

  // Charges
  data.assessedCharges.forEach((charge) => {
    page.drawText(charge.tier, { x: chargeColX[0], y: yPos, size: 8, font });
    page.drawText(charge.description, { x: chargeColX[1], y: yPos, size: 8, font });
    page.drawText(charge.basis, {
      x: chargeColX[2],
      y: yPos,
      size: 7,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    page.drawText(`$${charge.amount.toFixed(2)}`, {
      x: chargeColX[3],
      y: yPos,
      size: 8,
      font,
    });

    yPos -= LINE_HEIGHT * 0.9;
  });

  yPos -= LINE_HEIGHT * 0.5;
  page.drawText('Total assessed', {
    x: MARGIN,
    y: yPos,
    size: 10,
    font: boldFont,
  });
  page.drawText(`$${data.totalAssessed.toFixed(2)}`, {
    x: chargeColX[3],
    y: yPos,
    size: 10,
    font: boldFont,
  });

  yPos -= LINE_HEIGHT * 1.5;

  // NOTES
  if (data.notes) {
    yPos = drawHeading('NOTES', yPos);
    page.drawText(data.notes, {
      x: MARGIN + 20,
      y: yPos,
      size: 9,
      font,
      maxWidth: width - MARGIN * 2 - 40,
    });
  }

  // Save the PDF
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

export async function loadAndFillPDF(
  pdfBytes: Uint8Array,
  data: Partial<EquipmentAssessment>
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();

  // Dynamically fill any form fields that exist in the PDF
  const fields = form.getFields();
  fields.forEach((field) => {
    const fieldName = field.getName();
    const value = (data as any)[fieldName];
    if (value !== undefined) {
      try {
        const textField = field as any;
        if (typeof textField.setText === 'function') {
          textField.setText(String(value));
        }
      } catch (e) {
        // Skip fields that can't be filled
      }
    }
  });

  return await pdfDoc.save();
}
